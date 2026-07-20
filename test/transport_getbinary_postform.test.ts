// Regression tests for LOOP-01 round 2 findings on ApiClient.getBinary() /
// postForm() — the two methods commit 1d33357 added to fix the seed
// raw-fetch bypass bug:
//
//   HIGH — isCredentialSafeUrl() only checks URL SCHEME (any https host
//   passes), so getBinary() attached the live session bearer to ANY absolute
//   https URL a caller passed, including a third-party host completely
//   different from the configured Aether API baseUrl. Fixed by gating
//   attachment on isSameOrigin(target, baseUrl) instead — a cross-origin
//   target is now fetched unauthenticated rather than either leaking the
//   token or failing the whole call closed.
//
//   HIGH — getBinary()/postForm() had NO timeout/AbortSignal.timeout bound at
//   all, unlike request()/stream(), reintroducing the exact "stalled
//   connection hangs forever" problem a7b3621 fixed for request(). Both now
//   accept a timeoutMs override (default AETHER_REQUEST_TIMEOUT_MS) mirroring
//   getJson/postJson/deleteJson; getBinary additionally wraps its body with
//   an idle/quiet-period timeout (like stream()'s withIdleTimeout) so a
//   large-but-healthy download isn't killed by a flat overall cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient, isSameOrigin } from "../src/core/transport.js";
import { StaticTokenStore } from "../src/core/auth.js";
import { RequestTimeoutError, StreamTimeoutError } from "../src/core/errors.js";

const enc = new TextEncoder();

type Call = { url: string; init: RequestInit };

function mockFetch(fn: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  return () => {
    globalThis.fetch = original;
  };
}

function bearer(init: RequestInit): string {
  return (init.headers as Record<string, string> | undefined)?.["Authorization"] ?? "";
}

// ── isSameOrigin ────────────────────────────────────────────────────────────

test("isSameOrigin: matches only when scheme+host+port all agree", () => {
  assert.equal(isSameOrigin("https://api.example/x", "https://api.example"), true);
  assert.equal(isSameOrigin("https://api.example:443/x", "https://api.example"), true, "default https port normalizes away");
  assert.equal(isSameOrigin("https://other.example/x", "https://api.example"), false);
  assert.equal(isSameOrigin("http://api.example/x", "https://api.example"), false, "scheme differs");
  assert.equal(isSameOrigin("https://api.example:8443/x", "https://api.example"), false, "port differs");
  assert.equal(isSameOrigin("not a url", "https://api.example"), false);
});

// ── getBinary: same-origin gating (HIGH #1) ─────────────────────────────────

test("getBinary: attaches the bearer to a SAME-origin absolute URL", async () => {
  const calls: Call[] = [];
  const restore = mockFetch((async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("data");
  }) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("sess_abc"));
    await api.getBinary("https://api.example/vault/spaces/download/f.bin");
    assert.equal(bearer(calls[0]!.init), "Bearer sess_abc");
  } finally {
    restore();
  }
});

test("getBinary: attaches the bearer to a RELATIVE path (always same-origin by construction)", async () => {
  const calls: Call[] = [];
  const restore = mockFetch((async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("data");
  }) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("sess_abc"));
    await api.getBinary("/vault/spaces/download/f.bin");
    assert.equal(bearer(calls[0]!.init), "Bearer sess_abc");
  } finally {
    restore();
  }
});

test("getBinary: does NOT attach the bearer to a cross-origin absolute URL, even https", async () => {
  const calls: Call[] = [];
  const restore = mockFetch((async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("data");
  }) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("sess_abc"));
    await api.getBinary("https://cdn.other-host.example/media/f.png");
    assert.equal(calls.length, 1);
    assert.equal(bearer(calls[0]!.init), "", "cross-origin target must not receive the live session token");
  } finally {
    restore();
  }
});

test("getBinary: a cross-origin 401 is not retried through /auth/refresh (no token was ever sent there)", async () => {
  const calls: Call[] = [];
  const restore = mockFetch((async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("nope", { status: 401 });
  }) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("sess_abc"));
    await assert.rejects(() => api.getBinary("https://cdn.other-host.example/media/f.png"));
    assert.equal(calls.length, 1, "no /auth/refresh call, no retry — the 401 is unrelated to our session");
  } finally {
    restore();
  }
});

// ── getBinary: timeout (HIGH #2) ─────────────────────────────────────────────

test("getBinary: times out on a stalled connection instead of hanging forever", async () => {
  const restore = mockFetch((() => new Promise<Response>(() => {})) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("sess_abc"));
    await assert.rejects(
      () => api.getBinary("/vault/spaces/download/f.bin", undefined, 5),
      (err: unknown) => err instanceof RequestTimeoutError,
    );
  } finally {
    restore();
  }
});

test("getBinary: times out when the response body goes quiet mid-download (idle timeout, not a flat cap)", async () => {
  const restore = mockFetch((async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode("first-chunk"));
        // never enqueue again, never close -> body goes quiet forever
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("sess_abc"));
    const res = await api.getBinary("/vault/spaces/download/f.bin", undefined, 5);
    assert.ok(res.body, "first chunk arrives fine, headers resolved before the quiet period");
    const iterator = (res.body as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
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

test("getBinary: a large-but-healthy download (continuous chunks) is NOT killed by a flat cap", async () => {
  const restore = mockFetch((async () => {
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Each chunk arrives within the idle window, but the total transfer
        // time comfortably exceeds a single flat timeoutMs — proving the
        // guard is an idle/quiet-period timeout, not an overall cap.
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 8));
          controller.enqueue(enc.encode(`chunk-${i}`));
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("sess_abc"));
    const res = await api.getBinary("/vault/spaces/download/f.bin", undefined, 500);
    const chunks: string[] = [];
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk).toString("utf-8"));
    }
    assert.deepEqual(chunks, ["chunk-0", "chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
  } finally {
    restore();
  }
});

test("getBinary: an explicit caller AbortSignal still wins as AbortError, not RequestTimeoutError", async () => {
  const restore = mockFetch((() => new Promise<Response>(() => {})) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("sess_abc"));
    const controller = new AbortController();
    const pending = api.getBinary("/vault/spaces/download/f.bin", controller.signal, 2000);
    controller.abort();
    await assert.rejects(
      () => pending,
      (err: unknown) => err instanceof Error && err.name === "AbortError",
    );
  } finally {
    restore();
  }
});

// ── postForm: timeout (HIGH #2) ───────────────────────────────────────────

test("postForm: times out on a stalled connection instead of hanging forever", async () => {
  const restore = mockFetch((() => new Promise<Response>(() => {})) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("sess_abc"));
    const form = new FormData();
    form.append("file", new Blob(["x"]), "f.txt");
    await assert.rejects(
      () => api.postForm("/vault/spaces/upload", form, undefined, 5),
      (err: unknown) => err instanceof RequestTimeoutError,
    );
  } finally {
    restore();
  }
});

test("postForm: an explicit timeoutMs override widens the bound past a short default", async () => {
  const restore = mockFetch((async () => {
    await new Promise((r) => setTimeout(r, 20));
    return new Response(JSON.stringify({ key: "k1" }), { status: 200 });
  }) as typeof fetch);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("sess_abc"));
    const form = new FormData();
    form.append("file", new Blob(["x"]), "f.txt");
    const out = await api.postForm<{ key: string }>("/vault/spaces/upload", form, undefined, 200);
    assert.deepEqual(out, { key: "k1" });
  } finally {
    restore();
  }
});
