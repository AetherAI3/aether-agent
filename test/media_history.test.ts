import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyDoc,
  historyPaths,
  isMediaEntry,
  loadHistory,
  MEDIA_HISTORY_SCHEMA_VERSION,
  migrateLegacy,
  rebuildFromDirectory,
  recoveryId,
  validateDoc,
  type MediaEntry,
} from "../src/core/media_history.js";

const NOW = "2026-08-14T19:42:08.194Z";

function sandbox(): ReturnType<typeof historyPaths> {
  return historyPaths(mkdtempSync(join(tmpdir(), "aether-media-")));
}

/** Deterministic ID factory so migration assertions stay stable. */
function counterIds(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `0198f4c2-0000-8000-8000-${String(n).padStart(12, "0")}`;
  };
}

function legacyRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    index: 1,
    filename: "a.png",
    filepath: "/synthetic/a.png",
    model: "vision_nano_pro",
    prompt: "synthetic",
    kind: "image",
    url: "https://example.invalid/a.png",
    timestamp: "2026-08-14T19:41:57.002Z",
    size_bytes: 1024,
    ...over,
  };
}

function entry(over: Partial<MediaEntry> = {}): MediaEntry {
  return {
    artifactId: "0198f4c2-0000-8000-8000-000000000001",
    sequence: "1",
    createdAt: "2026-08-14T19:41:57.002Z",
    kind: "image",
    displayName: "a.png",
    filePath: "/synthetic/a.png",
    url: "https://example.invalid/a.png",
    model: "vision_nano_pro",
    prompt: "synthetic",
    sizeBytes: 1024,
    source: "agent-media",
    ...over,
  };
}

// ── validation ──────────────────────────────────────────────────────

test("an entry with neither a local path nor a URL is not a valid record", () => {
  assert.equal(isMediaEntry(entry()), true);
  assert.equal(isMediaEntry(entry({ filePath: "", url: "" })), false);
  assert.equal(isMediaEntry(entry({ filePath: "", url: "https://example.invalid/a" })), true);
});

test("sequence must be a positive decimal string, not a number and not zero", () => {
  assert.equal(isMediaEntry(entry({ sequence: 1 as unknown as string })), false);
  assert.equal(isMediaEntry(entry({ sequence: "0" })), false);
  assert.equal(isMediaEntry(entry({ sequence: "01" })), false);
  assert.equal(isMediaEntry(entry({ sequence: "285" })), true);
});

test("validateDoc rejects a root that is missing the persistent counter", () => {
  const good = { ...emptyDoc(NOW), entries: [entry()], nextSequence: "2" };
  assert.ok(validateDoc(good));
  assert.equal(validateDoc({ ...good, nextSequence: undefined }), null);
  assert.equal(validateDoc({ ...good, generation: "1" }), null);
  assert.equal(validateDoc([entry()]), null, "a bare array is v1, not a v2 root");
});

// ── migration ───────────────────────────────────────────────────────

test("a run of duplicate 101s migrates to unique, deterministic sequences", () => {
  // Exactly the shape the v1 bug produced: retention trimmed to 100, so every
  // generation after the 100th was written with index = entries.length + 1.
  const legacy = Array.from({ length: 5 }, (_unused, i) =>
    legacyRow({
      index: 101,
      filename: `dup-${i}.png`,
      timestamp: `2026-08-14T19:4${i}:00.000Z`,
    }),
  );

  const first = migrateLegacy(legacy, NOW, counterIds());
  const sequences = first.entries.map((e) => e.sequence);
  assert.equal(new Set(sequences).size, 5, "no two entries share a sequence");
  assert.deepEqual(sequences, ["1", "2", "3", "4", "5"]);
  // Chronological order is preserved, so #1 is the oldest duplicate.
  assert.deepEqual(first.entries.map((e) => e.displayName), [
    "dup-0.png", "dup-1.png", "dup-2.png", "dup-3.png", "dup-4.png",
  ]);
  assert.equal(first.nextSequence, "6");

  const second = migrateLegacy(legacy, NOW, counterIds());
  assert.deepEqual(
    second.entries.map((e) => [e.sequence, e.displayName]),
    first.entries.map((e) => [e.sequence, e.displayName]),
    "repeated migrations of the same input are deterministic",
  );
});

