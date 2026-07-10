import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GitCommitGuard,
  parseNulPaths,
  parsePorcelainPaths,
  planGitCommit,
  type GitRunResult,
  type GitRunner,
} from "../src/core/git_commit_guard.js";

const ok = (stdout = ""): GitRunResult => ({
  ok: true,
  stdout,
  stderr: "",
  exitCode: 0,
});

class FakeRunner implements GitRunner {
  readonly calls: string[][] = [];
  constructor(private readonly results: GitRunResult[]) {}
  run(args: string[]): GitRunResult {
    this.calls.push(args);
    const result = this.results.shift();
    if (!result) throw new Error("unexpected git call: " + args.join(" "));
    return result;
  }
}

test("porcelain parsers handle rename records, spaces, and deduplication", () => {
  assert.deepEqual(
    parsePorcelainPaths(" M dirty file.txt\0R  new.ts\0old.ts\0?? added.ts\0"),
    ["added.ts", "dirty file.txt", "new.ts"],
  );
  assert.deepEqual(parseNulPaths("b.ts\0a.ts\0b.ts\0"), ["a.ts", "b.ts"]);
});

test("commit planning excludes every path dirty when the run began", () => {
  assert.deepEqual(
    planGitCommit(["dirty.ts"], [], ["dirty.ts", "new.ts"], []),
    { ok: true, candidates: ["new.ts"] },
  );
  assert.deepEqual(
    planGitCommit(["dirty.ts"], ["dirty.ts"], ["dirty.ts", "new.ts"], ["dirty.ts"]),
    { ok: false, candidates: [], reason: "pre-existing staged changes" },
  );
  assert.deepEqual(
    planGitCommit([], [], ["new.ts"], ["surprise.ts"]),
    { ok: false, candidates: [], reason: "unexpected staged changes" },
  );
});

test("guard stages and commits only run-introduced paths", () => {
  const runner = new FakeRunner([
    ok(" M dirty.ts\0"),
    ok(),
    ok(" M dirty.ts\0?? new file.ts\0"),
    ok(),
    ok(),
    ok("new file.ts\0"),
    ok(),
    ok("abc123\n"),
  ]);
  const result = new GitCommitGuard(runner).commit("feat: safe");
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /abc123/);
  assert.deepEqual(
    runner.calls.find((args) => args[0] === "add"),
    ["add", "-A", "--", "new file.ts"],
  );
  assert.equal(runner.calls.some((args) => args.includes("dirty.ts") && args[0] === "add"), false);
});

test("guard rolls back its staging when the verified staged set differs", () => {
  const runner = new FakeRunner([
    ok(),
    ok(),
    ok("?? new.ts\0"),
    ok(),
    ok(),
    ok("dirty.ts\0new.ts\0"),
    ok(),
  ]);
  const result = new GitCommitGuard(runner).commit("feat: safe");
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /verification failed/);
  assert.deepEqual(
    runner.calls.find((args) => args[0] === "reset"),
    ["reset", "-q", "HEAD", "--", "new.ts"],
  );
  assert.equal(runner.calls.some((args) => args[0] === "commit"), false);
});
