import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ToolExecutor } from "../src/core/tool_executor.js";

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "aether-gitcommit-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "hello\n");
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

test("git_commit passes a message with shell metacharacters through unexecuted", () => {
  const dir = initRepo();
  try {
    writeFileSync(join(dir, "a.txt"), "changed\n");
    const exec = new ToolExecutor(dir);
    const r = exec.execute("git_commit", { message: 'fix "cap & retry" `whoami` $(id)' });
    assert.equal(r.exitCode, 0);
    const log = spawnSync("git", ["log", "-1", "--pretty=%s"], { cwd: dir, encoding: "utf8" });
    assert.equal(log.stdout.trim(), 'fix "cap & retry" `whoami` $(id)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("git_commit with nothing staged reports it without a fabricated failure", () => {
  const dir = initRepo();
  try {
    const exec = new ToolExecutor(dir);
    const r = exec.execute("git_commit", { message: "no-op" });
    assert.equal(r.exitCode, 0);
    assert.match(r.output, /nothing to commit/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("git_commit surfaces a real failure instead of reporting the old HEAD as success", () => {
  const dir = initRepo();
  try {
    writeFileSync(join(dir, "a.txt"), "changed again\n");
    // Break the repo's ability to commit: a pre-commit hook that always fails.
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\nexit 1\n");
    spawnSync("chmod", ["+x", hookPath]);
    const before = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();

    const exec = new ToolExecutor(dir);
    const r = exec.execute("git_commit", { message: "should fail" });

    assert.notEqual(r.exitCode, 0, "a hook rejection must not report success");
    assert.ok(!r.output.includes(before) || r.exitCode !== 0, "must not silently report the prior HEAD as the new commit");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
