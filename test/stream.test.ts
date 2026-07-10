import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSse, normalizeFrame, parseEvent } from "../src/core/stream.js";

test("normalizeFrame done maps token fields and carries no signature", () => {
  const f = normalizeFrame({
    type: "done",
    uvt: 12,
    cents: 3.4,
    input_tokens: 100,
    output_tokens: 50,
  });
  assert.deepEqual(f, {
    type: "done",
    uvt: 12,
    cents: 3.4,
    inputTokens: 100,
    outputTokens: 50,
  });
});

test("normalizeFrame error uses contract keys msg/error_code/ref_id", () => {
  const f = normalizeFrame({ type: "error", msg: "boom", error_code: "E42", ref_id: "r1" });
  assert.deepEqual(f, { type: "error", msg: "boom", errorCode: "E42", refId: "r1" });
});

test("normalizeFrame surfaces the custody frame (client decides to save)", () => {
  const custody = {
    protocol: "custody-1",
    order_id: "chat_abc",
    commitment: { record: {}, signature: { ed25519: "deadbeef" } },
    attestation: { record: {}, env_hash: "f00d" },
  };
  const f = normalizeFrame({ type: "custody", custody });
  assert.deepEqual(f, { type: "custody", custody });
});

test("normalizeFrame supports ping/reasoning/open liveness frames", () => {
  assert.deepEqual(normalizeFrame({ type: "ping" }), { type: "ping" });
  assert.deepEqual(normalizeFrame({ type: "open" }), { type: "open" });
  assert.deepEqual(normalizeFrame({ type: "reasoning", text: "hmm" }), {
    type: "reasoning",
    text: "hmm",
  });
});

test("normalizeFrame task_progress maps task_id + intra-task fields", () => {
  const f = normalizeFrame({ type: "task_progress", task_id: "t9", delta: "x", uvt: 5, cents: 0.1 });
  assert.deepEqual(f, { type: "task_progress", taskId: "t9", delta: "x", uvt: 5, cents: 0.1 });
});

test("normalizeFrame returns null for unknown type (ignored per contract)", () => {
  assert.equal(normalizeFrame({ type: "heartbeat" }), null);
  assert.equal(normalizeFrame({ no: "type" }), null);
});

test("parseEvent skips comment lines incl the CF-flush preamble", () => {
  assert.equal(parseEvent(":" + " ".repeat(4096)), null);
  const raw = ': keepalive\ndata: {"type":"delta","text":"hi"}';
  assert.deepEqual(parseEvent(raw), { type: "delta", text: "hi" });
});

test("parseEvent ignores [DONE] sentinel and bad JSON", () => {
  assert.equal(parseEvent("data: [DONE]"), null);
  assert.equal(parseEvent("data: {bad"), null);
});

test("decodeSse yields frames split on blank lines", async () => {
  async function* bytes(): AsyncGenerator<Uint8Array> {
    const enc = new TextEncoder();
    yield enc.encode('data: {"type":"open"}\n\n');
    yield enc.encode('data: {"type":"delta","text":"a"}\n\n');
    yield enc.encode('data: {"type":"done","uvt":2,"cents":0.2}\n\n');
  }
  const frames = [];
  for await (const f of decodeSse(bytes())) frames.push(f);
  assert.equal(frames.length, 3);
  assert.equal(frames[0]?.type, "open");
  assert.equal(frames[2]?.type, "done");
});

test("decodeSse handles CRLF servers, including a CRLF split across chunks", async () => {
  async function* bytes(): AsyncGenerator<Uint8Array> {
    const enc = new TextEncoder();
    yield enc.encode('data: {"type":"delta","text":"a"}\r\n\r\n');
    // Split the CRLF pair across a chunk boundary.
    yield enc.encode('data: {"type":"delta","text":"b"}\r');
    yield enc.encode('\n\r\ndata: {"type":"done","uvt":1,"cents":0}\r\n\r\n');
  }
  const frames = [];
  for await (const f of decodeSse(bytes())) frames.push(f);
  assert.equal(frames.length, 3);
  assert.deepEqual(frames[0], { type: "delta", text: "a" });
  assert.deepEqual(frames[1], { type: "delta", text: "b" });
  assert.equal(frames[2]?.type, "done");
});

test("decodeSse handles a frame split across chunks", async () => {
  async function* bytes(): AsyncGenerator<Uint8Array> {
    const enc = new TextEncoder();
    yield enc.encode('data: {"type":"del');
    yield enc.encode('ta","text":"split"}\n\n');
  }
  const frames = [];
  for await (const f of decodeSse(bytes())) frames.push(f);
  assert.deepEqual(frames, [{ type: "delta", text: "split" }]);
});
