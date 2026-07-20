// Regression tests for two round-1 meta-loop findings on ApiClient.request()
// (backing getJson/postJson/deleteJson):
//
//   LOOP-01 / LOOP-06 — request() had NO timeout at all, unlike stream()'s
//   120s default. A silently-dropped connection to /models, /auth/refresh, or
//   the device-poll endpoint just hung forever. Now bounded by
//   AETHER_REQUEST_TIMEOUT_MS (default 30s, mirrors AETHER_STREAM_TIMEOUT_MS).
//
//   LOOP-06 — a malformed (non-empty, non-JSON) 2xx body used to silently
//   become `undefined as T`, so callers that trust T (slash.ts's getCatalog,
//   auth.ts's authRefresh) crashed one layer up with a raw property-access
//   TypeError instead of a coherent, hintable error. Now throws
//   MalformedResponseError. A genuinely EMPTY 2xx/204 body (e.g. deleteJson's
//   "No Content") is unaffected and still resolves to `undefined`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiClient,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEVICE_TOKEN_PATH,
  REFRESH_PATH,
  defaultRequestTimeoutMs,
} from "../src/core/transport.js";
import { StaticTokenStore } from "../src/core/auth.js";
import { MalformedResponseError, RequestTimeoutError, errorHint } from "../src/core/errors.js";
import { hintFor } from "../src/core/error_hints.js";

const ENV_KEY = "AETHER_REQUEST_TIMEOUT_MS";

function mockFetch(fn: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  return () => {
    globalThis.fetch = original;
  };
}

function setEnvTimeout(value: string | undefined): () => void {
  const original = process.env[ENV_KEY];
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  return () => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  };
}

// ── 1. bounded-by-default timeout ────────────────────────────────────────

