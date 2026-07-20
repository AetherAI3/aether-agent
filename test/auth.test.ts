import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isApiToken } from "../src/commands/auth.js";
import { FileTokenStore, StaticTokenStore, loginWithPassword } from "../src/core/auth.js";

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
