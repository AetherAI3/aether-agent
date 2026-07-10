import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { handleSlash } from "../src/commands/slash.js";
import { ApiClient } from "../src/core/transport.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import type { AppContext } from "../src/core/context.js";
import type { TokenStore } from "../src/core/auth.js";

class Capture extends Writable {
  private chunks: string[] = [];
  override _write(chunk: unknown, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    cb();
  }
  text(): string {
    return this.chunks.join("");
  }
}

const tokens = { get: async () => "aek_t" } as unknown as TokenStore;

test("a network-backed slash command's signal reaches fetch (so SIGINT can cancel it, not the session)", async () => {
  const captured: { signal?: AbortSignal | null } = {};
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    captured.signal = init?.signal;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ models: [], tier: "solo", default: "" }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    const ctx = {
      cfg: { ...DEFAULT_CONFIG },
      flags: {},
      tokens,
      api: new ApiClient("https://stub.test", tokens),
    } as unknown as AppContext;
    const ac = new AbortController();
    await handleSlash(ctx, "/tier", new Capture(), ac.signal);
    assert.equal(captured.signal, ac.signal);
  } finally {
    globalThis.fetch = real;
  }
});

// Platform behavior for an already-aborted signal reaching fetch() is proven
// generically in abort.test.ts (ApiClient.stream/postJson); this file only
// needs to prove handleSlash's OWN plumbing threads a signal through — which
// the test above does. (slash.ts caches the catalog for the process
// lifetime by design, so a second network-call assertion here would be
// order-dependent on other test files under --test-isolation=none.)
