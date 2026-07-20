// Regression tests for the "login succeeds but model-select throws HTTP 401"
// bug (PR #47). Three layers:
//   1. tokenStoreFromEnv: a fresh login must PERSIST even when AETHER_TOKEN is
//      injected — previously it vanished with the process, so every later run
//      re-read the stale env token and 401'd despite "✓ Logged in."
//   2. ApiClient: an expired session token gets ONE transparent /auth/refresh
//      + retry before the 401 surfaces. aek_ API keys never trigger refresh.
//   3. errorHint: 401 / 402 / 403 are distinct + the server's own detail
//      (e.g. a UVT-balance message) is surfaced instead of a bare "HTTP 401".
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tokenStoreFromEnv, FileTokenStore, StaticTokenStore } from "../src/core/auth.js";
import { ApiClient } from "../src/core/transport.js";
import { errorHint, HttpError } from "../src/core/errors.js";
import { hintFor } from "../src/core/error_hints.js";

function withTempConfigDir<T>(fn: () => Promise<T>): Promise<T> {
  const dir = join(tmpdir(), `aether-401-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const prev = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = dir;
  return fn().finally(() => {
    if (prev === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prev;
    rmSync(dir, { recursive: true, force: true });
  });
}

// ── 1. login persistence under AETHER_TOKEN ──────────────────────────────

test("tokenStoreFromEnv: set() persists a fresh login to disk even when AETHER_TOKEN is injected", () =>
  withTempConfigDir(async () => {
    const store = tokenStoreFromEnv({ AETHER_TOKEN: "stale_env_token" } as NodeJS.ProcessEnv);
    assert.equal(await store.get(), "stale_env_token");
    await store.set("aek_fresh_login");
    // Same process: the fresh token must win immediately…
    assert.equal(await store.get(), "aek_fresh_login");
    // …and a NEW process (fresh file store, no env token) must see it too.
    assert.equal(await new FileTokenStore().get(), "aek_fresh_login");
  }));

test("tokenStoreFromEnv: clear() signs out both the override and the disk store", () =>
  withTempConfigDir(async () => {
    const store = tokenStoreFromEnv({ AETHER_TOKEN: "envtok" } as NodeJS.ProcessEnv);
    await store.set("aek_x");
    await store.clear();
    assert.equal(await store.get(), null);
    assert.equal(await new FileTokenStore().get(), null);
  }));

// ── 2. transparent refresh-on-401 ────────────────────────────────────────

type Call = { url: string; init: RequestInit };

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response, calls: Call[]): void {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    return handler(u, init ?? {});
  }) as typeof globalThis.fetch;
}

function bearer(init: RequestInit): string {
  return (init.headers as Record<string, string>)["Authorization"] ?? "";
}

test("ApiClient: 401 with a session token triggers one /auth/refresh then a retry that succeeds", async () => {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  const store = new StaticTokenStore("sess_expired");
  stubFetch((url, init) => {
    if (url.endsWith("/auth/refresh")) return jsonRes(200, { session_token: "sess_fresh" });
    if (bearer(init) === "Bearer sess_fresh") return jsonRes(200, { models: [] });
    return jsonRes(401, { detail: "token expired" });
  }, calls);
  try {
    const api = new ApiClient("https://api.example", store);
    const out = await api.getJson<{ models: unknown[] }>("/models");
    assert.deepEqual(out, { models: [] });
    assert.equal(await store.get(), "sess_fresh", "refreshed token must be stored");
    const urls = calls.map((c) => c.url.replace("https://api.example", ""));
    assert.deepEqual(urls, ["/models", "/auth/refresh", "/models"]);
  } finally {
    globalThis.fetch = real;
  }
});

test("ApiClient: aek_ API keys never attempt refresh — the 401 surfaces directly", async () => {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  stubFetch(() => jsonRes(401, {}), calls);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_key"));
    await assert.rejects(() => api.getJson("/models"), (e: unknown) => (e as HttpError).status === 401);
    assert.equal(calls.length, 1, "no refresh call for API keys");
  } finally {
    globalThis.fetch = real;
  }
});

test("ApiClient: failed refresh surfaces the ORIGINAL 401 (no retry loop)", async () => {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  stubFetch((url) => (url.endsWith("/auth/refresh") ? jsonRes(401, {}) : jsonRes(401, { detail: "expired" })), calls);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("sess_dead"));
    await assert.rejects(() => api.getJson("/models"), (e: unknown) => (e as HttpError).status === 401);
    const urls = calls.map((c) => c.url.replace("https://api.example", ""));
    assert.deepEqual(urls, ["/models", "/auth/refresh"], "exactly one refresh attempt, no loop");
  } finally {
    globalThis.fetch = real;
  }
});

test("ApiClient: a 401 from /auth/* itself never recurses into refresh", async () => {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  stubFetch(() => jsonRes(401, {}), calls);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("sess_x"));
    await assert.rejects(() => api.postJson("/auth/refresh", {}));
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = real;
  }
});

// ── 3. error detail + distinct hints ─────────────────────────────────────

test("HttpError carries the server's detail/reason body text, not just 'HTTP 401'", async () => {
  const real = globalThis.fetch;
  stubFetch(() => jsonRes(401, { detail: "insufficient UVT balance" }), []);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_k"));
    await assert.rejects(
      () => api.getJson("/models"),
      (e: unknown) => /insufficient UVT balance/.test((e as Error).message),
    );
  } finally {
    globalThis.fetch = real;
  }
});

test("errorHint: 401, 402, 403 give distinct actionable hints", () => {
  const h401 = errorHint(new HttpError(401, "HTTP 401"), "https://x") ?? "";
  const h402 = errorHint(new HttpError(402, "HTTP 402"), "https://x") ?? "";
  const h403 = errorHint(new HttpError(403, "HTTP 403"), "https://x") ?? "";
  assert.match(h401, /aether auth login/);
  assert.match(h402, /UVT|balance/i);
  assert.match(h403, /plan|tier/i);
  assert.notEqual(h401, h403, "401 (re-auth) and 403 (plan) must not share one hint");
});

test("hintFor mirrors errorHint's 401/402/403 split for embedders", () => {
  assert.match(hintFor(new HttpError(401, "x")) ?? "", /aether auth login/);
  assert.match(hintFor(new HttpError(402, "x")) ?? "", /UVT|balance/i);
  assert.match(hintFor(new HttpError(403, "x")) ?? "", /plan|tier/i);
});

// ── 4. round-2 adversarial-review regressions ────────────────────────────

test("ApiClient: refresh is refused over insecure transport — token never leaves in cleartext", async () => {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  // No bearer attached (empty store at header time), then a token appears by
  // refresh time: previously this POSTed the session token over plain http.
  let first = true;
  const store: import("../src/core/auth.js").TokenStore = {
    async get() { const t = first ? null : "sess_late"; first = false; return t; },
    async set() {}, async clear() {},
  };
  stubFetch(() => jsonRes(401, {}), calls);
  try {
    const api = new ApiClient("http://evil.example.com", store);
    await assert.rejects(() => api.getJson("/models"));
    assert.ok(!calls.some((c) => c.url.includes("/auth/refresh")), "no refresh over insecure transport");
    assert.ok(calls.every((c) => !bearer(c.init)), "no bearer ever sent over http");
  } finally {
    globalThis.fetch = real;
  }
});

test("ApiClient: stream() also refreshes once on 401 and retries", async () => {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  const store = new StaticTokenStore("sess_old");
  stubFetch((url, init) => {
    if (url.endsWith("/auth/refresh")) return jsonRes(200, { session_token: "sess_new" });
    if (bearer(init) === "Bearer sess_new")
      return new Response("data: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    return jsonRes(401, {});
  }, calls);
  try {
    const api = new ApiClient("https://api.example", store);
    const stream = await api.stream("/agent/chat/stream", {});
    assert.ok(stream);
    const urls = calls.map((c) => c.url.replace("https://api.example", ""));
    assert.deepEqual(urls, ["/agent/chat/stream", "/auth/refresh", "/agent/chat/stream"]);
  } finally {
    globalThis.fetch = real;
  }
});

test("ApiClient: a straggler 401 after a concurrent rotation retries with the NEW token, no second refresh", async () => {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  // The store rotates BETWEEN this request's send (which reads sess_old) and
  // the refresh check — as when a concurrent request already refreshed. The
  // early-return in refreshSession must see current !== usedToken and signal
  // "retry" without POSTing /auth/refresh.
  let reads = 0;
  const store: import("../src/core/auth.js").TokenStore = {
    async get() { return reads++ === 0 ? "sess_old" : "sess_new"; },
    async set() { throw new Error("refresh must not run"); },
    async clear() {},
  };
  stubFetch((url, init) => {
    if (url.endsWith("/auth/refresh")) throw new Error("second refresh burned");
    return bearer(init) === "Bearer sess_new" ? jsonRes(200, { ok: true }) : jsonRes(401, {});
  }, calls);
  try {
    const api = new ApiClient("https://api.example", store);
    const out = await api.getJson<{ ok: boolean }>("/models");
    assert.deepEqual(out, { ok: true });
    assert.ok(!calls.some((c) => c.url.includes("/auth/refresh")), "no /auth/refresh call");
    assert.equal(calls.length, 2, "one failed send + one retry with the rotated token");
  } finally {
    globalThis.fetch = real;
  }
});

test("EnvOverrideTokenStore: update() (auto-refresh) swaps the active token WITHOUT touching disk", () =>
  withTempConfigDir(async () => {
    const disk = new FileTokenStore();
    await disk.set("disk_standalone_login");
    const store = tokenStoreFromEnv({ AETHER_TOKEN: "sess_embedded" } as NodeJS.ProcessEnv);
    await (store.update as (t: string) => Promise<void>)("sess_embedded_rotated");
    assert.equal(await store.get(), "sess_embedded_rotated", "active token rotated in-process");
    assert.equal(await disk.get(), "disk_standalone_login", "standalone on-disk login untouched");
  }));
