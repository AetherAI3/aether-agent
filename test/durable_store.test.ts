import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  __setDurableFaults,
  atomicWriteFile,
  isLockStale,
  preserveCorrupt,
  readJsonFile,
  withFileLock,
  type FaultPoint,
} from "../src/core/durable_store.js";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "aether-durable-"));
}

function crashAt(point: FaultPoint): void {
  __setDurableFaults((current) => {
    if (current === point) throw new Error(`simulated crash at ${current}`);
  });
}

test("readJsonFile separates missing from present-but-broken", () => {
  const dir = sandbox();
  assert.deepEqual(readJsonFile(join(dir, "absent.json")), {
    ok: false,
    reason: "missing",
    detail: "file does not exist",
  });

  const empty = join(dir, "empty.json");
  writeFileSync(empty, "   ");
  const emptyRead = readJsonFile(empty);
  assert.equal(emptyRead.ok, false);
  assert.equal(emptyRead.ok === false && emptyRead.reason, "corrupt");

  const truncated = join(dir, "truncated.json");
  writeFileSync(truncated, '{"value": "synth');
  const truncatedRead = readJsonFile(truncated);
  assert.equal(truncatedRead.ok === false && truncatedRead.reason, "corrupt");

  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify({ value: "synthetic-a" }));
  const parsed = readJsonFile<{ value: string }>(good);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.value.value, "synthetic-a");
});

test("atomicWriteFile keeps the previous generation recoverable", () => {
  const dir = sandbox();
  const primary = join(dir, "index.json");
  const backup = primary + ".bak";

  atomicWriteFile(primary, JSON.stringify({ value: "gen-1" }), { backupPath: backup });
  assert.equal(existsSync(backup), false, "nothing to back up on the first write");

  atomicWriteFile(primary, JSON.stringify({ value: "gen-2" }), { backupPath: backup });
  assert.equal(JSON.parse(readFileSync(primary, "utf8")).value, "gen-2");
  assert.equal(JSON.parse(readFileSync(backup, "utf8")).value, "gen-1");
});

test("a crash at any write phase leaves a valid generation behind", (t) => {
  t.after(() => __setDurableFaults(null));

  const points: FaultPoint[] = [
    "before-temp-flush",
    "after-temp-flush",
    "before-backup",
    "after-backup",
    "before-rename",
  ];

  for (const point of points) {
    const dir = sandbox();
    const primary = join(dir, "index.json");
    const backup = primary + ".bak";
    __setDurableFaults(null);
    atomicWriteFile(primary, JSON.stringify({ value: "gen-1" }), { backupPath: backup });

    crashAt(point);
    assert.throws(
      () => atomicWriteFile(primary, JSON.stringify({ value: "gen-2" }), { backupPath: backup }),
      /simulated crash/,
      `expected the write to abort at ${point}`,
    );
    __setDurableFaults(null);

    // Either generation may be current, but one of them must parse.
    const recovered = readJsonFile<{ value: string }>(primary);
    assert.equal(recovered.ok, true, `primary unreadable after crash at ${point}`);
    assert.match(recovered.ok ? recovered.value.value : "", /^gen-[12]$/);
  }
});

test("a crash after the rename still leaves the new generation committed", (t) => {
  t.after(() => __setDurableFaults(null));
  const dir = sandbox();
  const primary = join(dir, "index.json");
  const backup = primary + ".bak";
  atomicWriteFile(primary, JSON.stringify({ value: "gen-1" }), { backupPath: backup });

  crashAt("after-rename");
  assert.throws(() =>
    atomicWriteFile(primary, JSON.stringify({ value: "gen-2" }), { backupPath: backup }),
  );
  __setDurableFaults(null);

  assert.equal(JSON.parse(readFileSync(primary, "utf8")).value, "gen-2");
  assert.equal(JSON.parse(readFileSync(backup, "utf8")).value, "gen-1");
});

test("an aborted write does not leave its own temp file behind", (t) => {
  t.after(() => __setDurableFaults(null));
  const dir = sandbox();
  const primary = join(dir, "index.json");
  atomicWriteFile(primary, JSON.stringify({ value: "gen-1" }));

  crashAt("before-rename");
  assert.throws(() => atomicWriteFile(primary, JSON.stringify({ value: "gen-2" })));
  __setDurableFaults(null);

  assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith(".tmp")), []);
});

test("the temp file is always a sibling of the target", (t) => {
  t.after(() => __setDurableFaults(null));
  // A temp on another volume turns rename into copy+delete, which is not
  // atomic. Assert the invariant by watching the directory during the write.
  const dir = sandbox();
  let seen: string[] = [];
  __setDurableFaults((point) => {
    if (point === "before-rename") seen = readdirSync(dir);
  });
  atomicWriteFile(join(dir, "index.json"), JSON.stringify({ value: "gen-1" }));
  __setDurableFaults(null);
  assert.equal(seen.some((name) => name.endsWith(".tmp")), true);
});

test("withFileLock serialises callers and always releases", () => {
  const dir = sandbox();
  const lock = join(dir, "index.json.lock");

  assert.equal(withFileLock(lock, "test", () => "held"), "held");
  assert.equal(existsSync(lock), false, "lock released on success");

  assert.throws(() =>
    withFileLock(lock, "test", () => {
      throw new Error("body failed");
    }),
  );
  assert.equal(existsSync(lock), false, "lock released on throw");
});

test("a live lock is respected until the timeout, then reported with its owner", () => {
  const dir = sandbox();
  const lock = join(dir, "index.json.lock");
  // A live owner: this very process.
  writeFileSync(
    lock,
    JSON.stringify({
      pid: process.pid,
      host: hostname(),
      startedAt: "2020-01-01T00:00:00.000Z",
      label: "test",
    }),
  );
  assert.throws(
    () => withFileLock(lock, "test", () => "never", { timeoutMs: 60 }),
    (err: Error) =>
      err.message.includes("could not lock") && err.message.includes(String(process.pid)),
  );
});

test("a lock owned by a dead process on this host is stealable", () => {
  const dir = sandbox();
  const lock = join(dir, "index.json.lock");
  writeFileSync(
    lock,
    JSON.stringify({
      pid: 999999,
      host: hostname(),
      startedAt: "2020-01-01T00:00:00.000Z",
      label: "test",
    }),
  );
  assert.equal(withFileLock(lock, "test", () => "stolen", { timeoutMs: 200 }), "stolen");
});

test("isLockStale never steals a fresh lock held elsewhere", () => {
  const foreign = {
    pid: 1,
    host: "SYNTHETIC-HOST",
    startedAt: "2020-01-01T00:00:00.000Z",
    label: "test",
  };
  assert.equal(isLockStale(foreign, 1_000, 60_000), false);
  assert.equal(isLockStale(foreign, 90_000, 60_000), true);
  // An unparseable stamp is only stealable once it is provably old.
  assert.equal(isLockStale(null, 1_000, 60_000), false);
  assert.equal(isLockStale(null, 90_000, 60_000), true);
});

test("preserveCorrupt keeps the evidence instead of overwriting it", () => {
  const dir = sandbox();
  const primary = join(dir, "index.json");
  writeFileSync(primary, '{"value": "synth');
  const preserved = preserveCorrupt(primary, "2026-08-14T19:42:08.194Z");
  assert.ok(preserved);
  assert.match(preserved, /index\.json\.corrupt\.2026-08-14T19-42-08-194Z$/);
  assert.equal(readFileSync(preserved, "utf8"), '{"value": "synth');
  assert.equal(preserveCorrupt(join(dir, "absent.json")), null);
});
