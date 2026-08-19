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
import { generateDiff } from "../core/stage_diff.js";

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

export async function stageDiffSlash(_ctx: AppContext, out: Writable): Promise<void> {
  try {
    const r = generateDiff();

    if (r.files.length === 0) {
      out.write("(working tree clean — nothing to stage)\n");
      return;
    }

    out.write(theme.cyan("📋  Stage Diff\n"));
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));

    out.write(`  ${r.stats.filesChanged} files  +${r.stats.additions} -${r.stats.deletions}\n\n`);

    for (const f of r.files.slice(0, 15)) {
      out.write(`  ${theme.muted(f)}\n`);
    }
    if (r.files.length > 15) {
      out.write(`  ${theme.dim(`... and ${r.files.length - 15} more`)}\n`);
    }

    out.write(`\n${theme.bold("Suggested commit:")}\n`);
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
    out.write(r.commitMessage + "\n");
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));

    const diffLines = r.diff.split("\n").slice(0, 30);
    out.write(`\n${theme.dim("Diff preview (first 30 lines):")}\n`);
    for (const line of diffLines) {
      if (line.startsWith("+")) out.write(theme.dim(line) + "\n");
      else if (line.startsWith("-")) out.write(theme.muted(line) + "\n");
      else out.write(theme.dim(line) + "\n");
    }

    if (r.diff.split("\n").length > 30) {
      out.write(theme.dim("  ... (truncated)\n"));
    }

    out.write(`\n${theme.dim("  Copy the commit message above and commit when ready.")}\n`);
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
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
