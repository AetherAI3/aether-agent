// Worktrees — Claude-Code-style isolation for a coding run. `aether code
// --worktree "<task>"` spins the agent up in a fresh `git worktree` on a new
// branch, so its edits never touch your working tree. When the run finishes we
// print exactly how to merge or throw it away. One flag, zero ceremony.
//
// Worktrees live under ~/.aether-code/worktrees/<branch-leaf> (out of the repo
// so they never pollute `git status`). The branch is auto-named from the task.

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Worktree {
  /** Absolute path the agent runs in (the new worktree). */
  dir: string;
  /** The new branch checked out there. */
  branch: string;
  /** The repo the worktree was cut from. */
  repoRoot: string;
}

/** Where worktrees are parked. Override with AETHER_WORKTREES_DIR (tests). */
export function worktreesRoot(): string {
  const base = process.env["AETHER_WORKTREES_DIR"];
  return base ?? join(homedir(), ".aether-code", "worktrees");
}

/** Slugify a task into a short, branch-safe token. Pure. */
export function slugify(task: string, max = 32): string {
  const s = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "task";
}

/** Build the auto branch name: `aether/<slug>-<id>`. Pure (id injected). */
export function worktreeBranch(task: string, id: string): string {
  return `aether/${slugify(task)}-${id}`;
}

/** git args to add a worktree on a new branch off current HEAD. Pure. */
export function worktreeAddArgs(repoRoot: string, branch: string, dir: string): string[] {
  return ["-C", repoRoot, "worktree", "add", "-b", branch, dir];
}

/** Resolve the repo root for `cwd`, or null if not inside a git repo. */
export function repoRootOf(cwd: string): string | null {
  const r = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim() || null;
}

/**
 * Create a worktree for `task` off `cwd`'s repo. Returns the worktree to run in.
 * Throws with an actionable message if `cwd` isn't a git repo or git fails.
 * `id` is injected (default: short base-36 timestamp) so tests are deterministic.
 */
export function createWorktree(cwd: string, task: string, id?: string): Worktree {
  const repoRoot = repoRootOf(cwd);
  if (!repoRoot) {
    throw new Error("--worktree needs a git repo (run `git init` first, or drop the flag)");
  }
  const safeId = id ?? Date.now().toString(36);
  const branch = worktreeBranch(task, safeId);
  const dir = join(worktreesRoot(), branch.replace(/\//g, "-"));
  const r = spawnSync("git", worktreeAddArgs(repoRoot, branch, dir), { encoding: "utf8" });
  if (r.status !== 0) {
    const why = ((r.stderr ?? "") + (r.stdout ?? "")).trim() || "git worktree add failed";
    throw new Error(`could not create worktree: ${why}`);
  }
  return { dir, branch, repoRoot };
}

/** One-line "what now" footer shown after a worktree run. Pure. */
export function mergeHint(wt: Worktree): string {
  return (
    `\n  worktree: ${wt.dir}  (branch ${wt.branch})\n` +
    `  merge it:   git -C ${wt.repoRoot} merge ${wt.branch}\n` +
    `  discard it: git -C ${wt.repoRoot} worktree remove ${wt.dir} && git -C ${wt.repoRoot} branch -D ${wt.branch}\n`
  );
}
