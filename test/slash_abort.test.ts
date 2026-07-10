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
      json: async () => ({ entries: [], count: 0 }),
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
    // /audit (fetchTrail) always calls api.getJson fresh — unlike /tier, it is
    // never served from slash.ts's process-lifetime models/orchestrators
    // catalog cache, so this assertion can't be defeated by an earlier test
    // (e.g. "/model switch...") having already warmed that cache under
    // --test-isolation=none.
    await handleSlash(ctx, "/audit", new Capture(), ac.signal);
    assert.equal(captured.signal, ac.signal);
  } finally {
    globalThis.fetch = real;
  }
});

// Platform behavior for an already-aborted signal reaching fetch() is proven
// generically in abort.test.ts (ApiClient.stream/postJson); this file only
// needs to prove handleSlash's OWN plumbing threads a signal through — which
// the test above does.
