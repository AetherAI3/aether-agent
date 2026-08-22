import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __setDurableFaults } from "../src/core/durable_store.js";
import {
  archiveSession,
  entriesForWorkspace,
  entryFromManifest,
  findEntry,
  indexPath,
  mergeEntry,
  parseIndexEntry,
  pruneMissingSessions,
  readSessionIndex,
  rebuildEntries,
  SESSION_INDEX_SCHEMA_VERSION,
  upsertSessionIndex,
  type SessionIndexEntry,
} from "../src/core/session_index.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "aether-index-"));
}

function seed(root: string, id: string, extra: Record<string, unknown> = {}): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      sessionId: id,
      task: "make the parser accept trailing commas",
      model: "qwen3:4b",
      brain: "local",
      cwd: join(root, "workspace"),
      started: "2026-08-19T10:00:00.000Z",
      ended: "2026-08-19T10:04:00.000Z",
      finalStatus: "incomplete",
      ...extra,
    }),
  );
  // Deliberately NOT valid JSON: nothing on the listing path may parse it.
  writeFileSync(join(dir, "events.jsonl"), "{this is not json\n");
}

function entry(id: string, over: Partial<SessionIndexEntry> = {}): SessionIndexEntry {
  return {
    sessionId: id,
    workspace: "/w",
    workspaceFingerprint: "ffff",
    task: "t",
    model: "m",
    brain: "local",
    started: "2026-08-19T10:00:00.000Z",
    ended: null,
    finalStatus: "ok",
    ...over,
  };
}

