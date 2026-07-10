import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadHistory, appendHistory } from "../src/commands/history.js";

function tempPath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "aether-history-"));
  return { dir, path: join(dir, "history") };
}

test("history round-trips most-recent-first", () => {
  const { dir, path } = tempPath();
  try {
    appendHistory(path, "first prompt");
    appendHistory(path, "second prompt");
    appendHistory(path, "/model sonnet");
    assert.deepEqual(loadHistory(path), ["/model sonnet", "second prompt", "first prompt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("consecutive duplicates and blanks are not persisted", () => {
  const { dir, path } = tempPath();
  try {
    appendHistory(path, "same");
    appendHistory(path, "same");
    appendHistory(path, "   ");
    appendHistory(path, "other");
    appendHistory(path, "same");
    assert.deepEqual(loadHistory(path), ["same", "other", "same"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the file compacts back to the limit instead of growing forever", () => {
  const { dir, path } = tempPath();
  try {
    for (let i = 0; i < 25; i++) appendHistory(path, `prompt ${i}`, 10);
    const onDisk = readFileSync(path, "utf8").split("\n").filter(Boolean);
    assert.ok(onDisk.length <= 20, `file holds ${onDisk.length} lines, expected <= 2x limit`);
    const loaded = loadHistory(path, 10);
    assert.equal(loaded.length, 10);
    assert.equal(loaded[0], "prompt 24"); // most recent first
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing or unreadable history degrades to empty, never throws", () => {
  assert.deepEqual(loadHistory(join(tmpdir(), "aether-history-none", "nope")), []);
});
