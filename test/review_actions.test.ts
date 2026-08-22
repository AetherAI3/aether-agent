// The mutating half of the review rail.
//
// Most of this file drives a REAL repository, because the failures worth
// catching are the ones a fake runner cannot have: a hunk patch git refuses to
// apply, an index that does not end up holding what was selected, a revert that
// discards more than the preview named. Argv-shape assertions are kept for the
// two paths where the argv IS the safety property.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpWorkspace } from "./tmp_workspace.js";
import {
  applyRevert,
  buildPatch,
  commitSelected,
  parseUnifiedDiff,
  planCommit,
  planRevert,
  readFileDiff,
  resolveSelection,
  stageFiles,
  stageHunks,
  suggestCommitMessage,
  unstageFiles,
  unstageHunks,
  type RevertPlan,
} from "../src/core/review_actions.js";
import { readRepoState, type RepoState } from "../src/core/review_state.js";
import type { Runner, RunResult } from "../src/core/worktree.js";

const haveGit = !spawnSync("git", ["--version"], { encoding: "utf8" }).error;

interface Repo {
  dir: string;
  run: Runner;
  git: (...args: string[]) => RunResult;
  state: () => RepoState;
  write: (path: string, body: string) => void;
  read: (path: string) => string;
}

function repo(prefix: string): Repo {
  const dir = tmpWorkspace(prefix);
  const run: Runner = (cmd, args, cwd) => {
    const result = spawnSync(cmd, args, { cwd: cwd ?? dir, encoding: "utf8" });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  const git = (...args: string[]): RunResult => run("git", ["-C", dir, ...args]);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  // Windows developer boxes commonly set core.autocrlf globally. Left on, git
  // rewrites every line ending on checkout, so a one-line edit produces a
  // whole-file diff and `restore` hands back CRLF content the test wrote as LF.
  // The rail does not care either way; the fixtures do.
  git("config", "core.autocrlf", "false");
  const state = (): RepoState => {
    const read = readRepoState(run, dir);
    assert.equal(read.ok, true, read.ok ? "" : read.reason);
    return read as RepoState;
  };
  return {
    dir,
    run,
    git,
    state,
    write: (path, body) => writeFileSync(join(dir, path), body, "utf8"),
    read: (path) => readFileSync(join(dir, path), "utf8"),
  };
}

// Long enough that an edit near the top and an edit near the bottom are more
// than two context windows apart, so git emits two hunks rather than merging
// them into one — which is the whole point of the hunk-selection tests.
const LINES = Array.from({ length: 24 }, (_, index) => `line-${index + 1}`);
const TEN = LINES.join("\n") + "\n";
const EARLY = "line-2";
const LATE = "line-22";

// ── pure ────────────────────────────────────────────────────────────────────

test("a selection naming a path the state never reported is refused, not sanitised", () => {
  const state = {
    ok: true,
    root: "/repo",
    files: [{ path: "a.ts", index: ".", worktree: "M", staged: false, unstaged: true, untracked: false, unmerged: false }],
  } as unknown as RepoState;

  const resolved = resolveSelection(state, ["a.ts", "--force", "../../etc/passwd"]);
  assert.deepEqual(resolved.files.map((file) => file.path), ["a.ts"]);
  assert.deepEqual(resolved.unknown, ["--force", "../../etc/passwd"]);

  const calls: string[][] = [];
  const run: Runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    return { status: 0, stdout: "", stderr: "" };
  };
  const outcome = stageFiles(run, state, ["a.ts", "--force"]);
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /not a changed path/);
  assert.equal(calls.length, 0, "a refused selection never reaches git at all");
});

