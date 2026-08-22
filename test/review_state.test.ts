// Repository state for the review/ship rail.
//
// The parser tests are exact-vector tests: porcelain v2 is a format, and the
// two things that go wrong with it are rename entries (which span two NUL
// fields) and the ahead/behind header (which is absent, not zero, when there is
// no upstream). Both are asserted directly.
//
// The last test is a real-git canary. Everything above it asserts against
// recorded git output, which proves the parser and proves nothing about
// whether git actually says that — so one test drives a real repository.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpWorkspace } from "./tmp_workspace.js";
import {
  githubSpec,
  parseStatusV2,
  readRepoState,
  stagedFiles,
  unstagedFiles,
  untrackedFiles,
} from "../src/core/review_state.js";
import type { Runner, RunResult } from "../src/core/worktree.js";

const OK = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "" });
const FAIL = (stderr = ""): RunResult => ({ status: 1, stdout: "", stderr });

/** A runner over recorded output, keyed by a substring of the argv. */
function fakeGit(routes: Array<[string, RunResult]>): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = args.join(" ");
    for (const [pattern, result] of routes) if (key.includes(pattern)) return result;
    return FAIL("no route");
  };
  return { run, calls };
}

const NUL = "\0";

test("parseStatusV2 reads the branch header, and absent ahead/behind stays null", () => {
  const raw =
    ["# branch.oid abc123", "# branch.head feature/x", "# branch.upstream origin/main"].join(NUL) + NUL;
  const { branch } = parseStatusV2(raw);
  assert.equal(branch.revision, "abc123");
  assert.equal(branch.branch, "feature/x");
  assert.equal(branch.upstream, "origin/main");
  assert.equal(branch.ahead, null, "no branch.ab header means unknown, not zero");
  assert.equal(branch.behind, null);
  assert.equal(branch.detached, false);
});

test("parseStatusV2 reads ahead/behind when git reports it", () => {
  const raw = ["# branch.head main", "# branch.ab +3 -0"].join(NUL) + NUL;
  const { branch } = parseStatusV2(raw);
  assert.equal(branch.ahead, 3);
  assert.equal(branch.behind, 0, "a reported zero IS zero — only an absent header is unknown");
});

test("parseStatusV2 marks a detached head as detached rather than naming a branch", () => {
  const { branch } = parseStatusV2(["# branch.head (detached)", "# branch.oid deadbeef"].join(NUL) + NUL);
  assert.equal(branch.detached, true);
  assert.equal(branch.branch, null);
});

test("parseStatusV2 splits the two halves of the status code", () => {
  // "MM" = staged AND further edited; "M." = staged only; ".M" = unstaged only.
  const raw =
    [
      "1 MM N... 100644 100644 100644 aaa bbb src/both.ts",
      "1 M. N... 100644 100644 100644 aaa bbb src/staged.ts",
      "1 .M N... 100644 100644 100644 aaa bbb src/dirty.ts",
      "? src/new.ts",
    ].join(NUL) + NUL;
  const { files } = parseStatusV2(raw);
  const byPath = new Map(files.map((file) => [file.path, file]));

  assert.equal(byPath.get("src/both.ts")?.staged, true);
  assert.equal(byPath.get("src/both.ts")?.unstaged, true);
  assert.equal(byPath.get("src/staged.ts")?.staged, true);
  assert.equal(byPath.get("src/staged.ts")?.unstaged, false);
  assert.equal(byPath.get("src/dirty.ts")?.staged, false);
  assert.equal(byPath.get("src/dirty.ts")?.unstaged, true);
  assert.equal(byPath.get("src/new.ts")?.untracked, true);
  assert.equal(byPath.get("src/new.ts")?.staged, false);
});

test("a rename consumes its origin field instead of inventing a changed file", () => {
  const raw =
    ["2 R. N... 100644 100644 100644 aaa bbb R100 src/new_name.ts", "src/old_name.ts", "? untracked.txt"].join(NUL) +
    NUL;
  const { files } = parseStatusV2(raw);
  assert.deepEqual(
    files.map((file) => file.path),
    ["src/new_name.ts", "untracked.txt"],
    "the origin path is metadata of the rename, not a second changed file",
  );
  assert.equal(files[0]?.renamedFrom, "src/old_name.ts");
});

test("an unmerged path is reported as unmerged and never as cleanly staged", () => {
  const raw = "u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts" + NUL;
  const { files } = parseStatusV2(raw);
  assert.equal(files[0]?.unmerged, true);
  assert.equal(files[0]?.staged, false, "a conflict is not a staged change");
});

test("ignored paths are not changes", () => {
  const { files } = parseStatusV2(["! dist/out.js", "? kept.txt"].join(NUL) + NUL);
  assert.deepEqual(files.map((file) => file.path), ["kept.txt"]);
});

test("githubSpec accepts the github URL forms and refuses anything else", () => {
  assert.equal(githubSpec("https://github.com/octocat/hello-world.git")?.full, "octocat/hello-world");
  assert.equal(githubSpec("git@github.com:octocat/hello-world.git")?.full, "octocat/hello-world");
  assert.equal(githubSpec("ssh://git@github.com/octocat/hello-world")?.full, "octocat/hello-world");
  assert.equal(githubSpec("https://gitlab.com/octocat/hello-world.git"), null);
  assert.equal(githubSpec("/srv/git/mirror.git"), null);
});

