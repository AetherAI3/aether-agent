import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { __setDurableFaults, type FaultPoint } from "../src/core/durable_store.js";
import {
  historyPaths,
  loadHistory,
  MEDIA_HISTORY_SCHEMA_VERSION,
  MEDIA_RETENTION,
  validateDoc,
  type MediaEntry,
} from "../src/core/media_history.js";
import {
  appendEntry,
  clearHistory,
  listEntries,
  repersist,
  resolveRef,
  shortId,
  type AppendInput,
} from "../src/core/media_history_store.js";

const NOW = "2026-08-14T19:42:08.194Z";

function sandbox(): ReturnType<typeof historyPaths> {
  return historyPaths(mkdtempSync(join(tmpdir(), "aether-store-")));
}

function input(over: Partial<AppendInput> = {}): AppendInput {
  return {
    kind: "image",
    displayName: "a.png",
    filePath: "/synthetic/a.png",
    url: "https://example.invalid/a.png",
    model: "vision_nano_pro",
    prompt: "synthetic",
    sizeBytes: 1024,
    ...over,
  };
}

function entryAt(sequence: string, over: Partial<MediaEntry> = {}): MediaEntry {
  return {
    artifactId: `0198f4c2-0000-8000-8000-${sequence.padStart(12, "0")}`,
    sequence,
    createdAt: NOW,
    kind: "image",
    displayName: `a-${sequence}.png`,
    filePath: `/synthetic/a-${sequence}.png`,
    url: "https://example.invalid/a.png",
    model: "vision_nano_pro",
    prompt: "synthetic",
    sizeBytes: 1024,
    source: "agent-media",
    ...over,
  };
}

function found(result: ReturnType<typeof resolveRef>): MediaEntry {
  assert.equal(result.status, "found");
  return (result as { entry: MediaEntry }).entry;
}

// ── identity and retention ──────────────────────────────────────────

test("250 generations at retention 100 never reissue a reference", () => {
  const paths = sandbox();
  const sequences: string[] = [];
  const ids: string[] = [];
  for (let i = 0; i < 250; i++) {
    const { entry } = appendEntry(paths, input({ displayName: `a-${i}.png` }), { now: NOW });
    sequences.push(entry.sequence);
    ids.push(entry.artifactId);
  }

  assert.equal(new Set(sequences).size, 250, "every sequence issued was unique");
  assert.equal(new Set(ids).size, 250, "every artifact ID issued was unique");
  // The v1 bug: index = entries.length + 1, so #101 onwards all collided.
  assert.equal(sequences[100], "101");
  assert.equal(sequences[101], "102");
  assert.equal(sequences[249], "250");

  const load = loadHistory(paths, NOW);
  assert.equal(load.state, "ok");
  assert.equal(load.doc.entries.length, MEDIA_RETENTION, "retention still bounds the window");
  assert.equal(load.doc.nextSequence, "251", "the counter survived every trim");
  assert.equal(load.doc.entries[0]?.sequence, "151");
});

test("trimming never lowers the persistent counter", () => {
  const paths = sandbox();
  for (let i = 0; i < 120; i++) appendEntry(paths, input(), { now: NOW });
  const before = loadHistory(paths, NOW).doc;
  assert.equal(before.entries.length, MEDIA_RETENTION);
  assert.equal(before.nextSequence, "121");

  assert.equal(appendEntry(paths, input(), { now: NOW }).entry.sequence, "121");
});

test("clearing the list does not reissue references that already named a file", () => {
  const paths = sandbox();
  for (let i = 0; i < 5; i++) appendEntry(paths, input(), { now: NOW });
  assert.equal(clearHistory(paths, { now: NOW }), 5);
  assert.equal(appendEntry(paths, input(), { now: NOW }).entry.sequence, "6");
});

test("each commit advances the generation and the readback proves it landed", () => {
  const paths = sandbox();
  appendEntry(paths, input(), { now: NOW });
  appendEntry(paths, input(), { now: NOW });
  const doc = validateDoc(JSON.parse(readFileSync(paths.primary, "utf8")));
  assert.ok(doc);
  assert.equal(doc.generation, 2);
  assert.equal(doc.schemaVersion, MEDIA_HISTORY_SCHEMA_VERSION);
});

test("the backup holds the previous generation after the second write", () => {
  const paths = sandbox();
  appendEntry(paths, input({ displayName: "first.png" }), { now: NOW });
  appendEntry(paths, input({ displayName: "second.png" }), { now: NOW });

  const backup = validateDoc(JSON.parse(readFileSync(paths.backup, "utf8")));
  assert.ok(backup);
  assert.equal(backup.generation, 1);
  assert.deepEqual(backup.entries.map((e) => e.displayName), ["first.png"]);
});

// ── concurrency ─────────────────────────────────────────────────────