test("staging uses a literal pathspec after --", () => {
  const state = {
    ok: true,
    root: "/repo",
    files: [{ path: ":weird.ts", index: ".", worktree: "M", staged: false, unstaged: true, untracked: false, unmerged: false }],
  } as unknown as RepoState;
  const calls: string[][] = [];
  const run: Runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    return { status: 0, stdout: "", stderr: "" };
  };
  stageFiles(run, state, [":weird.ts"]);
  const argv = calls[0]!;
  assert.equal(argv[0], "git");
  assert.ok(argv.includes("core.literalPathspecs=true"), "pathspec magic is switched off");
  const separator = argv.indexOf("--");
  assert.ok(separator > 0 && argv[separator + 1] === ":weird.ts", "the path sits after -- as data");
});

test("unstaging uses restore --staged, which cannot move HEAD", () => {
  const state = {
    ok: true,
    root: "/repo",
    files: [{ path: "a.ts", index: "M", worktree: ".", staged: true, unstaged: false, untracked: false, unmerged: false }],
  } as unknown as RepoState;
  const calls: string[][] = [];
  const run: Runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    return { status: 0, stdout: "", stderr: "" };
  };
  unstageFiles(run, state, ["a.ts"]);
  const argv = calls[0]!.join(" ");
  assert.match(argv, /restore --staged -- a\.ts/);
  assert.ok(!argv.includes("reset"), "reset can move HEAD; restore cannot");
});

test("parseUnifiedDiff splits hunks and keeps the preamble verbatim", () => {
  const raw = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,3 @@",
    " one",
    "-two",
    "+TWO",
    " three",
    "@@ -8,2 +8,3 @@",
    " eight",
    "+EIGHT AND A HALF",
    " nine",
    "",
  ].join("\n");
  const [file] = parseUnifiedDiff(raw);
  assert.equal(file?.path, "src/a.ts");
  assert.equal(file?.hunks.length, 2);
  assert.equal(file?.hunks[0]?.additions, 1);
  assert.equal(file?.hunks[0]?.deletions, 1);
  assert.deepEqual(file?.preamble, [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
  ]);

  const patch = buildPatch(file!, [2]);
  assert.match(patch ?? "", /@@ -8,2 \+8,3 @@/);
  assert.ok(!(patch ?? "").includes("+TWO"), "an unselected hunk is not in the patch");
  assert.ok((patch ?? "").endsWith("\n"), "a patch git will read ends with a newline");
  assert.equal(buildPatch(file!, [9]), null, "asking for a hunk that is not there is not a patch");
});

test("planCommit refuses an index holding work the user did not select", () => {
  const state = {
    ok: true,
    root: "/repo",
    files: [
      { path: "mine.ts", index: ".", worktree: "M", staged: false, unstaged: true, untracked: false, unmerged: false },
      { path: "theirs.ts", index: "M", worktree: ".", staged: true, unstaged: false, untracked: false, unmerged: false },
    ],
  } as unknown as RepoState;

  const refused = planCommit(state, ["mine.ts"]);
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.unrelatedStaged, ["theirs.ts"]);
  assert.match(refused.reason ?? "", /did not select/);

  const explicit = planCommit(state, ["mine.ts", "theirs.ts"]);
  assert.equal(explicit.ok, true, "selecting it explicitly is how you include it");
  assert.deepEqual(explicit.paths, ["mine.ts", "theirs.ts"]);
});

test("planCommit refuses an unresolved conflict", () => {
  const state = {
    ok: true,
    root: "/repo",
    files: [{ path: "c.ts", index: "U", worktree: "U", staged: false, unstaged: true, untracked: false, unmerged: true }],
  } as unknown as RepoState;
  const plan = planCommit(state, ["c.ts"]);
  assert.equal(plan.ok, false);
  assert.match(plan.reason ?? "", /conflict/);
});

test("the suggested message describes the shape of the change, not its intent", () => {
  assert.match(suggestCommitMessage(["test/a.test.ts", "test/b.test.ts"]), /^test: /);
  assert.match(suggestCommitMessage(["docs/guide.md"]), /^docs: update guide\.md/);
  assert.match(suggestCommitMessage(["src/core/thing.ts"]), /^feat\(core\): update thing\.ts/);
  assert.equal(suggestCommitMessage([]), "");
});

// ── real git ────────────────────────────────────────────────────────────────

