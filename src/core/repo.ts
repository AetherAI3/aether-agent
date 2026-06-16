// Repo target — `aether agent --repo owner/name "<task>"`. Brings one of the
// user's GitHub repos local so an agent run (cloud-brain UVT-metered, or local)
// can work on it in an isolated worktree, Claude-Code style.
//
// Auth is the USER'S OWN GitHub auth, never a token from our backend: we shell
// `gh repo clone` (honours `gh auth login` / a gh PAT / GH_TOKEN), falling back
// to `git clone` (git credential manager) when the gh CLI isn't installed. No
// GitHub token ever leaves the Aether backend for this path. The Aether API
// only meters the cloud brain's reasoning (UVT); the repo bytes stay between
// the user's machine and GitHub.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RepoSpec {
  owner: string;
  name: string;
  /** "owner/name" */
  full: string;
}

/** Parse "owner/name" or a github URL into a RepoSpec. Pure. Throws on junk. */
export function parseRepoSpec(spec: string): RepoSpec {
  const cleaned = spec
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
  const m = cleaned.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!m) throw new Error(`invalid repo "${spec}" — expected owner/name`);
  // The charset above still admits a leading "-" (parsed as a flag when handed to
  // gh/git as an argv element) and the path segments "."/"..". Reject both so a
  // crafted spec can't inject an option or a surprising path into the clone argv.
  const unsafe = (seg: string): boolean => seg.startsWith("-") || seg === "." || seg === "..";
  if (unsafe(m[1]!) || unsafe(m[2]!)) {
    throw new Error(`invalid repo "${spec}" — owner/name may not start with '-' or be '.'/'..'`);
  }
  return { owner: m[1]!, name: m[2]!, full: `${m[1]}/${m[2]}` };
}

/** Is the gh CLI on PATH? */
export function ghAvailable(): boolean {
  const r = spawnSync("gh", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

/** Local mirror dir for a repo: ~/.aether-agent/repos/<owner>-<name>. */
export function localMirrorDir(spec: RepoSpec): string {
  return join(homedir(), ".aether-agent", "repos", `${spec.owner}-${spec.name}`);
}

/** gh/git clone argv for a repo into `dir`. Pure (testable). */
export function cloneArgs(spec: RepoSpec, dir: string, useGh: boolean): { cmd: string; args: string[] } {
  return useGh
    ? { cmd: "gh", args: ["repo", "clone", spec.full, dir] }
    : { cmd: "git", args: ["clone", `https://github.com/${spec.full}.git`, dir] };
}

export interface RepoCheckout {
  /** Local git dir for the repo (the mirror). */
  dir: string;
  /** True when this call performed the clone (vs reusing an existing mirror). */
  cloned: boolean;
}

/**
 * Ensure the repo is cloned locally (using the user's gh/git auth) and return
 * its dir. Reuses an existing mirror. Throws with an actionable message on a
 * clone failure (private repo + no auth is the common case).
 */
export function ensureLocalClone(spec: RepoSpec): RepoCheckout {
  const dir = localMirrorDir(spec);
  if (existsSync(join(dir, ".git"))) return { dir, cloned: false };
  const useGh = ghAvailable();
  const { cmd, args } = cloneArgs(spec, dir, useGh);
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) {
    const why = ((r.stderr ?? "") + (r.stdout ?? "")).trim() || `${cmd} clone failed`;
    const hint = useGh
      ? "check `gh auth status` (run `gh auth login`)"
      : "gh CLI not found — install it or set up git credentials for github.com";
    throw new Error(`could not clone ${spec.full}: ${why}\n  ${hint}`);
  }
  return { dir, cloned: true };
}

/** One-line "open a PR" footer for a finished repo run. Pure. */
export function prCreateHint(spec: RepoSpec, branch: string): string {
  return `  open a PR:  gh pr create -R ${spec.full} --head ${branch} --fill\n`;
}
