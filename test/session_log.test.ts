import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionLog, monologueLine } from "../src/core/session_log.js";

const TS = "2026-06-04T08:30:00.000Z";

test("SessionLog writes events.jsonl, monologue.txt, and a manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "aether-log-"));
  try {
    const log = new SessionLog(
      { task: "fix tests", model: "qwen3-coder:30b", poolGb: 5, brain: "local" },
      TS,
      root,
    );
    log.event({ type: "stage", name: "execute", face: "x" }, TS);
    log.event({ type: "skill", name: "fix-failing-tests", reason: "trigger matched" }, TS);
    log.event({ type: "tool_call", id: "c1", name: "run_tests", args: {} }, TS);
    log.toolResult("c1", { output: "[exit 0]\nok", exitCode: 0 }, TS);
    log.event({ type: "checkpoint", gitSha: "a1b2c3d4e5" }, TS);
    log.event({ type: "done", ok: true, result: "all green", remaining: 0, reason: "" }, TS);
    log.close("ok", TS);

    // events.jsonl: one JSON object per line, ts stamped, tool_result recorded
    const lines = readFileSync(join(log.dir, "events.jsonl"), "utf8").trim().split("\n");
    const types = lines.map((l) => JSON.parse(l).type);
    assert.deepEqual(types, ["stage", "skill", "tool_call", "tool_result", "checkpoint", "done"]);
    assert.equal(JSON.parse(lines[0]!).ts, TS);

    // manifest: finalized with counts + status
    const manifest = JSON.parse(readFileSync(join(log.dir, "manifest.json"), "utf8"));
    assert.equal(manifest.task, "fix tests");
    assert.equal(manifest.brain, "local");
    assert.equal(manifest.finalStatus, "ok");
    assert.equal(manifest.toolCalls, 1);
    assert.equal(manifest.started, TS);
    assert.equal(manifest.ended, TS);

    // monologue: human-readable, no status/telemetry noise
    const mono = readFileSync(join(log.dir, "monologue.txt"), "utf8");
    assert.match(mono, /\* execute/);
    assert.match(mono, /⌁ skill fix-failing-tests/);
    assert.match(mono, /checkpoint a1b2c3d4e5/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("monologueLine drops status and telemetry from the record tree", () => {
  assert.equal(monologueLine({ type: "status", phase: "reasoning", poolUsed: 1, poolCap: 2 }), null);
  assert.equal(
    monologueLine({ type: "telemetry", tokens: 1, tps: 1, ctxUsed: 1, ctxCap: 1, vram: 1 }),
    null,
  );
  assert.match(monologueLine({ type: "stage", name: "recon", face: "" }) ?? "", /recon/);
});
