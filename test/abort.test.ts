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
    // Note: stream() wires the caller's signal to its OWN internal `net`
    // AbortController rather than passing `ac.signal` straight through to
    // fetch — timeout and user-abort are raced as two independent promises
    // (see transport.ts's `raceAgainst`) so a timeout can never be mistaken
    // for the user's own Ctrl+C. So we assert the behavioral guarantee
    // (aborting the caller's controller aborts whatever signal fetch got),
    // not reference identity of the AbortSignal object — see
    // transport_stream.test.ts for full coverage of that abort-racing design.
    await assert.rejects(api.stream(CHAT_STREAM_PATH, {}, ac.signal));
    assert.ok(capture.signal, "fetch should have received a signal");
    ac.abort();
    assert.equal(capture.signal?.aborted, true);
  } finally {
    globalThis.fetch = real;
  }
});

test("the abort signal reaches fetch on the fallback leg too", async () => {
  const capture: { signal?: AbortSignal | null } = {};
  const real = globalThis.fetch;
  // Hangs (rather than resolving immediately) so there's a genuine in-flight
  // window to abort during — request()'s internal `net` controller is only
  // wired to the caller's abort event while the call is still pending; once
  // it settles, that listener is already detached (see request()'s finally).
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    capture.signal = init?.signal;
    return new Promise<Response>(() => {});
  }) as typeof globalThis.fetch;
  try {
    const api = new ApiClient("https://example.test", tokens);
    const ac = new AbortController();
    const pending = api.postJson<{ response: string }>(CHAT_PATH, {}, ac.signal);
    ac.abort();
    await assert.rejects(pending, (err: unknown) => isAbortError(err));
    // request() (LOOP-01/LOOP-06 round-1: bounded-by-default timeout) now
    // wires the caller's signal to its OWN internal `net` AbortController,
    // same reasoning as the streaming leg above — so we assert the
    // behavioral guarantee (aborting the caller's controller aborts whatever
    // signal fetch got), not reference identity.
    assert.ok(capture.signal, "fetch should have received a signal");
    assert.equal(capture.signal?.aborted, true);
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
