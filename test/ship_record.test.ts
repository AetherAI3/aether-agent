// The lifecycle binding: session ↔ worktree ↔ branch ↔ commit ↔ pull request.
//
// Two invariants carry this file. A record about an older commit never lends
// its publish/pull-request fields to a newer one, and a worktree is only
// cleanable when everything in it exists somewhere else. Both are the kind of
// thing that reads as pedantic until the day it deletes someone's work.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpWorkspace } from "./tmp_workspace.js";
import {
  SHIP_RECORD_VERSION,
  bindShipRecord,
  canCleanWorktree,
  listShipRecords,
  readShipRecord,
  recordPublished,
  recordPullRequest,
  recordVerification,
  renderShipRecord,
  shipRecordPath,
  writeShipRecord,
  type ShipRecord,
} from "../src/core/ship_record.js";
import type { RepoState } from "../src/core/review_state.js";

const HEAD = "a".repeat(40);
const NEWER = "c".repeat(40);

function stateWith(over: Partial<RepoState> = {}): RepoState {
  return {
    ok: true,
    root: "/repo",
    remote: {
      name: "origin",
      url: "https://github.com/octocat/hello-world.git",
      pushUrl: "https://github.com/octocat/hello-world.git",
      spec: { owner: "octocat", name: "hello-world", full: "octocat/hello-world" },
    },
    head: { branch: "aether/fix-1", detached: false, revision: HEAD, upstream: null, ahead: null, behind: null },
    base: { branch: "main", revision: "b".repeat(40), fetched: true },
    aheadOfBase: 1,
    behindBase: 0,
    files: [],
    ...over,
  } as RepoState;
}

function inTempConfig<T>(body: () => T): T {
  const home = tmpWorkspace("aether-ship-record-");
  const previous = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = home;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = previous;
  }
}

test("a branch name is never a path component", () => {
  inTempConfig(() => {
    const path = shipRecordPath("/repo", "../../../etc/passwd");
    assert.ok(!path.includes(".."), "a traversal in the branch name cannot reach the filesystem");
    assert.ok(!path.includes("passwd"));
    assert.ok(path.endsWith(".json"));
  });
});

test("a record round-trips, and the readable name lives inside the file", () => {
  inTempConfig(() => {
    const record = bindShipRecord(stateWith(), { sessionId: "sess-1", now: "2026-08-22T10:00:00.000Z" })!;
    writeShipRecord(record);
    const read = readShipRecord("/repo", "aether/fix-1");
    assert.equal(read?.branch, "aether/fix-1");
    assert.equal(read?.sessionId, "sess-1");
    assert.equal(read?.publishedAt, null, "a fresh record has published nothing");
    assert.equal(read?.prUrl, null, "and points at no pull request");
  });
});

test("a new commit drops the old commit's publish and pull request", () => {
  inTempConfig(() => {
    const first = bindShipRecord(stateWith(), { sessionId: "sess-1", now: "2026-08-22T10:00:00.000Z" })!;
    const published = recordPullRequest(recordPublished(first, "2026-08-22T10:05:00.000Z"), "https://x/pull/1")!;
    writeShipRecord(published);

    const rebound = bindShipRecord(
      stateWith({ head: { branch: "aether/fix-1", detached: false, revision: NEWER, upstream: null, ahead: null, behind: null } }),
      { now: "2026-08-22T11:00:00.000Z" },
    )!;
    assert.equal(rebound.headRevision, NEWER);
    assert.equal(rebound.publishedAt, null, "the newer commit was not published");
    assert.equal(rebound.prUrl, null, "and the old pull request does not describe it");
    assert.equal(rebound.sessionId, "sess-1", "session identity is about the branch, so it carries");
  });
});

test("re-binding the same commit keeps what was already true of it", () => {
  inTempConfig(() => {
    const first = bindShipRecord(stateWith(), { now: "2026-08-22T10:00:00.000Z" })!;
    writeShipRecord(recordPullRequest(recordPublished(first), "https://x/pull/2")!);
    const again = bindShipRecord(stateWith(), { now: "2026-08-22T12:00:00.000Z" })!;
    assert.equal(again.prUrl, "https://x/pull/2");
    assert.ok(again.publishedAt, "the push really did happen to this commit");
  });
});