test("ApiClient.getJson times out on a stalled connection instead of hanging forever", async () => {
  const restoreFetch = mockFetch((() => new Promise<Response>(() => {})) as typeof fetch);
  const restoreEnv = setEnvTimeout("5");
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    await assert.rejects(
      () => api.getJson("/models"),
      (err: unknown) => err instanceof RequestTimeoutError,
    );
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("ApiClient.postJson (used by device-poll and vault/workflow calls) times out on a stalled connection", async () => {
  // Mirrors device.ts's pollForToken -> api.postJson(DEVICE_TOKEN_PATH, ...)
  // call, which passes no signal at all — the exact call site the finding
  // named as sitting past its own deadline on a stalled fetch.
  const restoreFetch = mockFetch((() => new Promise<Response>(() => {})) as typeof fetch);
  const restoreEnv = setEnvTimeout("5");
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    await assert.rejects(
      () => api.postJson(DEVICE_TOKEN_PATH, { device_code: "dc" }),
      (err: unknown) => err instanceof RequestTimeoutError,
    );
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("ApiClient.getJson: an explicit caller AbortSignal still wins as AbortError, not RequestTimeoutError", async () => {
  const restoreFetch = mockFetch((() => new Promise<Response>(() => {})) as typeof fetch);
  const restoreEnv = setEnvTimeout("2000"); // long enough that the abort fires first
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    const controller = new AbortController();
    const pending = api.getJson("/models", controller.signal);
    controller.abort();
    await assert.rejects(
      () => pending,
      (err: unknown) => err instanceof Error && err.name === "AbortError",
    );
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("ApiClient.postJson: an explicit timeoutMs override widens the bound past a short AETHER_REQUEST_TIMEOUT_MS default (what CHAT_PATH's non-streaming fallback needs to survive a slow-but-healthy LLM turn)", async () => {
  const restoreEnv = setEnvTimeout("5"); // the metadata-call default alone would kill this call
  const restore = mockFetch((async () => {
    await new Promise((r) => setTimeout(r, 20));
    return new Response(JSON.stringify({ response: "ok" }), { status: 200 });
  }) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    const out = await api.postJson<{ response: string }>("/agent/chat", {}, undefined, 200);
    assert.deepEqual(out, { response: "ok" });
  } finally {
    restore();
    restoreEnv();
  }
});

test("ApiClient.postJson: an explicit SHORT timeoutMs override still times out even when AETHER_REQUEST_TIMEOUT_MS default is long", async () => {
  // Proves the per-call override REPLACES the default in both directions,
  // not just widens it.
  const restoreEnv = setEnvTimeout("60000");
  const restore = mockFetch((() => new Promise<Response>(() => {})) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    await assert.rejects(
      () => api.postJson("/agent/chat", {}, undefined, 5),
      (err: unknown) => err instanceof RequestTimeoutError,
    );
  } finally {
    restore();
    restoreEnv();
  }
});

test("defaultRequestTimeoutMs: unset env falls back to DEFAULT_REQUEST_TIMEOUT_MS", () => {
  const restore = setEnvTimeout(undefined);
  try {
    assert.equal(defaultRequestTimeoutMs(), DEFAULT_REQUEST_TIMEOUT_MS);
  } finally {
    restore();
  }
});

test("defaultRequestTimeoutMs: '0' means disabled, not the 30s default", () => {
  const restore = setEnvTimeout("0");
  try {
    assert.equal(defaultRequestTimeoutMs(), 0);
  } finally {
    restore();
  }
});

test("defaultRequestTimeoutMs: a valid positive override is honored", () => {
  const restore = setEnvTimeout("5000");
  try {
    assert.equal(defaultRequestTimeoutMs(), 5000);
  } finally {
    restore();
  }
});

test("defaultRequestTimeoutMs: invalid or negative values fall back to the default", () => {
  const restoreGarbage = setEnvTimeout("not-a-number");
  try {
    assert.equal(defaultRequestTimeoutMs(), DEFAULT_REQUEST_TIMEOUT_MS);
  } finally {
    restoreGarbage();
  }
  const restoreNegative = setEnvTimeout("-5");
  try {
    assert.equal(defaultRequestTimeoutMs(), DEFAULT_REQUEST_TIMEOUT_MS);
  } finally {
    restoreNegative();
  }
});

// ── 2. malformed-JSON 2xx body ────────────────────────────────────────────

test("ApiClient.getJson: a non-empty, non-JSON 2xx body throws MalformedResponseError instead of silently becoming undefined", async () => {
  const restore = mockFetch((async () => new Response("not json", { status: 200 })) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    await assert.rejects(
      () => api.getJson("/models"),
      (err: unknown) => err instanceof MalformedResponseError && (err as MalformedResponseError).status === 200,
    );
  } finally {
    restore();
  }
});

test("ApiClient.postJson: same malformed-body guard applies to POST (e.g. /auth/refresh)", async () => {
  const restore = mockFetch((async () => new Response("<html>not json</html>", { status: 200 })) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    await assert.rejects(
      () => api.postJson(REFRESH_PATH, {}),
      (err: unknown) => err instanceof MalformedResponseError,
    );
  } finally {
    restore();
  }
});

test("ApiClient.getJson: a body TRUNCATED mid-object (e.g. a dropped connection) throws MalformedResponseError, not silently undefined", async () => {
  // JSON.parse's error for truncated-but-nonempty input is the SAME
  // "Unexpected end of JSON input" message it gives for a genuinely empty
  // body -- classifying by that message text alone would misfile this exact
  // scenario (a connection dropped mid-response) as legitimate "no content"
  // and swallow it right back into `undefined`, defeating the fix. Reading
  // the raw text first and checking it's non-empty BEFORE parsing is what
  // tells the two apart.
  const restore = mockFetch(
    (async () => new Response('{"models":[{"id":"a"', { status: 200 })) as typeof fetch,
  );
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    await assert.rejects(
      () => api.getJson("/models"),
      (err: unknown) => err instanceof MalformedResponseError && (err as MalformedResponseError).status === 200,
    );
  } finally {
    restore();
  }
});

test("ApiClient.deleteJson: a genuinely EMPTY 2xx body (204 No Content) still resolves to undefined, no regression", async () => {
  const restore = mockFetch((async () => new Response(null, { status: 204 })) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    const out = await api.deleteJson("/vault/spaces/delete");
    assert.equal(out, undefined);
  } finally {
    restore();
  }
});

test("ApiClient.getJson: a well-formed JSON body still parses normally (no regression)", async () => {
  const restore = mockFetch(
    (async () => new Response(JSON.stringify({ models: [{ id: "a" }] }), { status: 200 })) as typeof fetch,
  );
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    const out = await api.getJson<{ models: unknown[] }>("/models");
    assert.deepEqual(out, { models: [{ id: "a" }] });
  } finally {
    restore();
  }
});

// ── 3. errorHint / hintFor recognize the new error types ─────────────────

test("errorHint and hintFor give an actionable hint for MalformedResponseError, not silence", () => {
  const err = new MalformedResponseError(200);
  assert.match(errorHint(err, "https://x") ?? "", /retry|doctor/i);
  assert.match(hintFor(err) ?? "", /retry|doctor/i);
});

test("errorHint and hintFor give an actionable hint for RequestTimeoutError, not silence", () => {
  const err = new RequestTimeoutError(30_000);
  assert.match(errorHint(err, "https://x") ?? "", /retry|doctor/i);
  assert.match(hintFor(err) ?? "", /retry|doctor/i);
});