test("real git: staging one file leaves the other alone", (t) => {
  if (!haveGit) return t.skip("git not available");
  const r = repo("aether-actions-stage-");
  r.write("a.txt", "one\n");
  r.write("b.txt", "one\n");
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "first");
  r.write("a.txt", "two\n");
  r.write("b.txt", "two\n");

  const staged = stageFiles(r.run, r.state(), ["a.txt"]);
  assert.equal(staged.ok, true, staged.message);

  const after = r.state();
  assert.deepEqual(after.files.filter((file) => file.staged).map((file) => file.path), ["a.txt"]);
  assert.deepEqual(
    after.files.filter((file) => file.unstaged && !file.staged).map((file) => file.path),
    ["b.txt"],
  );
});

test("real git: one hunk of a file stages while the rest stays out of the index", (t) => {
  if (!haveGit) return t.skip("git not available");
  const r = repo("aether-actions-hunk-");
  r.write("a.txt", TEN);
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "first");
  // Two changes far enough apart that git emits two hunks.
  r.write("a.txt", TEN.replace(EARLY, "TWO").replace(LATE, "NINE"));

  const before = r.state();
  const diff = readFileDiff(r.run, before, "a.txt", false);
  assert.equal(diff?.hunks.length, 2, "the fixture must really produce two hunks");

  const outcome = stageHunks(r.run, before, "a.txt", [1]);
  assert.equal(outcome.ok, true, outcome.message);

  const cached = r.git("diff", "--cached", "--no-color", "--", "a.txt").stdout;
  assert.ok(cached.includes("+TWO"), "the selected hunk is in the index");
  assert.ok(!cached.includes("+NINE"), "the unselected hunk is not");
  assert.match(r.read("a.txt"), /NINE/, "the worktree still has both edits");

  // And back out again: unstaging the same hunk empties the index.
  const undone = unstageHunks(r.run, r.state(), "a.txt", [1]);
  assert.equal(undone.ok, true, undone.message);
  assert.equal(r.git("diff", "--cached", "--name-only").stdout.trim(), "", "the index is empty again");
  assert.match(r.read("a.txt"), /TWO/, "unstaging never touches the worktree");
});

test("real git: a revert discards exactly what the preview named", (t) => {
  if (!haveGit) return t.skip("git not available");
  const r = repo("aether-actions-revert-");
  r.write("a.txt", TEN);
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "first");
  r.write("a.txt", TEN.replace(EARLY, "TWO").replace(LATE, "NINE"));

  const plan = planRevert(r.run, r.state(), "a.txt", [2]);
  assert.ok("preview" in plan, `expected a plan, got: ${JSON.stringify(plan)}`);
  const revertPlan = plan as RevertPlan;
  assert.equal(revertPlan.restoresTo, "the last commit");
  assert.ok(revertPlan.preview.includes("+NINE"));
  assert.ok(!revertPlan.preview.includes("+TWO"), "the preview names only what will be discarded");

  const applied = applyRevert(r.run, r.state(), revertPlan);
  assert.equal(applied.ok, true, applied.message);
  const body = r.read("a.txt");
  assert.match(body, /TWO/, "the hunk that was not previewed survives");
  assert.ok(!body.includes("NINE"), "the previewed hunk is gone");
});

test("real git: a file that moved between preview and confirmation is not discarded", (t) => {
  if (!haveGit) return t.skip("git not available");
  const r = repo("aether-actions-revert-race-");
  r.write("a.txt", TEN);
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "first");
  r.write("a.txt", TEN.replace(EARLY, "TWO"));

  const plan = planRevert(r.run, r.state(), "a.txt", null) as RevertPlan;
  assert.ok(plan.preview.includes("+TWO"));

  // The agent writes again while the user is reading the confirmation prompt.
  r.write("a.txt", TEN.replace(EARLY, "TWO").replace(LATE, "FIVE"));

  const applied = applyRevert(r.run, r.state(), plan);
  assert.equal(applied.ok, false);
  assert.match(applied.message, /changed since the preview/);
  assert.match(r.read("a.txt"), /FIVE/, "the newer edit is still there — nothing was discarded");
});

