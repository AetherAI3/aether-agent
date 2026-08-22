// Line counts — the headline number on a review screen.
//
// Two things go wrong with numstat and both are asserted here: a rename spans
// three NUL fields rather than one, and a binary file's "-" is not zero. The
// second is the one that matters at the product level, because "+0 −0" next to a
// changed PNG reads as "nothing changed" rather than "not counted".

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpWorkspace } from "./tmp_workspace.js";
import {
  defaultAsyncRunner,
  numstatArgs,
  parseNumstat,
  readDiffCounts,
  renderCounts,
  totalCounts,
  type AsyncRunner,
} from "../src/core/diff_counts.js";
import type { RunResult } from "../src/core/worktree.js";

const haveGit = !spawnSync("git", ["--version"], { encoding: "utf8" }).error;
const NUL = "\0";

test("an ordinary entry parses to its counts and path", () => {
  const rows = parseNumstat(["12\t3\tsrc/a.ts", "0\t7\tsrc/b.ts"].join(NUL) + NUL);
  assert.deepEqual(rows, [
    { additions: 12, deletions: 3, path: "src/a.ts" },
    { additions: 0, deletions: 7, path: "src/b.ts" },
  ]);
});

test("a rename consumes its two extra fields instead of becoming phantom entries", () => {
  // git writes "adds\tdels\t" and then the old and new paths as separate fields.
  const raw = ["4\t2\t", "src/old.ts", "src/new.ts", "1\t1\tsrc/other.ts"].join(NUL) + NUL;
  const rows = parseNumstat(raw);
  assert.equal(rows.length, 2, "a rename is one file, not three");
  assert.deepEqual(rows[0], { additions: 4, deletions: 2, path: "src/new.ts", renamedFrom: "src/old.ts" });
  assert.equal(rows[1]?.path, "src/other.ts");
});

test("a binary file has no line count, and null is not zero", () => {
  const rows = parseNumstat("-\t-\tlogo.png" + NUL);
  assert.deepEqual(rows, [{ additions: null, deletions: null, path: "logo.png" }]);
});

test("the numstat argv is a read, with pathspec magic off", () => {
  const staged = numstatArgs(true);
  assert.ok(staged.includes("--cached"));
  assert.ok(staged.includes("--no-optional-locks"), "reading must not rewrite the index");
  assert.ok(staged.includes("core.literalPathspecs=true"));
  assert.ok(!numstatArgs(false).includes("--cached"));
});

test("both sides are read, and a failed read leaves nulls rather than zeros", async () => {
  const calls: string[][] = [];
  const run: AsyncRunner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return args.includes("--cached")
      ? { status: 1, stdout: "", stderr: "boom" }
      : { status: 0, stdout: "5\t1\tsrc/a.ts" + NUL, stderr: "" };
  };
  const counts = await readDiffCounts(run, "/repo");
  assert.equal(calls.length, 2, "staged and unstaged are both read");
  const entry = counts.get("src/a.ts");
  assert.deepEqual(entry?.unstaged, { additions: 5, deletions: 1 });
  assert.deepEqual(entry?.staged, { additions: null, deletions: null }, "the failed side stays unknown");
});

test("a file counted on both sides keeps both, and renders their sum", async () => {
  const run: AsyncRunner = async (_cmd, args): Promise<RunResult> => ({
    status: 0,
    stdout: args.includes("--cached") ? "10\t2\tsrc/a.ts" + NUL : "3\t1\tsrc/a.ts" + NUL,
    stderr: "",
  });
  const counts = await readDiffCounts(run, "/repo");
  assert.deepEqual(counts.get("src/a.ts")?.staged, { additions: 10, deletions: 2 });
  assert.deepEqual(counts.get("src/a.ts")?.unstaged, { additions: 3, deletions: 1 });
  assert.equal(renderCounts(counts.get("src/a.ts")), "+13 −3");
});

test("an uncounted path is named in the total, not folded into it", async () => {
  const run: AsyncRunner = async (_cmd, args): Promise<RunResult> => ({
    status: 0,
    stdout: args.includes("--cached") ? "" : ["8\t2\tsrc/a.ts", "-\t-\tlogo.png"].join(NUL) + NUL,
    stderr: "",
  });
  const counts = await readDiffCounts(run, "/repo");
  const total = totalCounts(counts, ["src/a.ts", "logo.png", "brand-new.txt"]);
  assert.equal(total.additions, 8);
  assert.equal(total.deletions, 2);
  assert.deepEqual(
    total.uncounted,
    ["brand-new.txt", "logo.png"],
    "a binary and an untracked file are uncounted, and the screen has to be able to say so",
  );
});

test("renderCounts prints unknown as ? and binary as binary", () => {
  assert.equal(renderCounts(undefined), "?");
  assert.equal(
    renderCounts({ path: "logo.png", staged: { additions: null, deletions: null }, unstaged: { additions: null, deletions: null }, binary: true }),
    "binary",
  );
});

test("real git: counts match a live repository, across both sides and a rename", async (t) => {
  if (!haveGit) return t.skip("git not available");
  const dir = tmpWorkspace("aether-counts-");
  const git = (...args: string[]): RunResult => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");

  writeFileSync(join(dir, "a.txt"), Array.from({ length: 5 }, (_, i) => `a${i}`).join("\n") + "\n");
  writeFileSync(join(dir, "old.txt"), "keep\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");

  // staged: three new lines. unstaged: one more. plus a rename and an untracked file.
  writeFileSync(join(dir, "a.txt"), Array.from({ length: 8 }, (_, i) => `a${i}`).join("\n") + "\n");
  git("add", "--", "a.txt");
  writeFileSync(join(dir, "a.txt"), Array.from({ length: 9 }, (_, i) => `a${i}`).join("\n") + "\n");
  git("mv", "old.txt", "new.txt");
  writeFileSync(join(dir, "untracked.txt"), "hello\n");

  const counts = await readDiffCounts(defaultAsyncRunner(), dir);

  assert.deepEqual(counts.get("a.txt")?.staged, { additions: 3, deletions: 0 });
  assert.deepEqual(counts.get("a.txt")?.unstaged, { additions: 1, deletions: 0 });
  assert.equal(renderCounts(counts.get("a.txt")), "+4 −0");

  const renamed = counts.get("new.txt");
  assert.ok(renamed, "the rename is reported under its new path");
  assert.equal(renamed?.renamedFrom, "old.txt");
  assert.equal(counts.has("old.txt"), false, "and not also under the old one");

  assert.equal(counts.has("untracked.txt"), false, "an untracked file is in no diff");
  assert.deepEqual(
    totalCounts(counts, ["a.txt", "untracked.txt"]).uncounted,
    ["untracked.txt"],
    "so it is named as uncounted rather than counted as zero",
  );
});