test("unique legacy indexes are preserved and duplicates are reallocated above them", () => {
  const legacy = [
    legacyRow({ index: 7, filename: "keep-7.png", timestamp: "2026-08-14T19:40:00.000Z" }),
    legacyRow({ index: 101, filename: "dup-a.png", timestamp: "2026-08-14T19:41:00.000Z" }),
    legacyRow({ index: 101, filename: "dup-b.png", timestamp: "2026-08-14T19:42:00.000Z" }),
    legacyRow({ index: 12, filename: "keep-12.png", timestamp: "2026-08-14T19:43:00.000Z" }),
  ];
  const doc = migrateLegacy(legacy, NOW, counterIds());
  const bySequence = Object.fromEntries(doc.entries.map((e) => [e.displayName, e.sequence]));
  assert.equal(bySequence["keep-7.png"], "7");
  assert.equal(bySequence["keep-12.png"], "12");
  // Reallocated above the highest preserved index (12), in chronological order.
  assert.equal(bySequence["dup-a.png"], "13");
  assert.equal(bySequence["dup-b.png"], "14");
  assert.equal(doc.nextSequence, "15");
});

test("missing, zero, negative and non-integer legacy indexes are reallocated", () => {
  const legacy = [
    legacyRow({ index: undefined, filename: "none.png", timestamp: "2026-08-14T19:40:00.000Z" }),
    legacyRow({ index: 0, filename: "zero.png", timestamp: "2026-08-14T19:41:00.000Z" }),
    legacyRow({ index: -3, filename: "neg.png", timestamp: "2026-08-14T19:42:00.000Z" }),
    legacyRow({ index: 1.5, filename: "frac.png", timestamp: "2026-08-14T19:43:00.000Z" }),
  ];
  const doc = migrateLegacy(legacy, NOW, counterIds());
  assert.deepEqual(doc.entries.map((e) => e.sequence), ["1", "2", "3", "4"]);
  assert.equal(new Set(doc.entries.map((e) => e.artifactId)).size, 4);
});

test("entries without a timestamp keep their stored order", () => {
  const legacy = [
    legacyRow({ index: 101, filename: "first.png", timestamp: undefined }),
    legacyRow({ index: 101, filename: "second.png", timestamp: undefined }),
  ];
  const doc = migrateLegacy(legacy, NOW, counterIds());
  assert.deepEqual(doc.entries.map((e) => e.displayName), ["first.png", "second.png"]);
});

test("unresolvable legacy rows are dropped rather than migrated into broken entries", () => {
  const legacy = [
    legacyRow({ index: 1, filepath: "", url: "" }),
    legacyRow({ index: 2, filename: "ok.png" }),
    "not an object",
    null,
  ];
  const doc = migrateLegacy(legacy, NOW, counterIds());
  assert.deepEqual(doc.entries.map((e) => e.displayName), ["ok.png"]);
});

// ── directory rebuild ───────────────────────────────────────────────

test("rebuildFromDirectory recovers media files and marks the uncertainty", () => {
  const paths = sandbox();
  writeFileSync(join(paths.outputDir, "a.png"), "aa");
  writeFileSync(join(paths.outputDir, "b.mp4"), "bbb");
  writeFileSync(join(paths.outputDir, "notes.txt"), "ignored");
  mkdirSync(join(paths.outputDir, "storyboards"));

  const rebuilt = rebuildFromDirectory(paths.outputDir, NOW);
  assert.deepEqual(rebuilt.map((e) => e.displayName).sort(), ["a.png", "b.mp4"]);
  for (const e of rebuilt) {
    assert.equal(e.source, "recovered");
    // Prompt and model are unknowable from a file on disk; they stay empty
    // rather than being invented.
    assert.equal(e.prompt, "");
    assert.equal(e.model, "");
    assert.equal(isMediaEntry(e), true);
  }
});

test("rebuilding twice over the same files yields the same artifact IDs", () => {
  const paths = sandbox();
  const file = join(paths.outputDir, "a.png");
  writeFileSync(file, "aa");
  // Pin mtime so the two runs see identical inputs.
  const pinned = new Date("2026-08-14T19:40:00.000Z");
  utimesSync(file, pinned, pinned);

  const first = rebuildFromDirectory(paths.outputDir, NOW);
  const second = rebuildFromDirectory(paths.outputDir, "2026-08-15T00:00:00.000Z");
  assert.deepEqual(
    first.map((e) => e.artifactId),
    second.map((e) => e.artifactId),
    "a repeated rebuild must not mint a fresh duplicate set",
  );
});

