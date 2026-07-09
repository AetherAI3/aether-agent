import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient, DEFAULT_STREAM_TIMEOUT_MS, defaultStreamTimeoutMs } from "../src/core/transport.js";
import { StaticTokenStore } from "../src/core/auth.js";
import { StreamTimeoutError } from "../src/core/errors.js";

const enc = new TextEncoder();
const ENV_KEY = "AETHER_STREAM_TIMEOUT_MS";

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

test("ApiClient.stream: an immediate caller abort wins over a short-fused idle timeout", async () => {
  // Regression guard: the original implementation funneled the caller's abort
  // and the internal timeout through one shared AbortController, so whichever
  // called .abort() first "won" the signal's reason -- a same-tick race could
  // misreport a real Ctrl+C as a StreamTimeoutError. A short timeoutMs puts
  // both in the same neighborhood of time; the caller's abort must still win.
  const restore = mockFetch((async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('data: {"type":"open"}\n\n'));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    const controller = new AbortController();
    const stream = await api.stream("/agent/chat/stream", {}, { signal: controller.signal, timeoutMs: 5 });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next(); // consume the one queued chunk
    const pending = iterator.next(); // now idling with the 5ms timer armed
    controller.abort(); // the user's real cancel, fired in the same tick
    await assert.rejects(
      () => pending,
      (err: unknown) => err instanceof Error && err.name === "AbortError",
    );
  } finally {
    restore();
  }
});

test("ApiClient.stream accepts a bare AbortSignal as the 3rd argument (chat.ts's call style)", async () => {
  const restore = mockFetch((async () => {
    const body = new ReadableStream<Uint8Array>();
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    const controller = new AbortController();
    const stream = await api.stream("/agent/chat/stream", {}, controller.signal); // bare signal, not { signal, timeoutMs }
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

test("ApiClient.stream with no 3rd argument at all still applies a timeout (brain_cloud.ts/client.ts/workflow.ts's call style)", async () => {
  const restore = mockFetch((() => new Promise<Response>(() => {})) as typeof fetch);
  const restoreEnv = setEnvTimeout("5");
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    await assert.rejects(
      () => api.stream("/agent/chat/stream", {}), // no 3rd argument at all
      (err: unknown) => err instanceof StreamTimeoutError,
    );
  } finally {
    restore();
    restoreEnv();
  }
});

test("defaultStreamTimeoutMs: unset env falls back to DEFAULT_STREAM_TIMEOUT_MS", () => {
  const restore = setEnvTimeout(undefined);
  try {
    assert.equal(defaultStreamTimeoutMs(), DEFAULT_STREAM_TIMEOUT_MS);
  } finally {
    restore();
  }
});

test("defaultStreamTimeoutMs: '0' means disabled, not the 120s default", () => {
  // Regression guard: normalizeTimeoutMs(0) is falsy, so a naive `|| DEFAULT`
  // fallback silently turned an explicit opt-out back into the 120s default.
  const restore = setEnvTimeout("0");
  try {
    assert.equal(defaultStreamTimeoutMs(), 0);
  } finally {
    restore();
  }
});

test("defaultStreamTimeoutMs: a valid positive override is honored", () => {
  const restore = setEnvTimeout("5000");
  try {
    assert.equal(defaultStreamTimeoutMs(), 5000);
  } finally {
    restore();
  }
});

test("defaultStreamTimeoutMs: invalid or negative values fall back to the default", () => {
  const restoreGarbage = setEnvTimeout("not-a-number");
  try {
    assert.equal(defaultStreamTimeoutMs(), DEFAULT_STREAM_TIMEOUT_MS);
  } finally {
    restoreGarbage();
  }
  const restoreNegative = setEnvTimeout("-5");
  try {
    assert.equal(defaultStreamTimeoutMs(), DEFAULT_STREAM_TIMEOUT_MS);
  } finally {
    restoreNegative();
  }
});

test("ApiClient.stream: cleanup after an aborted/timed-out stream never produces an unhandled rejection", async () => {
  // Regression guard: withIdleTimeout's finally() used to `void` the promise
  // returned by iterator.return() with only a synchronous try/catch around
  // it -- a real ReadableStream's return() rejects asynchronously when the
  // stream was aborted, which surfaced as an unhandled rejection (and, in the
  // interactive REPL, a process crash).
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", onRejection);
  try {
    const restore = mockFetch((async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode('data: {"type":"open"}\n\n'));
        },
        cancel() {
          // Mimic a real fetch() body: return()/cancel() after an abort rejects.
          return Promise.reject(new Error("simulated abort during cancel"));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch);
    try {
      const api = new ApiClient("https://api.example", new StaticTokenStore(""));
      const controller = new AbortController();
      const stream = await api.stream("/agent/chat/stream", {}, { signal: controller.signal, timeoutMs: 1000 });
      const iterator = stream[Symbol.asyncIterator]();
      await iterator.next();
      const pending = iterator.next();
      controller.abort();
      await assert.rejects(() => pending);
    } finally {
      restore();
    }
    // Give any stray unhandled rejection a turn to surface before asserting.
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(rejections, []);
  } finally {
    process.removeListener("unhandledRejection", onRejection);
  }
});
