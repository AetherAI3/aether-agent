// In-REPL git-backed rollback slash commands: /rollback /revert /stage-diff.
// Split out of slash.ts (was 1807 lines) to keep each command group under
// the repo's ~800-line file convention.
//
// Two commands here discard the user's uncommitted work, so they follow three
// rules. Every git call is an argv array with literal pathspecs and a `--`
// before any user-supplied path. Nothing is destroyed that the preview did not
// name. And the completion message states what was actually restored, rather
// than the most reassuring thing that could be said.

import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import { SpawnGitRunner, type GitRunner } from "../core/git_commit_guard.js";
import { theme } from "../ui/theme.js";
import { readRepoState } from "../core/review_state.js";
import { suggestCommitMessage } from "../core/review_actions.js";
import { defaultRunner, type Runner } from "../core/worktree.js";
import {
  formatCount,
  formatTotals,
  readLineCounts,
  spawnAsyncRun,
  sumCounts,
  type AsyncRun,
} from "./review_counts.js";

/** /stage-diff reads the repository through the shared state module, so it can
 *  never disagree with what /review shows. Injected for tests. */
export interface StageDiffDeps {
  cwd: string;
  run: Runner;
  runAsync: AsyncRun;
}

export function defaultStageDiffDeps(cwd: string): StageDiffDeps {
  return { cwd, run: defaultRunner(), runAsync: spawnAsyncRun() };
}

/** Injected so the destructive paths are testable without a real repository. */
export interface GitToolDeps {
  cwd: string;
  git: GitRunner;
}

export function defaultGitToolDeps(): GitToolDeps {
  const cwd = process.cwd();
  return { cwd, git: new SpawnGitRunner(cwd) };
}

/**
 * Ask git whether we are in a repository, rather than looking for a `.git`
 * directory. The directory probe reports "not a git repository" for every
 * subdirectory of one, which is where a REPL usually sits.
 */
function repoRoot(deps: GitToolDeps): string | null {
  const result = deps.git.run(["rev-parse", "--show-toplevel"]);
  return result.ok ? result.stdout.trim() || null : null;
}

function lines(raw: string): string[] {
  return raw.trim().split("\n").filter(Boolean);
}

/**
 * `git checkout -- <path>` and `git restore -- <path>` both restore from the
 * INDEX, not from HEAD. When something is staged, the content that comes back
 * is the staged content — so a message promising "last commit" is false exactly
 * when the user has staged work they might be counting on.
 */
function restoreTargetLabel(deps: GitToolDeps, pathspec: readonly string[]): string {
  const staged = deps.git.run(["diff", "--cached", "--name-only", "--", ...pathspec]);
  return staged.ok && staged.stdout.trim() ? "their staged state" : "last commit";
}

// ── /rollback ─────────────────────────────────

const ROLLBACK_USAGE =
  "usage: /rollback    discard uncommitted changes to tracked files\n" +
  "  restores tracked files from the index; untracked files are left alone\n";

export async function rollbackSlash(
  ctx: AppContext,
  out: Writable,
  arg: string,
  deps: GitToolDeps = defaultGitToolDeps(),
): Promise<void> {
  const given = arg.trim();
  if (given) {
    // `/rollback [n]` parsed a count, range-checked it, then never referenced it
    // again — every invocation reverted everything. There is no checkpoint
    // journal behind it, so the honest fix is to refuse the argument rather than
    // keep accepting one that does nothing.
    out.write(
      theme.muted(
        "/rollback takes no argument. The old [n] count never did anything —\n" +
          "  every invocation reverted the whole working tree, whatever number you passed.\n",
      ),
    );
    out.write(ROLLBACK_USAGE);
    return;
  }

  if (repoRoot(deps) === null) {
    out.write(theme.muted("Not in a git repository. /rollback requires git for safe undo.\n"));
    return;
  }

  const status = deps.git.run(["diff", "--name-only"]);
  if (!status.ok) {
    out.write(`✗ ${status.stderr.trim() || "could not read the working tree"}\n`);
    return;
  }
  const dirty = lines(status.stdout);
  if (dirty.length === 0) {
    out.write("(working tree clean — nothing to rollback)\n");
    return;
  }

  const target = restoreTargetLabel(deps, []);

  out.write(`${theme.cyan("↩  Ready to rollback")}  ${dirty.length} files changed\n`);
  out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
  for (const file of dirty.slice(0, 20)) out.write(`  ${theme.muted(file)}\n`);
  if (dirty.length > 20) out.write(`  ${theme.dim(`... and ${dirty.length - 20} more`)}\n`);

  if (target !== "last commit") {
    out.write(
      theme.muted(
        "\n  ! you have staged changes, so these files restore to their STAGED state,\n" +
          "    not to the last commit. To go all the way back to HEAD:\n" +
          "      git restore --source=HEAD --staged --worktree -- .\n",
      ),
    );
  }
  out.write(theme.dim("\n  untracked files are not touched.\n"));

  const ok =
    ctx.flags.yes || (await ctx.confirm(`\nDiscard uncommitted changes to ${dirty.length} files? [y/N] `));
  if (!ok) {
    out.write("cancelled.\n");
    return;
  }

  // `git restore` over `git checkout --`: restore only ever touches files,
  // so it cannot be talked into switching branches by a crafted pathspec.
  const done = deps.git.run(["restore", "--", "."]);
  if (!done.ok) {
    out.write(`✗ ${done.stderr.trim() || "restore failed"}\n`);
    return;
  }
  out.write(`${theme.cyan("↩ rolled back")}  ${dirty.length} files restored to ${target}.\n`);
  out.write(theme.dim("  Git reflog untouched — all commits preserved.\n"));
}

