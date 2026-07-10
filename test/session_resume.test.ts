import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSession, latestSession, replayLines } from "../src/core/session_resume.js";

function seed(root: string, id: string, started: string): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ sessionId: id, task: "fix x", model: "haiku", brain: "cloud", started, finalStatus: "running" }),
  );
  writeFileSync(
    join(dir, "events.jsonl"),
    JSON.stringify({ ts: started, type: "stage", name: "execute", face: "" }) +
      "\n" +
      JSON.stringify({ ts: started, type: "monologue", text: "hello", depth: 0 }) +
      "\n",
  );
}

test("loadSession reads manifest + events", () => {
  const root = mkdtempSync(join(tmpdir(), "aec-"));
  try {
    seed(root, "s1", "2026-01-01T00:00:00.000Z");
    const s = loadSession("s1", root);
    assert.equal(s.manifest.task, "fix x");
    assert.equal(s.events.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("latestSession returns the newest by started time", () => {
  const root = mkdtempSync(join(tmpdir(), "aec-"));
  try {
    seed(root, "a", "2026-01-01T00:00:00.000Z");
    seed(root, "b", "2026-02-01T00:00:00.000Z");
    assert.equal(latestSession(root)?.manifest.sessionId, "b");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replayLines renders the transcript history", () => {
  const lines = replayLines([
    { ts: "t", type: "stage", name: "execute", face: "" },
    { ts: "t", type: "monologue", text: "hello", depth: 0 },
  ]);
  assert.match(lines.join("\n"), /execute/);
  assert.match(lines.join("\n"), /hello/);
});
