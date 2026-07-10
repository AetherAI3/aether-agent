import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSession, latestSession, replayLines } from "../src/core/session_resume.js";

function seed(root: string, id: string, started: string, cwd?: string): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ sessionId: id, task: "fix x", model: "haiku", brain: "cloud", started, finalStatus: "running", ...(cwd ? { cwd } : {}) }),
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

test("latestSession returns only the newest record scoped to this workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "aec-"));
  try {
    const cwd = join(root, "workspace");
    const other = join(root, "other");
    mkdirSync(cwd);
    mkdirSync(other);
    seed(root, "current-old", "2026-01-01T00:00:00.000Z", cwd);
    seed(root, "other-new", "2026-04-01T00:00:00.000Z", other);
    seed(root, "legacy-newest", "2026-05-01T00:00:00.000Z");
    seed(root, "current-new", "2026-03-01T00:00:00.000Z", cwd);
    assert.equal(latestSession(cwd, root)?.manifest.sessionId, "current-new");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadSession rejects traversal before reading", () => {
  assert.throws(() => loadSession("../outside", "C:\\safe"), /invalid session id/);
});

test("replayLines renders the transcript history", () => {
  const lines = replayLines([
    { ts: "t", type: "stage", name: "execute", face: "" },
    { ts: "t", type: "monologue", text: "hello", depth: 0 },
  ]);
  assert.match(lines.join("\n"), /execute/);
  assert.match(lines.join("\n"), /hello/);
});


test("loadSession rejects an explicit cross-workspace session", () => {
  const root = mkdtempSync(join(tmpdir(), "aec-scope-"));
  try {
    const current = join(root, "current");
    const other = join(root, "other");
    mkdirSync(current);
    mkdirSync(other);
    seed(root, "other-session", "2026-06-01T00:00:00.000Z", other);
    assert.throws(() => loadSession("other-session", root, current), /another workspace/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
