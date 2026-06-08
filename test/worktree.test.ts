import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, worktreeBranch, worktreeAddArgs, mergeHint } from "../src/core/worktree.js";

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
