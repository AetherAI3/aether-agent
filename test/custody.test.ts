import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { appendCustody, normalizeCustodyRecord, readCustodyLog } from "../src/core/custody.js";

function tempLog(): string {
  return join(mkdtempSync(join(tmpdir(), "aether-custody-safe-")), "custody.jsonl");
}

test("custody persistence accepts only the closed signed receipt shape", () => {
  const path = tempLog();
  appendCustody({
    protocol: "protocol-c",
    order_id: "chat_abc-123",
    commitment: { record: { prompt_sha256: "a".repeat(64) }, signature: { ed25519: "proof" } },
    attestation: { env_hash: "b".repeat(64) },
  }, path);
  assert.equal(readCustodyLog(10, path).length, 1);
  assert.equal(readCustodyLog(10, path)[0]?.order_id, "chat_abc-123");
});

test("custody persistence rejects secret-shaped, oversized, controlled, and open-ended records", () => {
  for (const record of [
    { order_id: "chat_secret", commitment: { note: "sk-SYNTHETIC123456" } },
    { order_id: "chat_big", commitment: { note: "x".repeat(70 * 1024) } },
    { order_id: "chat_control", commitment: { note: "safe\u001b]52;c;owned\u0007" } },
    { order_id: "chat_extra", arbitrary: "not in the contract" },
    { order_id: "chat_key", commitment: { api_token: "synthetic" } },
  ]) {
    const path = tempLog();
    appendCustody(record, path);
    assert.equal(existsSync(path), false, `invalid record must not be written: ${record.order_id}`);
  }
});

test("custody reads filter legacy malicious lines instead of re-emitting them", () => {
  const path = tempLog();
  writeFileSync(
    path,
    [
      JSON.stringify({ order_id: "chat_ok", commitment_hash: "abc", received_at: 1 }),
      JSON.stringify({ order_id: "chat_bad", commitment: { password: "SYNTHETIC" }, received_at: 2 }),
    ].join("\n") + "\n",
    "utf8",
  );
  assert.deepEqual(readCustodyLog(10, path).map((entry) => entry.order_id), ["chat_ok"]);
  assert.match(readFileSync(path, "utf8"), /chat_bad/, "read filtering is non-destructive");
});

test("normalizer refuses invalid ids and cyclic or non-plain proof objects", () => {
  assert.equal(normalizeCustodyRecord({ order_id: "bad id" }), null);
  assert.equal(normalizeCustodyRecord({ order_id: "ok", commitment: new Date() }), null);
  const cyclic: Record<string, unknown> = {};
  cyclic["self"] = cyclic;
  assert.equal(normalizeCustodyRecord({ order_id: "ok", commitment: cyclic }), null);
});
