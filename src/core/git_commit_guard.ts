import { spawnSync } from "node:child_process";

export interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitRunner {
  run(args: string[]): GitRunResult;
}

export class SpawnGitRunner implements GitRunner {
  constructor(private readonly cwd: string) {}

  run(args: string[]): GitRunResult {
    const result = spawnSync("git", args, {
      cwd: this.cwd,
      shell: false,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error) {
      return {
        ok: false,
        stdout: "",
        stderr: result.error.message,
        exitCode: 1,
      };
    }
    const exitCode = result.status ?? 1;
    return {
      ok: exitCode === 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode,
    };
  }
}

export function parsePorcelainPaths(raw: string): string[] {
  const fields = raw.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    if (!entry) continue;
    if (entry.length < 4 || entry[2] !== " ") continue;
    const code = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (code.includes("R") || code.includes("C")) index += 1;
  }
  return [...new Set(paths)].sort();
}

export function parseNulPaths(raw: string): string[] {
  return [...new Set(raw.split("\0").filter(Boolean))].sort();
}

export interface GitCommitPlan {
  ok: boolean;
  candidates: string[];
  reason?: string;
}

export function planGitCommit(
  initialDirty: Iterable<string>,
  initialStaged: Iterable<string>,
  currentDirty: Iterable<string>,
  currentStaged: Iterable<string>,
): GitCommitPlan {
  const baseline = new Set(initialDirty);
  const initialIndex = [...new Set(initialStaged)];
  if (initialIndex.length) {
    return { ok: false, candidates: [], reason: "pre-existing staged changes" };
  }
  const staged = [...new Set(currentStaged)];
  if (staged.length) {
    return { ok: false, candidates: [], reason: "unexpected staged changes" };
  }
  const candidates = [...new Set(currentDirty)]
    .filter((path) => !baseline.has(path))
    .sort();
  if (candidates.length > 1000) {
    return { ok: false, candidates: [], reason: "more than 1000 new paths" };
  }
  return { ok: true, candidates };
}

function samePaths(left: Iterable<string>, right: Iterable<string>): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((path, index) => path === b[index]);
}

export interface GitCommitResult {
  output: string;
  exitCode: number;
}

export class GitCommitGuard {
  private readonly initialDirty: string[];
  private readonly initialStaged: string[];
  private readonly initError: string | null;

  constructor(private readonly runner: GitRunner) {
    const dirty = runner.run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const staged = runner.run(["diff", "--cached", "--name-only", "-z"]);
    this.initialDirty = dirty.ok ? parsePorcelainPaths(dirty.stdout) : [];
    this.initialStaged = staged.ok ? parseNulPaths(staged.stdout) : [];
    this.initError = dirty.ok && staged.ok ? null : "not a usable git repository";
  }

  commit(message: string): GitCommitResult {
    if (this.initError) return { output: "[git_commit refused: " + this.initError + "]", exitCode: 1 };

    const dirty = this.runner.run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const staged = this.runner.run(["diff", "--cached", "--name-only", "-z"]);
    if (!dirty.ok || !staged.ok) {
      return { output: "[git_commit refused: unable to inspect repository state]", exitCode: 1 };
    }
    const plan = planGitCommit(
      this.initialDirty,
      this.initialStaged,
      parsePorcelainPaths(dirty.stdout),
      parseNulPaths(staged.stdout),
    );
    if (!plan.ok) return { output: "[git_commit refused: " + plan.reason + "]", exitCode: 1 };
    if (!plan.candidates.length) return { output: "[nothing new to commit]", exitCode: 0 };

    const added = this.runner.run(["add", "-A", "--", ...plan.candidates]);
    if (!added.ok) return { output: "[git_commit add failed: " + added.stderr.trim() + "]", exitCode: added.exitCode };

    const after = this.runner.run(["diff", "--cached", "--name-only", "-z"]);
    const stagedAfter = after.ok ? parseNulPaths(after.stdout) : [];
    if (!after.ok || !samePaths(stagedAfter, plan.candidates)) {
      this.runner.run(["reset", "-q", "HEAD", "--", ...plan.candidates]);
      return { output: "[git_commit refused: staged set verification failed]", exitCode: 1 };
    }
    // The index must still match the worktree immediately before commit. This
    // closes the stage-then-swap window for a concurrent writer or hook.
    const drift = this.runner.run(["diff", "--quiet", "--", ...plan.candidates]);
    if (!drift.ok) {
      this.runner.run(["reset", "-q", "HEAD", "--", ...plan.candidates]);
      return { output: "[git_commit refused: worktree changed after staging]", exitCode: 1 };
    }

    const committed = this.runner.run(["commit", "-q", "-m", message]);
    if (!committed.ok) {
      this.runner.run(["reset", "-q", "HEAD", "--", ...plan.candidates]);
      return {
        output: "[git_commit failed: " + (committed.stderr.trim() || committed.stdout.trim()) + "]",
        exitCode: committed.exitCode,
      };
    }
    const revision = this.runner.run(["rev-parse", "--short", "HEAD"]);
    const sha = revision.ok ? revision.stdout.trim() : "";
    return {
      output: "[exit 0]\ncommitted " + plan.candidates.length + " path(s)" + (sha ? "\n" + sha : ""),
      exitCode: 0,
    };
  }
}
