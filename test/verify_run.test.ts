// The writer for verification records.
//
// verification_record.test.ts proves a stored claim can only ever lose
// authority on READ. This file proves the matching thing on WRITE: a run whose
// tree moved underneath it is never stored at all, so there is no misleading
// record to classify later.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpWorkspace } from "./tmp_workspace.js";
import { verifyAndRecord } from "../src/core/verify_run.js";
import { classifyVerification, readVerification, treeIdentity } from "../src/core/verification_record.js";
import type { VerifyRunner } from "../src/core/verify_gate.js";
import type { ToolResult } from "../src/core/tool_executor.js";
import type { Runner, RunResult } from "../src/core/worktree.js";

const haveGit = !spawnSync("git", ["--version"], { encoding: "utf8" }).error;

interface Fixture {
  dir: string;
  run: Runner;
  write: (path: string, body: string) => void;
}

function fixture(prefix: string): Fixture {
  const dir = tmpWorkspace(prefix);
  const run: Runner = (cmd, args, cwd) => {
    const result = spawnSync(cmd, args, { cwd: cwd ?? dir, encoding: "utf8" });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" } as RunResult;
  };
  const git = (...args: string[]): RunResult => run("git", ["-C", dir, ...args]);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  return { dir, run, write: (path, body) => writeFileSync(join(dir, path), body, "utf8") };
}

/** A VerifyRunner that answers with a fixed result, optionally moving the tree first. */
function runner(result: ToolResult, sideEffect?: () => void): VerifyRunner & { commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    executeAsync: async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
      assert.equal(name, "run_tests", "verification runs through the host's own test tool");
      commands.push(String(args["command"]));
      sideEffect?.();
      return result;
    },
  };
}

function inTempConfig<T>(body: () => T | Promise<T>): Promise<T> {
  const home = tmpWorkspace("aether-verify-run-home-");
  const previous = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = home;
  return Promise.resolve(body()).finally(() => {
    if (previous === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = previous;
  });
}

test("no command configured is unknown, and nothing is run", async () => {
  const exec = runner({ output: "", exitCode: 0 });
  const result = await verifyAndRecord(exec, (() => ({ status: 0, stdout: "", stderr: "" })) as Runner, "/repo", "   ");
  assert.equal(result.reading.status, "unknown");
  assert.equal(result.written, null);
  assert.deepEqual(exec.commands, [], "an absent command is not a command to run");
});

test("real git: a green run on a still tree is recorded as verified", async (t) => {
  if (!haveGit) return t.skip("git not available");
  await inTempConfig(async () => {
    const repo = fixture("aether-verify-green-");
    const exec = runner({ output: "24 passed", exitCode: 0 });
    const result = await verifyAndRecord(exec, repo.run, repo.dir, "npm test");

    assert.equal(result.reading.status, "verified");
    assert.deepEqual(exec.commands, ["npm test"]);
    assert.equal(result.written?.exitCode, 0);

    const stored = readVerification(repo.dir);
    assert.equal(stored?.command, "npm test");
    assert.equal(
      classifyVerification(stored, treeIdentity(repo.run, repo.dir)).status,
      "verified",
      "what was written reads back as what was shown",
    );
  });
});

test("real git: a red run is recorded as failed, with the count it could parse", async (t) => {
  if (!haveGit) return t.skip("git not available");
  await inTempConfig(async () => {
    const repo = fixture("aether-verify-red-");
    const exec = runner({ output: "3 failed, 21 passed", exitCode: 1 });
    const result = await verifyAndRecord(exec, repo.run, repo.dir, "npm test");

    assert.equal(result.reading.status, "failed");
    assert.equal(result.written?.remaining, 3);
    assert.match(result.reading.reason, /exited 1 \(3 failing\)/);
  });
});

test("real git: a run whose tree moved underneath it is not recorded at all", async (t) => {
  if (!haveGit) return t.skip("git not available");
  await inTempConfig(async () => {
    const repo = fixture("aether-verify-moved-");
    // The agent writes another file while the suite is running.
    const exec = runner({ output: "24 passed", exitCode: 0 }, () => repo.write("a.txt", "changed mid-run\n"));
    const result = await verifyAndRecord(exec, repo.run, repo.dir, "npm test");

    assert.equal(result.reading.status, "unknown", "a green exit code about no particular tree is not verified");
    assert.match(result.reading.reason, /changed while npm test was running/);
    assert.equal(result.written, null);
    assert.equal(readVerification(repo.dir), null, "nothing was written, so nothing can be read back as verified");
    assert.equal(result.exitCode, 0, "the raw result is still returned for the caller to show");
  });
});

test("real git: an untracked file appearing mid-run also breaks attribution", async (t) => {
  if (!haveGit) return t.skip("git not available");
  await inTempConfig(async () => {
    const repo = fixture("aether-verify-untracked-");
    const exec = runner({ output: "ok", exitCode: 0 }, () => repo.write("coverage.json", "{}\n"));
    const result = await verifyAndRecord(exec, repo.run, repo.dir, "npm test");
    assert.equal(result.reading.status, "unknown");
    assert.equal(result.written, null);
  });
});

test("real git: a second run replaces the first, and an edit afterwards makes it stale", async (t) => {
  if (!haveGit) return t.skip("git not available");
  await inTempConfig(async () => {
    const repo = fixture("aether-verify-replace-");
    await verifyAndRecord(runner({ output: "1 failed", exitCode: 1 }), repo.run, repo.dir, "npm test");
    assert.equal(readVerification(repo.dir)?.exitCode, 1);

    repo.write("a.txt", "fixed\n");
    const second = await verifyAndRecord(runner({ output: "24 passed", exitCode: 0 }), repo.run, repo.dir, "npm test");
    assert.equal(second.reading.status, "verified");
    assert.equal(readVerification(repo.dir)?.exitCode, 0, "the stored record is about the tree that was verified last");

    repo.write("a.txt", "edited again\n");
    assert.equal(
      classifyVerification(readVerification(repo.dir), treeIdentity(repo.run, repo.dir)).status,
      "stale",
      "one edit after the green run and the claim is stale again",
    );
  });
});
