import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CloudBrain } from "../src/core/brain_cloud.js";
import { ApiClient } from "../src/core/transport.js";
import type { BrainEvent } from "../src/core/brain_protocol.js";
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

async function runCloud(events: string[]): Promise<BrainEvent[]> {
  const real = globalThis.fetch;
  globalThis.fetch = sseFetch(events);
  try {
    const brain = new CloudBrain(new ApiClient("https://stub.test", tokens));
    const out: BrainEvent[] = [];
    for await (const ev of brain.run({ type: "task", text: "t", cwd: ".", poolGb: 5 })) out.push(ev);
    return out;
  } finally {
    globalThis.fetch = real;
  }
}

test("a streamed error frame ends the cloud run done ok:false (never fabricated success)", async () => {
  const events = await runCloud([
    JSON.stringify({ type: "delta", text: "partial" }),
    JSON.stringify({ type: "error", msg: "UVT limit exceeded" }),
  ]);
  const done = events.find((e) => e.type === "done");
  assert.ok(done && done.type === "done");
  assert.equal(done.ok, false);
  assert.equal(done.result, "UVT limit exceeded");
});

test("a clean stream still ends done ok:true", async () => {
  const events = await runCloud([
    JSON.stringify({ type: "delta", text: "all good" }),
    JSON.stringify({ type: "done", uvt: 1, cents: 0 }),
  ]);
  const done = events.find((e) => e.type === "done");
  assert.ok(done && done.type === "done" && done.ok === true);
});

test("custody frames on the cloud code path persist to the client-held log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-custody-"));
  const prev = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = dir;
  try {
    await runCloud([
      JSON.stringify({ type: "custody", custody: { order_id: "code_run_1", commitment_hash: "abc" } }),
      JSON.stringify({ type: "done", uvt: 1, cents: 0 }),
    ]);
    const file = join(dir, "custody.jsonl");
    assert.ok(existsSync(file), "custody.jsonl was not written");
    assert.match(readFileSync(file, "utf8"), /code_run_1/);
  } finally {
    if (prev === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
