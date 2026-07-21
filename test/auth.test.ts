import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isApiToken } from "../src/commands/auth.js";
import { FileTokenStore, StaticTokenStore, loginWithPassword, isApiKeyToken } from "../src/core/auth.js";

const REQUEST_TIMEOUT_ENV_KEY = "AETHER_REQUEST_TIMEOUT_MS";

function setRequestTimeoutMs(value: string | undefined): () => void {
  const original = process.env[REQUEST_TIMEOUT_ENV_KEY];
  if (value === undefined) delete process.env[REQUEST_TIMEOUT_ENV_KEY];
  else process.env[REQUEST_TIMEOUT_ENV_KEY] = value;
  return () => {
    if (original === undefined) delete process.env[REQUEST_TIMEOUT_ENV_KEY];
    else process.env[REQUEST_TIMEOUT_ENV_KEY] = original;
  };
}

/** A fetch stub that honors the caller's AbortSignal like a real fetch would
 *  (rejecting when it fires) but otherwise never settles — mirrors a
 *  silently-dropped connection to /auth/login. */
function hangingFetchHonoringAbort(): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // never settles
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }) as typeof fetch;
}

test("isApiToken detects an aek_ API token vs a session token", () => {
  assert.equal(isApiToken("aek_abc123"), true);
  assert.equal(isApiToken("sess-xyz"), false);
  assert.equal(isApiToken(null), false);
  assert.equal(isApiToken(undefined), false);
  assert.equal(isApiToken(""), false);
});

// LOOP-01 round 2 (LOW): the aek_ prefix check used to be hand-duplicated in
// commands/auth.ts's isApiToken AND transport.ts's refreshSession. Both now
// delegate to this one canonical core/auth.ts export — test it directly (not
// just transitively through isApiToken above) so a regression in the shared
// definition can't hide behind commands/auth.ts's wrapper alone.
test("isApiKeyToken (the canonical core/auth.ts definition shared by commands/auth.ts's isApiToken and transport.ts's refreshSession) detects the aek_ prefix", () => {
  assert.equal(isApiKeyToken("aek_abc123"), true);
  assert.equal(isApiKeyToken("sess-xyz"), false);
  assert.equal(isApiKeyToken(null), false);
  assert.equal(isApiKeyToken(undefined), false);
  assert.equal(isApiKeyToken(""), false);
  // isApiToken is a thin wrapper — the two must never drift apart.
  assert.equal(isApiToken("aek_abc123"), isApiKeyToken("aek_abc123"));
});