test("a listing never parses events.jsonl", () => {
  const root = tempRoot();
  try {
    for (let i = 0; i < 25; i += 1) seed(root, `s${String(i).padStart(3, "0")}`);
    // Every seeded events.jsonl is malformed. If the listing path read it, this
    // would throw — the whole point of the index is that it does not.
    const entries = rebuildEntries(root);
    assert.equal(entries.length, 25);
    assert.equal(readSessionIndex(root).entries.length, 25);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing index rebuilds silently; a corrupt one rebuilds visibly and is preserved", () => {
  const root = tempRoot();
  try {
    seed(root, "s1");
    const fresh = readSessionIndex(root);
    assert.equal(fresh.entries.length, 1);
    assert.equal(fresh.recovery, undefined, "no index yet is normal, not a recovery");

    writeFileSync(indexPath(root), "{ not json");
    const recovered = readSessionIndex(root, "2026-08-22T00:00:00.000Z");
    assert.equal(recovered.entries.length, 1, "rows come back from the manifests");
    assert.equal(recovered.recovery?.reason, "corrupt");
    assert.ok(recovered.recovery?.preserved, "the unreadable copy is kept");
    assert.ok(existsSync(recovered.recovery!.preserved!));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an index from a newer schema is refused, preserved, and never overwritten", () => {
  const root = tempRoot();
  try {
    seed(root, "s1");
    const future = JSON.stringify({
      schemaVersion: SESSION_INDEX_SCHEMA_VERSION + 1,
      entries: [{ sessionId: "from-the-future", workspace: "/w" }],
    });
    writeFileSync(indexPath(root), future);

    const read = readSessionIndex(root, "2026-08-22T00:00:00.000Z");
    assert.equal(read.recovery?.reason, "schema");
    assert.match(read.recovery?.detail ?? "", /newer Aether Agent/);
    assert.deepEqual(
      read.entries.map((e) => e.sessionId),
      ["s1"],
      "the future rows are not trusted; the manifests answer instead",
    );

    // A write must not clobber the newer install's file.
    upsertSessionIndex(entry("s2", { workspace: join(root, "workspace") }), root);
    assert.equal(readFileSync(indexPath(root), "utf8"), future);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an interrupted write leaves the previous generation intact", () => {
  const root = tempRoot();
  try {
    seed(root, "s1");
    upsertSessionIndex(entry("s1", { workspace: join(root, "workspace") }), root);
    const before = readFileSync(indexPath(root), "utf8");

    __setDurableFaults((point) => {
      if (point === "before-rename") throw new Error("power cut");
    });
    assert.throws(() => upsertSessionIndex(entry("s2", { workspace: join(root, "workspace") }), root));
    __setDurableFaults(null);

    assert.equal(readFileSync(indexPath(root), "utf8"), before, "the good generation survives");
    assert.equal(readSessionIndex(root).recovery, undefined, "and it is still readable");
  } finally {
    __setDurableFaults(null);
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent writers do not lose entries", () => {
  const root = tempRoot();
  try {
    const workspace = join(root, "workspace");
    const module = new URL("../src/core/session_index.js", import.meta.url).href;
    // Four separate PROCESSES, which is the case an in-process test cannot
    // make: each reads the index and writes its own row at the same moment.
    const script = (id: string) =>
      `const m = await import(${JSON.stringify(module)});\n` +
      `m.upsertSessionIndex({sessionId:${JSON.stringify(id)},workspace:${JSON.stringify(workspace)},` +
      `workspaceFingerprint:"f",task:"t",model:"m",brain:"local",` +
      `started:"2026-08-19T10:00:0${id.slice(-1)}.000Z",ended:null,finalStatus:"ok"},` +
      `${JSON.stringify(root)});`;
    const ids = ["p1", "p2", "p3", "p4"];
    const children = ids.map((id) =>
      execFileSync(process.execPath, ["--input-type=module", "-e", script(id)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    assert.equal(children.length, ids.length);
    const stored = readSessionIndex(root).entries.map((e) => e.sessionId).sort();
    assert.deepEqual(stored, ids, "every writer's row is present");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rows are keyed by exact id and scoped by normalized workspace", () => {
  const root = tempRoot();
  try {
    const mine = join(root, "workspace");
    const theirs = join(root, "elsewhere");
    mkdirSync(mine, { recursive: true });
    mkdirSync(theirs, { recursive: true });
    const entries = [
      entry("2026-08-19T10-00-00-000Z-local-1", { workspace: mine }),
      entry("2026-08-19T10-00-00-000Z-local-2", { workspace: theirs }),
    ];
    assert.deepEqual(
      entriesForWorkspace(entries, mine).map((e) => e.sessionId),
      ["2026-08-19T10-00-00-000Z-local-1"],
      "a shared timestamp prefix does not make two sessions the same session",
    );
    // A prefix must never resolve: it would be ambiguous across workspaces.
    assert.equal(findEntry(entries, "2026-08-19T10-00-00-000Z-local"), null);
    assert.ok(findEntry(entries, "2026-08-19T10-00-00-000Z-local-2"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("terminal control characters in a task never reach a row", () => {
  const hostile = parseIndexEntry({
    sessionId: "s1",
    workspace: "/w",
    task: "fix \u001b[31mthe\u0007 parser\u001b]0;pwned\u0007",
  });
  assert.ok(hostile);
  assert.equal(hostile!.task, "fix the parser");
  assert.ok(!hostile!.task.includes("\u001b"));
});

test("a row whose id is not a legal session id is dropped", () => {
  assert.equal(parseIndexEntry({ sessionId: "../../etc", workspace: "/w" }), null);
  assert.equal(parseIndexEntry({ sessionId: "ok", workspace: "" }), null);
  assert.equal(parseIndexEntry({ sessionId: "ok" }), null);
});

test("unrecorded counts stay absent — never zero", () => {
  const row = entryFromManifest("s1", {
    sessionId: "s1",
    cwd: "/w",
    task: "t",
    brain: "local",
    started: "2026-08-19T10:00:00.000Z",
    finalStatus: "ok",
  });
  assert.ok(row);
  assert.equal(row!.filesTouched, undefined);
  assert.equal(row!.events, undefined);
  // And a later update carrying the count does not erase what came before.
  const merged = mergeEntry(row!, entry("s1", { workspace: "/w", filesTouched: 3, task: "" }));
  assert.equal(merged.filesTouched, 3);
  assert.equal(merged.task, "t", "an empty update field does not blank a known one");
});

test("archive hides a row without deleting anything; clean drops only dead rows", () => {
  const root = tempRoot();
  try {
    seed(root, "s1");
    seed(root, "s2");
    readSessionIndex(root).entries.forEach((e) => upsertSessionIndex(e, root));

    assert.equal(archiveSession("s1", root), "archived");
    const archived = findEntry(readSessionIndex(root).entries, "s1");
    assert.equal(archived?.archived, true);
    assert.ok(existsSync(join(root, "s1", "manifest.json")), "archiving deletes nothing");

    rmSync(join(root, "s2"), { recursive: true, force: true });
    const prune = pruneMissingSessions(root);
    assert.equal(prune.written, true);
    assert.deepEqual(prune.removed.map((e) => e.sessionId), ["s2"]);
    assert.deepEqual(
      readSessionIndex(root).entries.map((e) => e.sessionId),
      ["s1"],
    );
    assert.ok(readdirSync(root).includes("s1"), "the surviving session directory is untouched");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
