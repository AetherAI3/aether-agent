import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPoll, pollForToken, type DeviceCode } from "../src/core/device.js";
import { ApiClient } from "../src/core/transport.js";
import { StaticTokenStore } from "../src/core/auth.js";

test("classifyPoll maps server responses to poll actions", () => {
  assert.equal(classifyPoll({ error: "authorization_pending" }), "wait");
  assert.equal(classifyPoll({ error: "slow_down" }), "slow_down");
  assert.equal(classifyPoll({ error: "access_denied" }), "denied");
  assert.equal(classifyPoll({ error: "expired_token" }), "expired");
  assert.equal(classifyPoll({ access_token: "aek_x" }), "ready");
  assert.equal(classifyPoll({}), "wait");
});

// ── pollForToken: LOOP-01 / LOOP-06 regression ───────────────────────────
// A raw network failure (fetch throwing — server down, DNS failure, timeout)
// must NOT be silently reclassified as `authorization_pending`. Only an
// HttpError carrying a real body from the token endpoint (the documented 400
// pending/slow_down/expired case) may map to ordinary polling state.

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Fake clock driven entirely through the injected `sleep` — pollForToken's
 *  loop checks `Date.now() < deadline` against real wall-clock otherwise,
 *  which would hang the test for the full (realistic, multi-minute) expires_in
 *  window instead of resolving instantly. */
function fakeClock(): { sleep: (ms: number) => Promise<void>; restore: () => void } {
  const real = Date.now;
  let clock = 0;
  Date.now = () => clock;
  return {
    sleep: async (ms: number) => {
      clock += ms;
    },
    restore: () => {
      Date.now = real;
    },
  };
}

/** Stubs global fetch to play back one Response-or-throw "act" per call,
 *  repeating the last act once the sequence is exhausted. */
function stubFetchSequence(acts: Array<() => Response>): { calls: () => number; restore: () => void } {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => {
    const act = acts[Math.min(n, acts.length - 1)] as () => Response;
    n++;
    return act();
  }) as typeof globalThis.fetch;
  return {
    calls: () => n,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

function captureStderr(): { text: () => string; restore: () => void } {
  const orig = process.stderr.write.bind(process.stderr);
  let out = "";
  process.stderr.write = ((s: string) => ((out += s), true)) as typeof process.stderr.write;
  return {
    text: () => out,
    restore: () => {
      process.stderr.write = orig;
    },
  };
}

const CODE: DeviceCode = {
  device_code: "dc_1",
  user_code: "ABCD-1234",
  verification_uri: "https://aethersystems.net/platform/device",
  verification_uri_complete: "https://aethersystems.net/platform/device?u=dc_1",
  interval: 1,
  expires_in: 10, // with interval=1s -> 10 deterministic poll attempts via the fake clock
};

test("pollForToken: a transient network blip does not warn and does not block success", async () => {
  const netErr = () => {
    throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  };
  const success = () => jsonRes(200, { access_token: "aek_success" });
  const fetchStub = stubFetchSequence([netErr, netErr, success]);
  const clock = fakeClock();
  const stderr = captureStderr();
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_key"));
    const token = await pollForToken(api, CODE, clock.sleep);
    assert.equal(token, "aek_success");
    assert.equal(stderr.text(), "", "two blips (below the 3-in-a-row threshold) must not print a warning");
  } finally {
    fetchStub.restore();
    clock.restore();
    stderr.restore();
  }
});

test("pollForToken: a sustained network outage fails fast with a distinct message, not silent authorization_pending", async () => {
  const netErr = () => {
    throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  };
  const fetchStub = stubFetchSequence([netErr]);
  const clock = fakeClock();
  const stderr = captureStderr();
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_key"));
    await assert.rejects(
      () => pollForToken(api, CODE, clock.sleep),
      (e: unknown) => {
        assert.match((e as Error).message, /couldn't reach the server/);
        return true;
      },
    );
    assert.match(stderr.text(), /can't reach the server/, "a sustained outage must surface a distinct warning, not silent waiting");
    // All 10 attempts (interval=1, expires_in=10) hit the network branch.
    assert.equal(fetchStub.calls(), 10);
  } finally {
    fetchStub.restore();
    clock.restore();
    stderr.restore();
  }
});

test("pollForToken: real authorization_pending (HttpError with body) times out with the generic message and no warning", async () => {
  const pending = () => jsonRes(400, { error: "authorization_pending" });
  const fetchStub = stubFetchSequence([pending]);
  const clock = fakeClock();
  const stderr = captureStderr();
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_key"));
    await assert.rejects(
      () => pollForToken(api, CODE, clock.sleep),
      (e: unknown) => {
        assert.equal((e as Error).message, "login timed out — run `aether auth login` again");
        return true;
      },
    );
    assert.equal(stderr.text(), "", "ordinary authorization_pending polling must never print the outage warning");
  } finally {
    fetchStub.restore();
    clock.restore();
    stderr.restore();
  }
});