test("recoveryId is a stable UUID-shaped value derived from file facts", () => {
  const a = recoveryId("a.png", 1024, 1_700_000_000_000);
  assert.equal(a, recoveryId("a.png", 1024, 1_700_000_000_000));
  assert.notEqual(a, recoveryId("a.png", 1025, 1_700_000_000_000));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

// ── load and recovery ───────────────────────────────────────────────

test("a missing index with no backup is a genuinely empty history", () => {
  const load = loadHistory(sandbox(), NOW);
  assert.equal(load.state, "ok");
  assert.equal(load.warning, undefined);
  assert.deepEqual(load.doc.entries, []);
  assert.equal(load.doc.nextSequence, "1");
});

test("a v1 array on disk loads as migrated", () => {
  const paths = sandbox();
  writeFileSync(
    paths.primary,
    JSON.stringify([legacyRow({ index: 101 }), legacyRow({ index: 101, filename: "b.png" })]),
  );
  const load = loadHistory(paths, NOW);
  assert.equal(load.state, "migrated");
  assert.equal(new Set(load.doc.entries.map((e) => e.sequence)).size, 2);
});

test("a corrupt primary recovers from the backup with a visible warning", () => {
  const paths = sandbox();
  writeFileSync(paths.primary, '{"schemaVersion": 2, "entr');
  writeFileSync(
    paths.backup,
    JSON.stringify({ ...emptyDoc(NOW), entries: [entry()], nextSequence: "2", generation: 3 }),
  );

  const load = loadHistory(paths, NOW);
  assert.equal(load.state, "recovered-backup");
  assert.equal(load.warning?.code, "recovered-from-backup");
  assert.match(String(load.warning?.preservedCorruptPath), /\.corrupt\./);
  assert.equal(load.doc.entries.length, 1);
});

test("a corrupt primary and no usable backup falls back to a file rebuild", () => {
  const paths = sandbox();
  writeFileSync(paths.primary, "not json at all");
  writeFileSync(paths.backup, "also not json");
  writeFileSync(join(paths.outputDir, "a.png"), "aa");

  const load = loadHistory(paths, NOW);
  assert.equal(load.state, "rebuilt");
  assert.equal(load.warning?.code, "rebuilt-from-files");
  assert.equal(load.doc.entries.length, 1);
  assert.equal(load.doc.entries[0]?.source, "recovered");
});

test("an unrecoverable history reports degraded, never a silent empty list", () => {
  const paths = sandbox();
  // The v1 behaviour — `catch { return [] }` — made this indistinguishable
  // from "no generations yet".
  writeFileSync(paths.primary, "not json at all");

  const load = loadHistory(paths, NOW);
  assert.equal(load.state, "degraded");
  assert.equal(load.warning?.code, "history-lost");
  assert.deepEqual(load.doc.entries, []);
  assert.match(String(load.warning?.message), /not the same as an empty history/);
});

test("valid JSON with an invalid v2 shape is treated as corrupt, not as data", () => {
  const paths = sandbox();
  writeFileSync(
    paths.primary,
    JSON.stringify({
      schemaVersion: 2,
      generation: 1,
      nextSequence: "2",
      updatedAt: NOW,
      entries: [{ nope: true }],
    }),
  );
  const load = loadHistory(paths, NOW);
  assert.equal(load.state, "degraded");
  assert.ok(load.warning?.preservedCorruptPath);
});

test("a future schema is preserved read-only and never rewritten", () => {
  const paths = sandbox();
  writeFileSync(
    paths.primary,
    JSON.stringify({
      schemaVersion: MEDIA_HISTORY_SCHEMA_VERSION + 1,
      generation: 9,
      nextSequence: "500",
      updatedAt: NOW,
      entries: [],
      unknownFutureField: "keep me",
    }),
  );

  const load = loadHistory(paths, NOW);
  assert.equal(load.state, "degraded");
  assert.equal(load.warning?.code, "schema-too-new");
  assert.equal(
    load.warning?.preservedCorruptPath,
    undefined,
    "a newer file is not corrupt evidence",
  );
});
