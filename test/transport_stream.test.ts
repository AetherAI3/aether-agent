import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../src/core/transport.js";
import { StaticTokenStore } from "../src/core/auth.js";
import { StreamTimeoutError } from "../src/core/errors.js";

const enc = new TextEncoder();

function mockFetch(fn: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  return () => {
    globalThis.fetch = original;
  };
}

test("ApiClient.stream times out while opening a quiet stream", async () => {
  const restore = mockFetch((() => new Promise<Response>(() => {})) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    await assert.rejects(
      () => api.stream("/agent/chat/stream", {}, { timeoutMs: 5 }),
      (err: unknown) => err instanceof StreamTimeoutError,
    );
  } finally {
    restore();
  }
});

test("ApiClient.stream times out when the SSE body goes quiet", async () => {
  const restore = mockFetch((async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('data: {"type":"open"}\n\n'));
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    const stream = await api.stream("/agent/chat/stream", {}, { timeoutMs: 5 });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.equal(first.done, false);
    await assert.rejects(
      () => iterator.next(),
      (err: unknown) => err instanceof StreamTimeoutError,
    );
  } finally {
    restore();
  }
});

test("ApiClient.stream preserves caller aborts as AbortError", async () => {
  const restore = mockFetch((async () => {
    const body = new ReadableStream<Uint8Array>();
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    const controller = new AbortController();
    const stream = await api.stream("/agent/chat/stream", {}, {
      signal: controller.signal,
      timeoutMs: 1000,
    });
    const iterator = stream[Symbol.asyncIterator]();
    const pending = iterator.next();
    controller.abort();
    await assert.rejects(
      () => pending,
      (err: unknown) => err instanceof Error && err.name === "AbortError",
    );
  } finally {
    restore();
  }
});
