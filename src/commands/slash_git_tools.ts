// In-REPL git-backed rollback slash commands: /rollback /revert /stage-diff.
// Split out of slash.ts (was 1807 lines) to keep each command group under
// the repo's ~800-line file convention.

import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { theme } from "../ui/theme.js";
import { generateDiff } from "../core/stage_diff.js";

// ── /rollback ─────────────────────────────────

export async function rollbackSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const n = parseInt(arg.trim()) || 1;
  if (n < 1 || n > 50) {
    out.write("usage: /rollback [n]    revert last n filesystem changes (1-50, default 1)\n");
    return;
  }

  const cwd = process.cwd();
  const gitDir = join(cwd, ".git");
  if (!existsSync(gitDir)) {
    out.write(theme.muted("Not in a git repository. /rollback requires git for safe undo.\n"));
    return;
  }

  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  try {
    const status = execSync("git diff --name-only", { cwd, encoding: "utf8", timeout: 5000 });
    const dirty = status.trim().split("\n").filter(Boolean);
    if (dirty.length === 0) {
      out.write("(working tree clean — nothing to rollback)\n");
      return;
    }

    out.write(`${theme.cyan("↩  Ready to rollback")}  ${dirty.length} files changed\n`);
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
    const show = dirty.slice(0, 20);
    for (const f of show) {
      out.write(`  ${theme.muted(f)}\n`);
    }
    if (dirty.length > 20) {
      out.write(`  ${theme.dim(`... and ${dirty.length - 20} more`)}\n`);
    }

    const ok = ctx.flags.yes || (await ctx.confirm(`\nRevert all ${dirty.length} uncommitted changes? [y/N] `));
    if (!ok) {
      out.write("cancelled.\n");
      return;
    }

    execSync("git checkout -- .", { cwd, encoding: "utf8", timeout: 10000 });
    out.write(`${theme.cyan("↩ rolled back")}  ${dirty.length} files restored to last commit.\n`);
    out.write(theme.dim("  Git reflog untouched — all commits preserved.\n"));
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── /stage-diff ────────────────────────────────

export async function stageDiffSlash(ctx: AppContext, out: Writable): Promise<void> {
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

export async function revertSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const target = arg.trim();
  if (!target) {
    out.write("usage: /revert <file|step_id>    surgical rollback\n");
    out.write("  /revert src/core/old.ts        revert single file\n");
    out.write("  /revert step-3                 revert to checkpoint (coming soon)\n");
    return;
  }

  const cwd = process.cwd();
  const gitDir = join(cwd, ".git");
  if (!existsSync(gitDir)) {
    out.write(theme.muted("Not in a git repository.\n"));
    return;
  }

  const { execSync } = require("node:child_process") as typeof import("node:child_process");

  if (target.startsWith("step-") || target.match(/^\d+$/)) {
    out.write(theme.muted("Step-based revert not yet available. Use /rollback to revert all, or /revert <file> for a single file.\n"));
    out.write(theme.dim("  Tracked step checkpoints planned for future release.\n"));
    return;
  }

  try {
    const isTracked = (() => {
      try {
        execSync(`git ls-files --error-unmatch "${target}"`, { cwd, encoding: "utf8", timeout: 3000 });
        return true;
      } catch { return false; }
    })();

    if (!isTracked) {
      out.write(`${theme.muted(target)} is not tracked by git.\n`);
      return;
    }

    const diffOut = execSync(`git diff --name-only -- "${target}"`, { cwd, encoding: "utf8", timeout: 3000 });
    if (!diffOut.trim()) {
      out.write(`(no uncommitted changes in ${target})\n`);
      return;
    }

    const fileDiff = execSync(`git diff -- "${target}"`, { cwd, encoding: "utf8", timeout: 5000 });
    const changes = fileDiff.trim().split("\n").length;

    out.write(`${theme.cyan("↩  Reverting")} ${theme.bold(target)}  (${changes} line changes)\n`);
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));

    for (const line of fileDiff.split("\n").slice(0, 10)) {
      if (line.startsWith("+")) out.write(theme.dim(line) + "\n");
      else if (line.startsWith("-")) out.write(theme.muted(line) + "\n");
      else out.write(theme.dim(line) + "\n");
    }

    const ok = ctx.flags.yes || (await ctx.confirm(`\nRevert ${target} to last commit? [y/N] `));
    if (!ok) {
      out.write("cancelled.\n");
      return;
    }

    execSync(`git checkout -- "${target}"`, { cwd, encoding: "utf8", timeout: 10000 });
    out.write(`${theme.cyan("↩ reverted")}  ${target} restored to last commit.\n`);
  } catch (err: any) {
    if (err?.stderr?.includes("did not match any file")) {
      out.write(`not found: ${target}\n`);
    } else {
      out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}
