import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../src/commands/chat.js";
import { ApiClient } from "../src/core/transport.js";
import type { AppContext } from "../src/core/context.js";
import type { TokenStore } from "../src/core/auth.js";

const tokens = { get: async () => "aek_t" } as unknown as TokenStore;

function sseFetch(events: string[]): typeof globalThis.fetch {
  const body = events.map((e) => `data: ${e}\n\n`).join("");
  return (async () => {
    const bytes = new TextEncoder().encode(body);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: (async function* (): AsyncIterable<Uint8Array> {
        yield bytes;
      })(),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
}

function ctxWith(events: string[]): AppContext {
  return {
    cfg: { baseUrl: "https://stub.test", defaultModel: "", permissionMode: "ask", autoApply: false, telemetry: false, defaultEffort: "" },
    flags: { json: true, audit: false, yes: false, cwd: "." }, // json:true keeps stdout output quiet
    tokens,
    api: new ApiClient("https://stub.test", tokens),
  } as unknown as AppContext;
}

test("runTurn returns false when the server streams an error frame (was: always true)", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = sseFetch([
    JSON.stringify({ type: "delta", text: "partial" }),
    JSON.stringify({ type: "error", msg: "rate limited" }),
  ]);
  try {
    const ok = await runTurn(ctxWith([]), "hi");
    assert.equal(ok, false);
  } finally {
    globalThis.fetch = real;
  }
});

test("runTurn returns true on a clean stream", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = sseFetch([
    JSON.stringify({ type: "delta", text: "ok" }),
    JSON.stringify({ type: "done", uvt: 1, cents: 0 }),
  ]);
  try {
    const ok = await runTurn(ctxWith([]), "hi");
    assert.equal(ok, true);
  } finally {
    globalThis.fetch = real;
  }
});