test("a pull request with no URL is not a pull request", () => {
  const base = bindShipRecord(stateWith(), { now: "2026-08-22T10:00:00.000Z" })!;
  assert.equal(recordPullRequest(base, "   "), null);
  assert.equal(recordPullRequest(base, "opened successfully"), null);
  assert.equal(recordPullRequest(base, "https://github.com/o/n/pull/3")?.prUrl, "https://github.com/o/n/pull/3");
});

test("an unborn branch has no record to bind", () => {
  assert.equal(
    bindShipRecord(stateWith({ head: { branch: "aether/x", detached: false, revision: null, upstream: null, ahead: null, behind: null } })),
    null,
  );
  assert.equal(
    bindShipRecord(stateWith({ head: { branch: null, detached: true, revision: HEAD, upstream: null, ahead: null, behind: null } })),
    null,
  );
});

test("records list per repository, newest first, and a corrupt one is skipped", () => {
  inTempConfig(() => {
    writeShipRecord({ ...bindShipRecord(stateWith(), { now: "2026-08-22T10:00:00.000Z" })!, branch: "one" });
    writeShipRecord({ ...bindShipRecord(stateWith(), { now: "2026-08-22T12:00:00.000Z" })!, branch: "two" });
    writeShipRecord({
      ...bindShipRecord(stateWith(), { now: "2026-08-22T13:00:00.000Z" })!,
      branch: "future",
      version: SHIP_RECORD_VERSION + 1,
    });
    const listed = listShipRecords("/repo");
    assert.deepEqual(listed.map((record) => record.branch), ["two", "one"]);
    assert.deepEqual(listShipRecords("/somewhere/else"), [], "records do not leak between repositories");
  });
});

// ── cleanup ─────────────────────────────────────────────────────────────────

const complete = (): ShipRecord =>
  recordPullRequest(
    recordPublished(bindShipRecord(stateWith(), { now: "2026-08-22T10:00:00.000Z" })!),
    "https://github.com/o/n/pull/4",
  )!;

test("a clean, published, pull-requested worktree may be cleaned up", () => {
  assert.deepEqual(canCleanWorktree(stateWith(), complete()), { ok: true });
});

test("uncommitted work blocks cleanup", () => {
  const dirty = stateWith({
    files: [{ path: "a.ts", index: ".", worktree: "M", staged: false, unstaged: true, untracked: false, unmerged: false }],
  });
  const verdict = canCleanWorktree(dirty, complete());
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.reason : "", /exist nowhere else/);
});

test("an unpushed branch, an unshipped commit and a missing pull request each block cleanup", () => {
  const never = bindShipRecord(stateWith(), { now: "2026-08-22T10:00:00.000Z" })!;
  assert.match((canCleanWorktree(stateWith(), never) as { reason: string }).reason, /never pushed/);

  const publishedOnly = recordPublished(never);
  assert.match((canCleanWorktree(stateWith(), publishedOnly) as { reason: string }).reason, /no pull request/);

  const ahead = stateWith({
    head: { branch: "aether/fix-1", detached: false, revision: NEWER, upstream: null, ahead: null, behind: null },
  });
  assert.match((canCleanWorktree(ahead, complete()) as { reason: string }).reason, /newer than the ones that were published/);

  assert.match((canCleanWorktree(stateWith(), null) as { reason: string }).reason, /nothing recorded/);
});

test("the rendered record prints unknown as unknown", () => {
  const bare = renderShipRecord(bindShipRecord(stateWith(), { now: "2026-08-22T10:00:00.000Z" })!);
  assert.match(bare, /published {3}no/);
  assert.match(bare, /pull req {4}none/);
  assert.match(bare, /verified {4}unknown/);
  assert.match(bare, /session {5}\(none recorded\)/);

  const proven = renderShipRecord(
    recordVerification(bindShipRecord(stateWith(), { now: "2026-08-22T10:00:00.000Z" })!, {
      status: "verified",
      command: "npm test",
      exitCode: 0,
    }),
  );
  assert.match(proven, /verified {4}verified \(npm test → 0\)/);
});
