// A verification is a claim about a specific tree.
//
// The load-bearing invariant here is one-directional: a record can only ever
// LOSE its authority. Nothing in this module upgrades unknown or stale to
// verified, and the tests below are written to fail if a future refactor makes
// identity checking optional, order-dependent on the exit code, or lenient
// about a schema version it does not understand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpWorkspace } from "./tmp_workspace.js";
import {
  VERIFICATION_RECORD_VERSION,
  classifyVerification,
  readVerification,
  treeIdentity,
  verificationPath,
  writeVerification,
  type VerificationRecord,
} from "../src/core/verification_record.js";
import type { Runner, RunResult } from "../src/core/worktree.js";

const record = (over: Partial<VerificationRecord> = {}): VerificationRecord => ({
  version: VERIFICATION_RECORD_VERSION,
  command: "npm test",
  exitCode: 0,
  ranAt: "2026-08-22T10:00:00.000Z",
  head: "aaaaaaaaaaaa",
  treeDigest: "digest-1",
  remaining: null,
  ...over,
});

test("no record is unknown, and unknown is not failed", () => {
  const reading = classifyVerification(null, { head: "aaaaaaaaaaaa", digest: "digest-1" });
  assert.equal(reading.status, "unknown");
  assert.ok(reading.reason);
});

test("a green record about THIS tree is verified", () => {
  const reading = classifyVerification(record(), { head: "aaaaaaaaaaaa", digest: "digest-1" });
  assert.equal(reading.status, "verified");
  assert.match(reading.reason, /npm test/);
});

test("a green record about a different HEAD is stale, never verified", () => {
  const reading = classifyVerification(record(), { head: "bbbbbbbbbbbb", digest: "digest-1" });
  assert.equal(reading.status, "stale");
  assert.match(reading.reason, /HEAD is now bbbbbbbb/);
});

test("a green record about a changed working tree is stale, never verified", () => {
  const reading = classifyVerification(record(), { head: "aaaaaaaaaaaa", digest: "digest-2" });
  assert.equal(reading.status, "stale");
  assert.match(reading.reason, /working tree changed/);
});

test("identity is checked before the exit code, so a stale RED record is stale too", () => {
  // Both directions matter. If the exit code were consulted first, a stale red
  // record would be rendered as a current failure — a different lie, and one
  // that would send the user to debug a tree that is already fixed.
  const reading = classifyVerification(record({ exitCode: 1 }), { head: "cccccccccccc", digest: "digest-1" });
  assert.equal(reading.status, "stale");
});

test("a red record about this tree is failed, and says how red", () => {
  const reading = classifyVerification(record({ exitCode: 1, remaining: 3 }), {
    head: "aaaaaaaaaaaa",
    digest: "digest-1",
  });
  assert.equal(reading.status, "failed");
  assert.match(reading.reason, /exited 1 \(3 failing\)/);
});

test("a record from a future schema is refused, not interpreted", () => {
  const reading = classifyVerification(record({ version: VERIFICATION_RECORD_VERSION + 1 }), {
    head: "aaaaaaaaaaaa",
    digest: "digest-1",
  });
  assert.equal(reading.status, "unknown");
  assert.equal(reading.record, null, "a record we cannot read is not handed on as if we could");
});

test("an unborn HEAD matches only another unborn HEAD", () => {
  const unborn = record({ head: null });
  assert.equal(classifyVerification(unborn, { head: null, digest: "digest-1" }).status, "verified");
  assert.equal(classifyVerification(unborn, { head: "aaaaaaaaaaaa", digest: "digest-1" }).status, "stale");
});

test("records round-trip through disk, keyed per repository", () => {
  const home = tmpWorkspace("aether-verify-home-");
  const previous = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = home;
  try {
    assert.equal(readVerification("/repo/one"), null);
    writeVerification("/repo/one", record({ treeDigest: "one" }));
    writeVerification("/repo/two", record({ treeDigest: "two" }));
    assert.equal(readVerification("/repo/one")?.treeDigest, "one");
    assert.equal(readVerification("/repo/two")?.treeDigest, "two");
    assert.notEqual(verificationPath("/repo/one"), verificationPath("/repo/two"));
    assert.ok(
      !verificationPath("/repo/one").includes("repo"),
      "the repository path is hashed, not embedded in a filename",
    );
  } finally {
    if (previous === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = previous;
  }
});

test("a corrupt record reads as unknown rather than throwing", () => {
  const home = tmpWorkspace("aether-verify-corrupt-");
  const previous = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = home;
  try {
    writeVerification("/repo/corrupt", record());
    writeFileSync(verificationPath("/repo/corrupt"), "{ not json", "utf8");
    assert.equal(readVerification("/repo/corrupt"), null);
    assert.equal(classifyVerification(readVerification("/repo/corrupt"), { head: null, digest: "x" }).status, "unknown");
  } finally {
    if (previous === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = previous;
  }
});

// ── real git ────────────────────────────────────────────────────────────────

test("real git: the digest moves for every kind of change that can break a test run", (t) => {
  if (spawnSync("git", ["--version"], { encoding: "utf8" }).error) return t.skip("git not available");
  const dir = tmpWorkspace("aether-verify-tree-");
  const run: Runner = (cmd, args) => {
    const result = spawnSync(cmd, args, { cwd: dir, encoding: "utf8" });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" } as RunResult;
  };
  const git = (...args: string[]) => run("git", ["-C", dir, ...args]);

  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");

  const first = treeIdentity(run, dir);
  assert.ok(first.head, "a committed repository has a head");
  assert.equal(treeIdentity(run, dir).digest, first.digest, "an unchanged tree keeps its digest");

  writeFileSync(join(dir, "a.txt"), "two\n");
  const edited = treeIdentity(run, dir);
  assert.notEqual(edited.digest, first.digest, "an unstaged edit changes the tree");

  git("add", "-A");
  const staged = treeIdentity(run, dir);
  assert.equal(staged.head, first.head, "staging does not move HEAD");
  assert.notEqual(staged.digest, first.digest);

  git("commit", "-q", "-m", "second");
  const committed = treeIdentity(run, dir);
  assert.notEqual(committed.head, first.head, "committing moves HEAD");

  // The case a path-list digest would miss: an untracked file whose CONTENT
  // changes. A test run can depend on it, so it has to count.
  writeFileSync(join(dir, "fixture.json"), "{}\n");
  const withFixture = treeIdentity(run, dir);
  writeFileSync(join(dir, "fixture.json"), '{"changed": true}\n');
  assert.notEqual(
    treeIdentity(run, dir).digest,
    withFixture.digest,
    "untracked content is hashed, not merely listed",
  );

  // And the end-to-end invariant the whole module exists for.
  const green = {
    version: VERIFICATION_RECORD_VERSION,
    command: "npm test",
    exitCode: 0,
    ranAt: "2026-08-22T10:00:00.000Z",
    head: withFixture.head,
    treeDigest: withFixture.digest,
    remaining: null,
  };
  assert.equal(classifyVerification(green, withFixture).status, "verified");
  assert.equal(
    classifyVerification(green, treeIdentity(run, dir)).status,
    "stale",
    "one edit after a green run and the claim is stale",
  );
});