test("readRepoState reports a non-repository as data, never as a throw", () => {
  const { run } = fakeGit([["rev-parse --show-toplevel", FAIL("fatal: not a git repository")]]);
  const state = readRepoState(run, "/tmp/nowhere");
  assert.equal(state.ok, false);
  assert.equal(state.ok === false && state.reason, "not a git repository");
});

test("the push URL is read separately, so a pushurl override cannot hide the destination", () => {
  const { run } = fakeGit([
    ["rev-parse --show-toplevel", OK("/repo\n")],
    ["status --porcelain=v2", OK("# branch.head feature/x" + NUL + "# branch.oid abc\0")],
    ["remote get-url --push origin", OK("https://github.com/evil/elsewhere.git\n")],
    ["remote get-url origin", OK("https://github.com/octocat/hello-world.git\n")],
    ["symbolic-ref", FAIL("")],
    ["rev-parse --verify", FAIL("")],
  ]);
  const state = readRepoState(run, "/repo");
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.remote?.url, "https://github.com/octocat/hello-world.git");
  assert.equal(state.remote?.pushUrl, "https://github.com/evil/elsewhere.git");
  assert.equal(
    state.remote?.spec?.full,
    "evil/elsewhere",
    "the pull-request target follows where the push actually goes",
  );
});

test("an unresolvable base leaves ahead/behind unknown rather than zero", () => {
  const { run } = fakeGit([
    ["rev-parse --show-toplevel", OK("/repo\n")],
    ["status --porcelain=v2", OK("# branch.head feature/x" + NUL + "# branch.oid abc" + NUL)],
    ["remote get-url", FAIL("no such remote")],
    ["symbolic-ref", FAIL("")],
    ["rev-parse --verify", FAIL("")],
  ]);
  const state = readRepoState(run, "/repo");
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.remote, null);
  assert.equal(state.base.revision, null);
  assert.equal(state.aheadOfBase, null, "unknown is not zero");
  assert.equal(state.behindBase, null);
  assert.ok(state.base.reason, "an unresolved base always says why");
});

test("a base read from a local tracking ref is never reported as fetched", () => {
  const { run } = fakeGit([
    ["rev-parse --show-toplevel", OK("/repo\n")],
    ["status --porcelain=v2", OK(["# branch.head f", "# branch.oid head1", "# branch.upstream origin/main"].join(NUL))],
    ["remote get-url", OK("https://github.com/octocat/hello-world.git\n")],
    ["rev-parse --verify --quiet refs/remotes/origin/main", OK("base1\n")],
    ["rev-list --left-right --count", OK("2\t5\n")],
  ]);
  const state = readRepoState(run, "/repo");
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.base.branch, "main");
  assert.equal(state.base.revision, "base1");
  assert.equal(state.base.fetched, false);
  assert.match(state.base.reason ?? "", /not fetched/);
  assert.equal(state.aheadOfBase, 5, "left-right counts base-side first, head-side second");
  assert.equal(state.behindBase, 2);
});

test("a failed fetch reports the failure and does not claim freshness", () => {
  const { run } = fakeGit([
    ["rev-parse --show-toplevel", OK("/repo\n")],
    ["status --porcelain=v2", OK(["# branch.head f", "# branch.oid head1", "# branch.upstream origin/main"].join(NUL))],
    ["remote get-url", OK("https://github.com/octocat/hello-world.git\n")],
    ["fetch --quiet", FAIL("could not resolve host github.com")],
    ["rev-parse --verify --quiet refs/remotes/origin/main", OK("base1\n")],
    ["rev-list --left-right --count", OK("0\t1\n")],
  ]);
  const state = readRepoState(run, "/repo", { fetchBase: true });
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.base.fetched, false);
  assert.match(state.base.reason ?? "", /could not resolve host/);
});

// ── real git ────────────────────────────────────────────────────────────────

test("real git: state reads a live repository", (t) => {
  if (spawnSync("git", ["--version"], { encoding: "utf8" }).error) return t.skip("git not available");
  const dir = tmpWorkspace("aether-review-state-");
  const git = (...args: string[]): RunResult => {
    const result = spawnSync("git", ["-c", "core.literalPathspecs=true", "-C", dir, ...args], { encoding: "utf8" });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  const run: Runner = (cmd, args) => {
    const result = spawnSync(cmd, args, { cwd: dir, encoding: "utf8" });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };

  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "kept.txt"), "one\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");

  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "staged.ts"), "export const a = 1;\n");
  git("add", "--", "src/staged.ts");
  writeFileSync(join(dir, "kept.txt"), "two\n");
  writeFileSync(join(dir, "brand-new.txt"), "hi\n");

  const state = readRepoState(run, dir);
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.head.branch, "main");
  assert.equal(state.head.detached, false);
  assert.ok(state.head.revision, "a committed repository has a head revision");
  assert.deepEqual(stagedFiles(state).map((file) => file.path), ["src/staged.ts"]);
  assert.deepEqual(unstagedFiles(state).map((file) => file.path), ["kept.txt"]);
  assert.deepEqual(untrackedFiles(state).map((file) => file.path), ["brand-new.txt"]);
  assert.equal(state.remote, null, "a repository with no remote reports none");
});
