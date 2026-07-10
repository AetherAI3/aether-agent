import { test } from "node:test";
import assert from "node:assert/strict";
import { isAbortError } from "../src/core/errors.js";
import { ApiClient, CHAT_STREAM_PATH, CHAT_PATH } from "../src/core/transport.js";
import type { TokenStore } from "../src/core/auth.js";

test("isAbortError recognizes undici's two abort shapes", () => {
  const dom = new DOMException("This operation was aborted", "AbortError");
  assert.equal(isAbortError(dom), true);

  const wrapped = new TypeError("terminated");
  (wrapped as { cause?: unknown }).cause = new DOMException("aborted", "AbortError");
  assert.equal(isAbortError(wrapped), true);

  const message = new Error("The operation was aborted");
  assert.equal(isAbortError(message), true);

  assert.equal(isAbortError(new Error("HTTP 500")), false);
  assert.equal(isAbortError("aborted"), false);
});

const tokens = { get: async () => null } as unknown as TokenStore;

function stubFetch(capture: { signal?: AbortSignal | null }): typeof globalThis.fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    capture.signal = init?.signal;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ response: "ok" }),
      body: null,
    } as unknown as Response;
  }) as typeof globalThis.fetch;
}

test("the abort signal reaches fetch on the streaming leg", async () => {
  const capture: { signal?: AbortSignal | null } = {};
  const real = globalThis.fetch;
  globalThis.fetch = stubFetch(capture);
  try {
    const api = new ApiClient("https://example.test", tokens);
    const ac = new AbortController();
    // content-type json → StreamUnavailableError, but the signal was passed first.
    await assert.rejects(api.stream(CHAT_STREAM_PATH, {}, ac.signal));
    assert.equal(capture.signal, ac.signal);
  } finally {
    globalThis.fetch = real;
  }
});

test("the abort signal reaches fetch on the fallback leg too", async () => {
  const capture: { signal?: AbortSignal | null } = {};
  const real = globalThis.fetch;
  globalThis.fetch = stubFetch(capture);
  try {
    const api = new ApiClient("https://example.test", tokens);
    const ac = new AbortController();
    const r = await api.postJson<{ response: string }>(CHAT_PATH, {}, ac.signal);
    assert.equal(r.response, "ok");
    assert.equal(capture.signal, ac.signal);
  } finally {
    globalThis.fetch = real;
  }
});

test("an already-aborted signal rejects the fetch immediately", async () => {
  const real = globalThis.fetch;
  // Real fetch honors pre-aborted signals without touching the network.
  globalThis.fetch = ((url: unknown, init?: RequestInit) => real(url as RequestInfo, init)) as typeof globalThis.fetch;
  try {
    const api = new ApiClient("https://127.0.0.1:1", tokens);
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(api.postJson(CHAT_PATH, {}, ac.signal), (err: unknown) => isAbortError(err));
  } finally {
    globalThis.fetch = real;
  }
});
