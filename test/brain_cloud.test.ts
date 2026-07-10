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

// Finding E's Tier-2/3 metrics (docs/specs/2026-07-10-workflow-viewer-agent-panel-design.md)
// must survive the REAL cloud path (SSE -> stream.ts's normalizeFrame -> here),
// not just brain_protocol.ts's separate NDJSON decoder — that decoder is never
// on this path (confirmed: CloudBrain maps StreamFrame, not raw NDJSON).
test("agent_done forwards optional tokens/toolCalls/durationMs from the SSE frame", async () => {
  const events = await runCloud([
    JSON.stringify({
      type: "agent_done", agent_id: "resolve:B", phase_n: 1, summary: "ok",
      tokens: 97600, tool_calls: 40, duration_ms: 266000,
    }),
    JSON.stringify({ type: "done", uvt: 1, cents: 0 }),
  ]);
  const done = events.find((e) => e.type === "agent_done");
  assert.ok(done && done.type === "agent_done");
  assert.equal(done.tokens, 97600);
  assert.equal(done.toolCalls, 40);
  assert.equal(done.durationMs, 266000);
});

test("agent_done leaves tokens/toolCalls/durationMs undefined when the SSE frame omits them", async () => {
  const events = await runCloud([
    JSON.stringify({ type: "agent_done", agent_id: "resolve:B", phase_n: 1, summary: "ok" }),
    JSON.stringify({ type: "done", uvt: 1, cents: 0 }),
  ]);
  const done = events.find((e) => e.type === "agent_done");
  assert.ok(done && done.type === "agent_done");
  assert.equal(done.tokens, undefined);
  assert.equal(done.toolCalls, undefined);
  assert.equal(done.durationMs, undefined);
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
