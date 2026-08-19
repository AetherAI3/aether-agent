import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ghAuthStatus,
  isGitRepo,
  repoRoot,
  slugify,
  createGatedWorktree,
  linkGhAccount,
  readGhLink,
  worktreeBranch,
  worktreeAddArgs,
  mergeHint,
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

// --- createGatedWorktree (the gh-gated repo-confirm flow) ------------------
test("createGatedWorktree runs `git worktree add` on an aether/<slug> branch", () => {
  const base = mkdtempSync(join(tmpdir(), "aether-wt-"));
  try {
    const run = runnerFrom(() => ok());
    const res = createGatedWorktree(run, "/home/u/myrepo", "fix-tests", base);
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

test("createGatedWorktree retries with a numeric suffix on collision", () => {
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
    const res = createGatedWorktree(run, "/home/u/myrepo", "dup", base);
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

// --- flow 1: flag-driven worktree helpers (--worktree / --repo) ------------
test("slugify makes a branch-safe token", () => {
  assert.equal(slugify("Fix the failing tests!"), "fix-the-failing-tests");
  assert.equal(slugify("  multiple   spaces  "), "multiple-spaces");
  assert.equal(slugify(""), "task");
  assert.equal(slugify("$$$"), "task");
});

test("slugify caps length and trims trailing dashes", () => {
  const s = slugify("a".repeat(50));
  assert.ok(s.length <= 32);
  assert.doesNotMatch(s, /-$/);
});

test("worktreeBranch composes aether/<slug>-<id>", () => {
  assert.equal(worktreeBranch("Add login page", "abc123"), "aether/add-login-page-abc123");
});

test("worktreeAddArgs builds the git invocation", () => {
  assert.deepEqual(
    worktreeAddArgs("/repo", "aether/x-1", "/wt/aether-x-1"),
    ["-C", "/repo", "worktree", "add", "-b", "aether/x-1", "/wt/aether-x-1"],
  );
});

test("mergeHint names the branch, merge, and discard paths", () => {
  const hint = mergeHint({ dir: "/wt/x", branch: "aether/x-1", repoRoot: "/repo" });
  assert.match(hint, /aether\/x-1/);
  assert.match(hint, /merge aether\/x-1/);
  assert.match(hint, /worktree remove \/wt\/x/);
});

// ── exact remote base (SC-A7) ───────────────────────────────────────────────
// `git fetch` moves remote refs and FETCH_HEAD; it does NOT move the mirror's
// checked-out HEAD. So `worktree add -b <branch> <dir>` with no start-point
// branches off whatever the mirror already had, even though the run just
// reported a freshly fetched tip. The base must be pinned explicitly.

test("worktreeAddArgs pins the start revision when one is given", () => {
  assert.deepEqual(worktreeAddArgs("/repo", "aether/x-1", "/wt", "c".repeat(40)), [
    "-C",
    "/repo",
    "worktree",
    "add",
    "-b",
    "aether/x-1",
    "/wt",
    "c".repeat(40),
  ]);
});

test("worktreeAddArgs without a start revision is unchanged", () => {
  assert.deepEqual(worktreeAddArgs("/repo", "aether/x-1", "/wt"), [
    "-C",
    "/repo",
    "worktree",
    "add",
    "-b",
    "aether/x-1",
    "/wt",
  ]);
});

test("the pinned revision is the last argv element, so git reads it as the start point", () => {
  const argv = worktreeAddArgs("/repo", "aether/x-1", "/wt", "deadbee");
  assert.equal(argv[argv.length - 1], "deadbee");
  assert.equal(argv[argv.length - 2], "/wt", "the directory must still precede the start point");
});

// Real-git canary for the stale-base defect. Everything above asserts argv;
// this asserts the resulting checkout. The failure it guards is specific:
// `git fetch` advances remote refs and FETCH_HEAD but leaves the mirror's own
// HEAD where it was, so an unpinned `worktree add` starts from the OLD commit
// while the run has just printed the NEW one.
{
  const git = (cwd: string, ...args: string[]): string =>
    spawnSync("git", ["-c", "core.literalPathspecs=true", "-C", cwd, ...args], { encoding: "utf8" }).stdout.trim();
  const canSpawnGit = !spawnSync("git", ["--version"], { encoding: "utf8" }).error;

  test("a pinned worktree starts at the fetched revision, not the mirror's stale HEAD", (t) => {
    if (!canSpawnGit) return t.skip("git not available");
    const root = mkdtempSync(join(tmpdir(), "aether-base-"));
    const remote = join(root, "remote");
    const mirror = join(root, "mirror");

    // A remote with one commit; clone it, so mirror HEAD == remote tip == A.
    mkdirSync(remote, { recursive: true });
    git(remote, "init", "-q", "-b", "main");
    git(remote, "config", "user.email", "t@t.t");
    git(remote, "config", "user.name", "t");
    writeFileSync(join(remote, "a.txt"), "A\n");
    git(remote, "add", "-A");
    git(remote, "commit", "-q", "-m", "A");
    spawnSync("git", ["clone", "-q", remote, mirror], { encoding: "utf8" });
    const staleHead = git(mirror, "rev-parse", "HEAD");

    // The remote moves on. The mirror knows nothing about it yet.
    writeFileSync(join(remote, "a.txt"), "C\n");
    git(remote, "add", "-A");
    git(remote, "commit", "-q", "-m", "C");
    const remoteTip = git(remote, "rev-parse", "HEAD");
    assert.notEqual(staleHead, remoteTip, "the fixture must actually diverge");

    // Fetch, exactly as refreshMirror does — refs move, HEAD does not.
    git(mirror, "fetch", "--prune", "origin");
    const fetched = git(mirror, "rev-parse", "FETCH_HEAD");
    assert.equal(fetched, remoteTip, "fetch should resolve the remote tip");
    assert.equal(
      git(mirror, "rev-parse", "HEAD"),
      staleHead,
      "fetch must NOT move the mirror's HEAD — this is the whole defect",
    );

    // Cut the worktree the way the product now does: pinned to the fetched tip.
    const dir = join(root, "wt");
    const r = spawnSync("git", worktreeAddArgs(mirror, "aether/pinned-1", dir, fetched), { encoding: "utf8" });
    assert.equal(r.status, 0, `worktree add failed: ${r.stderr}`);

    assert.equal(git(dir, "rev-parse", "HEAD"), remoteTip, "the worktree must start at the fetched revision");
    assert.notEqual(git(dir, "rev-parse", "HEAD"), staleHead, "it must not start at the mirror's stale HEAD");
  });
}
