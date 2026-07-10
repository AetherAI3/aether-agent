import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ToolExecutor } from "../src/core/tool_executor.js";

const canSpawnGit = !spawnSync("git", ["--version"], { encoding: "utf8" }).error;

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

test("git_commit passes a message with shell metacharacters through unexecuted", (t) => {
  if (!canSpawnGit) { t.skip("sandbox blocks child process spawning"); return; }
  const dir = initRepo();
  try {
    const exec = new ToolExecutor(dir);
    writeFileSync(join(dir, "a.txt"), "changed\n");
    const r = exec.execute("git_commit", { message: 'fix "cap & retry" `whoami` $(id)' });
    assert.equal(r.exitCode, 0);
    const log = spawnSync("git", ["log", "-1", "--pretty=%s"], { cwd: dir, encoding: "utf8" });
    assert.equal(log.stdout.trim(), 'fix "cap & retry" `whoami` $(id)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("git_commit with nothing staged reports it without a fabricated failure", (t) => {
  if (!canSpawnGit) { t.skip("sandbox blocks child process spawning"); return; }
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

test("run_tests with no explicit command and no configured testCmd does not default to pytest", () => {
  // Regression for cac0399: an unset test_cmd must mean "unverifiable", never a
  // silent fallback to a real test runner. brain_protocol.ts's wire-encoding
  // default was fixed there; this covers the sibling default in ToolExecutor
  // itself, which is what actually executes brain-initiated run_tests calls.
  const dir = mkdtempSync(join(tmpdir(), "aether-runtests-"));
  try {
    const exec = new ToolExecutor(dir); // no testCmd passed — must NOT become "pytest -q"
    const r = exec.execute("run_tests", {});
    assert.doesNotMatch(r.output, /pytest/i, "must never silently run pytest when no test_cmd is configured");
    assert.notEqual(r.exitCode, 0, "an unverifiable run_tests call must not report success");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run_tests still honors an explicit command even with no configured testCmd", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aether-runtests-explicit-"));
  try {
    const exec = new ToolExecutor(dir);
    const r = exec.execute("run_tests", { command: process.platform === "win32" ? "exit 0" : "true" });
    if (/spawn error EPERM/.test(r.output)) { t.skip("sandbox blocks child process spawning"); return; }
    assert.equal(r.exitCode, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run_tests honors a configured testCmd when the call omits an explicit command", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aether-runtests-cfg-"));
  try {
    const exec = new ToolExecutor(dir, process.platform === "win32" ? "exit 0" : "true");
    const r = exec.execute("run_tests", {});
    if (/spawn error EPERM/.test(r.output)) { t.skip("sandbox blocks child process spawning"); return; }
    assert.equal(r.exitCode, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("git_commit surfaces a real failure instead of reporting the old HEAD as success", (t) => {
  if (!canSpawnGit) { t.skip("sandbox blocks child process spawning"); return; }
  const dir = initRepo();
  try {
    const exec = new ToolExecutor(dir);
    writeFileSync(join(dir, "a.txt"), "changed again\n");
    // Break the repo's ability to commit: a pre-commit hook that always fails.
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\nexit 1\n");
    spawnSync("chmod", ["+x", hookPath]);
    const before = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();

    const r = exec.execute("git_commit", { message: "should fail" });

    assert.notEqual(r.exitCode, 0, "a hook rejection must not report success");
    assert.ok(!r.output.includes(before) || r.exitCode !== 0, "must not silently report the prior HEAD as the new commit");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