test("real git: a staged file reverts to its staged state, and says so", (t) => {
  if (!haveGit) return t.skip("git not available");
  const r = repo("aether-actions-revert-staged-");
  r.write("a.txt", "one\n");
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "first");
  r.write("a.txt", "STAGED\n");
  r.git("add", "--", "a.txt");
  r.write("a.txt", "WORKTREE\n");

  const plan = planRevert(r.run, r.state(), "a.txt", null) as RevertPlan;
  assert.equal(
    plan.restoresTo,
    "its staged state",
    "restore reads the index, so promising the last commit would be false",
  );
  const applied = applyRevert(r.run, r.state(), plan);
  assert.equal(applied.ok, true, applied.message);
  assert.equal(r.read("a.txt"), "STAGED\n");
});

test("real git: an untracked file is refused rather than deleted", (t) => {
  if (!haveGit) return t.skip("git not available");
  const r = repo("aether-actions-revert-untracked-");
  r.write("keep.txt", "one\n");
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "first");
  r.write("new.txt", "please do not delete me\n");

  const plan = planRevert(r.run, r.state(), "new.txt", null);
  assert.ok(!("preview" in plan), "an untracked file has nothing to restore from");
  assert.equal(r.read("new.txt"), "please do not delete me\n");
});

test("real git: a commit contains the selection and nothing else", (t) => {
  if (!haveGit) return t.skip("git not available");
  const r = repo("aether-actions-commit-");
  r.write("a.txt", "one\n");
  r.write("b.txt", "one\n");
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "first");
  r.write("a.txt", "two\n");
  r.write("b.txt", "two\n");

  const plan = planCommit(r.state(), ["a.txt"]);
  assert.equal(plan.ok, true, plan.reason);
  const outcome = commitSelected(r.run, r.state(), plan, "fix(a): only a");
  assert.equal(outcome.ok, true, outcome.message);
  assert.ok(outcome.revision, "a successful commit reports the revision it made");

  const named = r.git("show", "--name-only", "--format=", "HEAD").stdout.trim().split("\n").filter(Boolean);
  assert.deepEqual(named, ["a.txt"]);
  assert.match(r.read("b.txt"), /two/, "the unselected file keeps its uncommitted change");
  assert.equal(r.git("diff", "--cached", "--name-only").stdout.trim(), "", "the index is left clean");
});

test("real git: someone else's staged file is not swept into the commit", (t) => {
  if (!haveGit) return t.skip("git not available");
  const r = repo("aether-actions-commit-unrelated-");
  r.write("mine.txt", "one\n");
  r.write("theirs.txt", "one\n");
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "first");
  r.write("mine.txt", "two\n");
  r.write("theirs.txt", "two\n");
  r.git("add", "--", "theirs.txt");

  const plan = planCommit(r.state(), ["mine.txt"]);
  assert.equal(plan.ok, false);
  const outcome = commitSelected(r.run, r.state(), plan, "fix: mine only");
  assert.equal(outcome.ok, false, "a refused plan cannot be committed anyway");
  assert.equal(r.git("rev-list", "--count", "HEAD").stdout.trim(), "1", "no commit was made");
  assert.equal(
    r.git("diff", "--cached", "--name-only").stdout.trim(),
    "theirs.txt",
    "the other person's staged work is left exactly as it was",
  );
});

test("real git: an empty message is refused before anything is staged", (t) => {
  if (!haveGit) return t.skip("git not available");
  const r = repo("aether-actions-commit-msg-");
  r.write("a.txt", "one\n");
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "first");
  r.write("a.txt", "two\n");

  const plan = planCommit(r.state(), ["a.txt"]);
  const outcome = commitSelected(r.run, r.state(), plan, "   ");
  assert.equal(outcome.ok, false);
  assert.equal(r.git("diff", "--cached", "--name-only").stdout.trim(), "", "nothing was left staged");
});