test("concurrent writer processes cannot duplicate or lose an entry", () => {
  const paths = sandbox();
  const storeUrl = new URL("../src/core/media_history_store.js", import.meta.url).href;
  const historyUrl = new URL("../src/core/media_history.js", import.meta.url).href;
  // Only meaningful against the built output; the source tree has no .js.
  if (!existsSync(fileURLToPath(storeUrl))) return;

  const script = `
    const { appendEntry } = await import(${JSON.stringify(storeUrl)});
    const { historyPaths } = await import(${JSON.stringify(historyUrl)});
    const paths = historyPaths(process.argv[1]);
    const tag = process.argv[2];
    for (let i = 0; i < 8; i++) {
      appendEntry(paths, {
        kind: "image", displayName: tag + "-" + i, filePath: "/synthetic/" + tag + "-" + i,
        url: "https://example.invalid/a.png", model: "vision_nano_pro",
        prompt: "synthetic", sizeBytes: 1024,
      }, { lockTimeoutMs: 30000 });
    }
  `;

  const WRITERS = 4;
  for (let i = 0; i < WRITERS; i++) {
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script, paths.outputDir, `w${i}`],
      { encoding: "utf8", timeout: 60_000 },
    );
  }

  const load = loadHistory(paths, NOW);
  assert.equal(load.state, "ok", "the index parses after concurrent writes");
  const total = WRITERS * 8;
  assert.equal(load.doc.entries.length, Math.min(total, MEDIA_RETENTION));
  assert.equal(load.doc.nextSequence, String(total + 1), "no writer's allocation was lost");
  assert.equal(
    new Set(load.doc.entries.map((e) => e.sequence)).size,
    load.doc.entries.length,
    "no two retained entries share a sequence",
  );
  assert.equal(new Set(load.doc.entries.map((e) => e.artifactId)).size, load.doc.entries.length);
  assert.deepEqual(
    readdirSync(paths.outputDir).filter((n) => n.endsWith(".tmp") || n.endsWith(".lock")),
    [],
    "no lock or temp file survived the run",
  );
});

// ── fault injection ─────────────────────────────────────────────────

test("a crash mid-commit leaves a recoverable index, not a lost one", (t) => {
  t.after(() => __setDurableFaults(null));
  const points: FaultPoint[] = ["before-temp-flush", "before-backup", "before-rename"];

  for (const point of points) {
    const paths = sandbox();
    __setDurableFaults(null);
    appendEntry(paths, input({ displayName: "committed.png" }), { now: NOW });

    __setDurableFaults((current) => {
      if (current === point) throw new Error("simulated crash");
    });
    assert.throws(() => appendEntry(paths, input({ displayName: "lost.png" }), { now: NOW }));
    __setDurableFaults(null);

    const load = loadHistory(paths, NOW);
    assert.notEqual(load.state, "degraded", `history was lost after a crash at ${point}`);
    assert.ok(
      load.doc.entries.some((e) => e.displayName === "committed.png"),
      `the already-committed entry vanished after a crash at ${point}`,
    );
    // The lock must be released even when the body throws, or the next append
    // would block until the stale timeout.
    assert.equal(existsSync(paths.lock), false);
  }
});

test("a future schema is never overwritten by an append", () => {
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
  const before = readFileSync(paths.primary, "utf8");

  assert.throws(() => appendEntry(paths, input(), { now: NOW }), /newer Aether/);
  assert.throws(() => clearHistory(paths, { now: NOW }), /newer Aether/);
  assert.equal(readFileSync(paths.primary, "utf8"), before, "the newer document is untouched");
});

test("repersist promotes a recovered generation back to the primary", () => {
  const paths = sandbox();
  appendEntry(paths, input({ displayName: "first.png" }), { now: NOW });
  appendEntry(paths, input({ displayName: "second.png" }), { now: NOW });
  writeFileSync(paths.primary, "not json at all");

  assert.equal(repersist(paths, { now: NOW }).state, "recovered-backup");

  const after = loadHistory(paths, NOW);
  assert.equal(after.state, "ok", "the warning stops repeating once the primary is valid");
  assert.deepEqual(after.doc.entries.map((e) => e.displayName), ["first.png"]);
});

// ── resolution ──────────────────────────────────────────────────────

test("a sequence, a full artifact ID and a unique prefix each resolve exactly one entry", () => {
  const entries = [entryAt("101"), entryAt("102"), entryAt("285")];
  assert.equal(found(resolveRef(entries, "285")).displayName, "a-285.png");
  assert.equal(found(resolveRef(entries, entries[1]!.artifactId)).sequence, "102");
  assert.equal(resolveRef(entries, "0198f4c2").status, "ambiguous", "a shared prefix is ambiguous");
  assert.equal(resolveRef(entries, "999").status, "not-found");
  assert.equal(resolveRef(entries, "   ").status, "not-found");
});

test("a duplicate filename resolves as ambiguous instead of picking the first match", () => {
  const entries = [
    entryAt("1", { displayName: "hero.png" }),
    entryAt("2", { displayName: "hero.png" }),
  ];
  const resolved = resolveRef(entries, "hero.png");
  assert.equal(resolved.status, "ambiguous");
  assert.equal(resolved.status === "ambiguous" && resolved.candidates.length, 2);
});

test("listEntries returns newest first, capped", () => {
  const entries = [entryAt("1"), entryAt("2"), entryAt("3")];
  assert.deepEqual(listEntries(entries, 2).map((e) => e.sequence), ["3", "2"]);
  assert.deepEqual(listEntries(entries, 0), []);
  assert.deepEqual(listEntries(entries, 99).map((e) => e.sequence), ["3", "2", "1"]);
});

test("shortId is a stable eight-character handle", () => {
  assert.equal(shortId("0198f4c2-0000-8000-8000-000000000001"), "0198f4c2");
});

// ── injection ───────────────────────────────────────────────────────

test("a filename full of shell metacharacters round-trips through the index intact", () => {
  const paths = sandbox();
  const hostile = `a";calc.exe & echo $(id) \`whoami\` '.png`;
  const { entry } = appendEntry(
    paths,
    input({ displayName: hostile, filePath: `/synthetic/${hostile}` }),
    { now: NOW },
  );

  const load = loadHistory(paths, NOW);
  assert.equal(load.state, "ok");
  assert.equal(load.doc.entries[0]?.displayName, hostile);
  assert.equal(found(resolveRef(load.doc.entries, entry.sequence)).displayName, hostile);
});