test("FileTokenStore writes the token owner-only (0600) and round-trips", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-tok-"));
  const prev = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = dir;
  try {
    const store = new FileTokenStore();
    await store.set("aek_synthetic");
    const path = join(dir, ".token");
    assert.equal(existsSync(path), true);
    assert.equal(readFileSync(path, "utf8"), "aek_synthetic");
    assert.equal(await store.get(), "aek_synthetic");
    // POSIX permission bits are not meaningful on Windows filesystems.
    if (process.platform !== "win32") {
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
    await store.clear();
    assert.equal(existsSync(path), false);
  } finally {
    if (prev === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── LOOP-01 round-1 regression: loginWithPassword must not hang forever ──
// on a stalled /auth/login response. This is the headless `--username/
// --password` flow (login.ts), explicitly meant for CI/scripts, and it's a
// raw fetch() with no ApiClient behind it — so it needs its own bound rather
// than inheriting request()'s.
test("loginWithPassword: a stalled /auth/login response times out instead of hanging the headless login forever", async () => {
  const realFetch = globalThis.fetch;
  const restoreEnv = setRequestTimeoutMs("5");
  globalThis.fetch = hangingFetchHonoringAbort();
  try {
    await assert.rejects(() =>
      loginWithPassword("https://api.example", new StaticTokenStore(""), {
        username: "u",
        password: "p",
      }),
    );
  } finally {
    globalThis.fetch = realFetch;
    restoreEnv();
  }
});

// ── LOOP-06 round 2: a malicious `reason` field must not survive raw ──
// into the thrown Error's message. login.ts's headless `--username/
// --password` catch writes err.message straight to process.stderr with no
// sanitization of its own, so this field is the last line of defense against
// a compromised/misconfigured backend (or a self-hosted dev server) smuggling
// terminal escape sequences — including OSC 52 clipboard-hijack payloads —
// into the user's terminal.
test("loginWithPassword: a malicious `reason` field is stripped of control chars and length-capped before it reaches the thrown Error's message", async () => {
  const realFetch = globalThis.fetch;
  // Raw ESC byte + an OSC-style clipboard-hijack-shaped payload + padding well
  // past the 200-char cap this mirrors from toHttpError's sanitizeServerText.
  const evilReason = "\x1b]52;c;ZXZpbA==\x07" + "A".repeat(300);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ authenticated: false, reason: evilReason }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await assert.rejects(
      () => loginWithPassword("https://api.example", new StaticTokenStore(""), { username: "u", password: "p" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = err.message;
        assert.ok(!msg.includes("\x1b"), "raw ESC byte must never survive into the message");
        assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(msg), "no other C0/C1 control bytes may survive either");
        assert.ok(msg.length < 250, `message must be length-capped, got ${msg.length} chars`);
        assert.match(msg, /^login failed: /);
        return true;
      },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("loginWithPassword: a non-string `reason` (e.g. a compromised server sending an object/number) falls back to the HTTP status instead of leaking it verbatim", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ authenticated: false, reason: { evil: "\x1b[31mpayload" } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await assert.rejects(
      () => loginWithPassword("https://api.example", new StaticTokenStore(""), { username: "u", password: "p" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "login failed: HTTP 403");
        return true;
      },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── LOOP-06 round 2 (advisor follow-up): the SUCCESS path carries the same
// hazard — login.ts:74 writes `plan` straight to stdout
// (`✓ Logged in (plan: ${r.plan}).`) with no sanitization of its own.
test("loginWithPassword: a malicious `plan`/`commitment_hash` on a SUCCESSFUL login is sanitized before it reaches the caller", async () => {
  const realFetch = globalThis.fetch;
  const evilPlan = "\x1b]52;c;ZXZpbA==\x07pro" + "C".repeat(300);
  const evilHash = "\x1b[31mhash" + "D".repeat(300);
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        authenticated: true,
        session_token: "sess_ok",
        plan: evilPlan,
        commitment_hash: evilHash,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  try {
    const result = await loginWithPassword("https://api.example", new StaticTokenStore(""), {
      username: "u",
      password: "p",
    });
    assert.ok(result.plan);
    assert.ok(!result.plan!.includes("\x1b"), "raw ESC byte must never survive in `plan`");
    assert.ok(result.plan!.length < 210, `plan must be length-capped, got ${result.plan!.length} chars`);
    assert.ok(result.commitmentHash);
    assert.ok(!result.commitmentHash!.includes("\x1b"), "raw ESC byte must never survive in `commitmentHash`");
    assert.ok(
      result.commitmentHash!.length < 210,
      `commitmentHash must be length-capped, got ${result.commitmentHash!.length} chars`,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("loginWithPassword: AETHER_REQUEST_TIMEOUT_MS=0 disables the timeout (no AbortSignal attached)", async () => {
  const realFetch = globalThis.fetch;
  const restoreEnv = setRequestTimeoutMs("0");
  let sawSignal = false;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sawSignal = init?.signal != null;
    return new Response(JSON.stringify({ authenticated: true, session_token: "sess_x" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const store = new StaticTokenStore("");
    const result = await loginWithPassword("https://api.example", store, { username: "u", password: "p" });
    assert.ok(result);
    assert.equal(sawSignal, false, "0 means disabled — no AbortSignal.timeout(0), which would abort immediately");
    assert.equal(await store.get(), "sess_x");
  } finally {
    globalThis.fetch = realFetch;
    restoreEnv();
  }
});