// ── /stage-diff ───────────────────────────────

/**
 * /stage-diff — what changed, in both halves, with measured counts.
 *
 * Rewritten off three defects, each of which produced a confident wrong answer:
 *
 *  1. It scraped `git diff --stat` with a regex over the human summary line.
 *     `--stat` is a rendering: it abbreviates paths, it is width-dependent, and
 *     a binary file's columns are `-`, which the regex turned into 0. Counts
 *     now come from `git diff --numstat -z`, and a count git did not report
 *     renders "?" — never 0.
 *  2. It read the UNSTAGED diff only, so anything already staged was invisible
 *     to a command whose whole job is "show me what I am about to commit".
 *     Both halves are read and labelled now.
 *  3. It was synchronous (three execSync calls), which freezes the REPL key
 *     loop for the length of a `git diff` on a large repository. The counts are
 *     read asynchronously.
 *
 * And it no longer ends with "copy the commit message above": /review and /ship
 * are commands that exist and act on it.
 */
export async function stageDiffSlash(
  ctx: AppContext,
  out: Writable,
  deps: StageDiffDeps = defaultStageDiffDeps(ctx.flags.cwd),
): Promise<void> {
  const state = readRepoState(deps.run, deps.cwd);
  if (!state.ok) {
    out.write(`✗ ${state.reason}\n`);
    return;
  }
  if (state.files.length === 0) {
    out.write("(working tree clean — nothing to stage)\n");
    return;
  }
  const counts = await readLineCounts(deps.runAsync, state.root);
  const paths = state.files.map((file) => file.path);

  out.write(theme.cyan("📋  Stage Diff\n"));
  out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
  out.write(`  ${formatTotals(sumCounts(paths, counts))}\n\n`);

  // Every row, not the first 15. This is a review surface, and a review that
  // hides rows is how work gets committed that nobody looked at.
  for (const file of state.files) {
    const half = file.untracked
      ? "untracked"
      : file.staged && file.unstaged
        ? "staged + more"
        : file.staged
          ? "staged"
          : "unstaged";
    out.write(`  ${theme.muted(file.path)}  ${formatCount(counts.get(file.path))}  ${theme.dim(half)}\n`);
  }

  out.write(`\n${theme.bold("Suggested commit:")}\n`);
  out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
  out.write(suggestCommitMessage(paths) + "\n");
  out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));

  out.write(`\n${theme.dim("  /review          pick files or hunks, stage, revert, and commit")}\n`);
  out.write(`${theme.dim("  /ship            publish the branch and open a pull request")}\n`);
}

// ── /revert ─────────────────────────────────────

export async function revertSlash(
  ctx: AppContext,
  out: Writable,
  arg: string,
  deps: GitToolDeps = defaultGitToolDeps(),
): Promise<void> {
  const target = arg.trim();
  if (!target) {
    out.write("usage: /revert <file>    discard uncommitted changes to one tracked file\n");
    out.write("  /revert src/core/old.ts\n");
    return;
  }

  if (repoRoot(deps) === null) {
    out.write(theme.muted("Not in a git repository.\n"));
    return;
  }

  if (target.startsWith("step-") || /^\d+$/.test(target)) {
    // No checkpoint journal exists, so this cannot work and is not "coming soon".
    out.write(
      theme.muted(
        "/revert takes a file path. There are no step checkpoints to revert to —\n" +
          "  nothing records per-step filesystem state. Use /revert <file>, or\n" +
          "  /rollback to discard every uncommitted change.\n",
      ),
    );
    return;
  }

  if (!deps.git.run(["ls-files", "--error-unmatch", "--", target]).ok) {
    out.write(`${theme.muted(target)} is not tracked by git.\n`);
    return;
  }

  const changed = deps.git.run(["diff", "--name-only", "--", target]);
  if (!changed.ok) {
    out.write(`✗ ${changed.stderr.trim() || "could not read the working tree"}\n`);
    return;
  }
  if (!changed.stdout.trim()) {
    out.write(`(no uncommitted changes in ${target})\n`);
    return;
  }

  const fileDiff = deps.git.run(["diff", "--", target]).stdout;
  const restoresTo = restoreTargetLabel(deps, [target]);

  out.write(`${theme.cyan("↩  Reverting")} ${theme.bold(target)}  (${lines(fileDiff).length} line changes)\n`);
  out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
  for (const line of fileDiff.split("\n").slice(0, 10)) {
    out.write((line.startsWith("-") ? theme.muted(line) : theme.dim(line)) + "\n");
  }
  if (restoresTo !== "last commit") {
    out.write(
      theme.muted(
        `\n  ! ${target} has staged changes, so it restores to its STAGED state,\n` +
          "    not to the last commit.\n",
      ),
    );
  }

  const ok = ctx.flags.yes || (await ctx.confirm(`\nRestore ${target} to ${restoresTo}? [y/N] `));
  if (!ok) {
    out.write("cancelled.\n");
    return;
  }

  const done = deps.git.run(["restore", "--", target]);
  if (!done.ok) {
    const why = done.stderr.trim();
    out.write(why.includes("did not match any file") ? `not found: ${target}\n` : `✗ ${why || "restore failed"}\n`);
    return;
  }
  out.write(`${theme.cyan("↩ reverted")}  ${target} restored to ${restoresTo}.\n`);
}
