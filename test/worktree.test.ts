import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ghAuthStatus,
  isGitRepo,
  repoRoot,
  slugify,
  createWorktree,
  linkGhAccount,
  readGhLink,
  type Runner,
  type RunResult,
} from "../src/core/worktree.js";

/** A scripted runner: matches on the first arg (the subcommand) and records calls. */
function runnerFrom(map: (cmd: string, args: string[]) => RunResult): Runner & { calls: string[][] } {
  const calls: string[][] = [];
  const r = ((cmd: string, args: string[]): RunResult => {
    calls.push([cmd, ...args]);
    return map(cmd, args);
  }) as Runner & { calls: string[][] };
  r.calls = calls;
  return r;
}

const ok = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "" });
const fail = (stderr = "nope"): RunResult => ({ status: 1, stdout: "", stderr });

// --- gh auth ---------------------------------------------------------------
test("ghAuthStatus: not authed when gh exits non-zero", () => {
  const run = runnerFrom(() => fail());
  assert.deepEqual(ghAuthStatus(run), { authed: false });
});

test("ghAuthStatus: parses the modern 'account <user>' phrasing", () => {
  const run = runnerFrom(() => ({
    status: 0,
    stdout: "",
    stderr: "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n",
  }));
  const s = ghAuthStatus(run);
  assert.equal(s.authed, true);
  assert.equal(s.user, "octocat");
  assert.equal(s.host, "github.com");
});

test("ghAuthStatus: tolerates the older 'as <user>' phrasing", () => {
  const run = runnerFrom(() => ok("✓ Logged in to github.com as hunter (oauth_token)"));
  const s = ghAuthStatus(run);
  assert.equal(s.authed, true);
  assert.equal(s.user, "hunter");
});

// --- git probing -----------------------------------------------------------
test("isGitRepo / repoRoot read git rev-parse", () => {
  const run = runnerFrom((_c, args) => {
    if (args.includes("--is-inside-work-tree")) return ok("true\n");
    if (args.includes("--show-toplevel")) return ok("/home/u/proj\n");
    return fail();
  });
  assert.equal(isGitRepo(run, "/home/u/proj/sub"), true);
  assert.equal(repoRoot(run, "/home/u/proj/sub"), "/home/u/proj");
});

test("repoRoot returns null outside a repo", () => {
  assert.equal(repoRoot(runnerFrom(() => fail()), "/tmp"), null);
});

// --- slugify (pure) --------------------------------------------------------
test("slugify is branch-safe and bounded", () => {
  assert.equal(slugify("Fix the failing tests!"), "fix-the-failing-tests");
  assert.equal(slugify("  deep recon & repair  "), "deep-recon-repair");
  assert.equal(slugify("!!!"), "task"); // empty -> fallback
  assert.equal(slugify("a".repeat(80)).length <= 32, true);
});

// --- createWorktree --------------------------------------------------------
test("createWorktree runs `git worktree add` on an aether/<slug> branch", () => {
  const base = mkdtempSync(join(tmpdir(), "aether-wt-"));
  try {
    const run = runnerFrom(() => ok());
    const res = createWorktree(run, "/home/u/myrepo", "fix-tests", base);
    assert.equal(res.ok, true);
    assert.equal(res.branch, "aether/fix-tests");
    assert.equal(res.path, join(base, "myrepo-fix-tests"));
    // the actual git invocation
    const add = run.calls.find((c) => c.includes("worktree"));
    assert.ok(add, "ran git worktree");
    assert.deepEqual(add, ["git", "-C", "/home/u/myrepo", "worktree", "add", res.path, "-b", "aether/fix-tests"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("createWorktree retries with a numeric suffix on collision", () => {
  const base = mkdtempSync(join(tmpdir(), "aether-wt-"));
  try {
    let first = true;
    const run = runnerFrom(() => {
      if (first) {
        first = false;
        return fail("fatal: a branch named 'aether/dup' already exists");
      }
      return ok();
    });
    const res = createWorktree(run, "/home/u/myrepo", "dup", base);
    assert.equal(res.ok, true);
    assert.equal(res.branch, "aether/dup-2");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// --- gh <-> Aether local link record ---------------------------------------
test("linkGhAccount writes a record readGhLink reads back", () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-cfg-"));
  const prev = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = dir;
  try {
    const link = linkGhAccount("octocat", "github.com", () => "2026-06-07T00:00:00Z");
    assert.ok(link);
    assert.equal(link?.gh_user, "octocat");
    assert.ok(existsSync(join(dir, "gh-link.json")));
    const read = readGhLink();
    assert.equal(read?.gh_user, "octocat");
    assert.equal(read?.host, "github.com");
    assert.equal(read?.linked_at, "2026-06-07T00:00:00Z");
  } finally {
    if (prev === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readGhLink returns null when there is no record", () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-cfg-"));
  const prev = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = dir;
  try {
    assert.equal(readGhLink(), null);
  } finally {
    if (prev === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
