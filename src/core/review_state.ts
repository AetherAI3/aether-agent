// review_state.ts — one structured answer to "what is the state of this
// repository right now?", for the review/ship rail.
//
// Three rules this module exists to keep:
//
//  1. Every git call is an argv array through an injected Runner. A branch
//     name, path or remote URL is attacker-influenced the moment a model or a
//     colleague pushes one, and none of them ever reaches a shell string.
//  2. Unknown is reported as unknown. A base that could not be fetched, an
//     ahead/behind that could not be computed, and a remote that is not a
//     GitHub repository are all distinct from zero, healthy and absent.
//  3. Reading is reading. `--no-optional-locks` keeps a status probe from
//     rewriting the user's index, and nothing here checks out, resets, merges
//     or cleans.
//
// The state is a value: the commands render it, the actions re-read it before
// mutating, and tests assert against it without a repository.

import { GIT_GLOBAL_ARGS } from "./git_commit_guard.js";
import { parseRepoSpec, type RepoSpec } from "./repo.js";
import type { Runner } from "./worktree.js";

/** `git status` in the machine format that carries branch + rename data. */
export const STATUS_V2_ARGS: readonly string[] = [
  "status",
  "--porcelain=v2",
  "--branch",
  "-z",
  "--untracked-files=all",
];

/** One path git reports as changed, with both halves of its status code. */
export interface ChangedFile {
  path: string;
  /** Index (staged) status letter; "." when the index matches HEAD. */
  index: string;
  /** Worktree (unstaged) status letter; "." when the worktree matches the index. */
  worktree: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  unmerged: boolean;
  /** Set for a rename/copy: where the content came from. */
  renamedFrom?: string;
}

export interface BranchInfo {
  /** Head branch name, or null when detached or unborn. */
  branch: string | null;
  detached: boolean;
  /** The commit HEAD points at, or null on an unborn branch. */
  revision: string | null;
  /** Configured upstream, e.g. "origin/main". Null when there is none. */
  upstream: string | null;
  /** Commits on HEAD that the upstream lacks. Null = git did not report it. */
  ahead: number | null;
  /** Commits on the upstream that HEAD lacks. Null = git did not report it. */
  behind: number | null;
}

export interface StatusV2 {
  branch: BranchInfo;
  files: ChangedFile[];
}

const EMPTY_BRANCH: BranchInfo = {
  branch: null,
  detached: false,
  revision: null,
  upstream: null,
  ahead: null,
  behind: null,
};

/**
 * Parse `git status --porcelain=v2 --branch -z`.
 *
 * The -z form is NUL-delimited, and a rename entry spans TWO fields: the entry
 * itself, then the original path. Splitting on NUL and reading every field as a
 * separate entry silently turns the original path of every rename into a bogus
 * changed file, so type "2" consumes the following field deliberately.
 */
export function parseStatusV2(raw: string): StatusV2 {
  const fields = raw.split("\0");
  const branch: BranchInfo = { ...EMPTY_BRANCH };
  const files: ChangedFile[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    if (!entry) continue;
    const kind = entry[0];

    if (kind === "#") {
      applyBranchHeader(branch, entry);
      continue;
    }
    if (kind === "?") {
      files.push(untrackedFile(entry.slice(2)));
      continue;
    }
    if (kind === "!") continue; // ignored paths are not changes

    if (kind === "1" || kind === "2" || kind === "u") {
      // Fixed field count before the path, per git's status format:
      // "1" has 8 fields, "2" has 9 (it carries the rename score), "u" has 10.
      const before = kind === "1" ? 8 : kind === "2" ? 9 : 10;
      const parts = splitFields(entry, before);
      if (!parts) continue;
      const [head, path] = parts;
      const code = head[1] ?? "..";
      const file: ChangedFile = {
        path,
        index: code[0] ?? ".",
        worktree: code[1] ?? ".",
        staged: kind !== "u" && (code[0] ?? ".") !== ".",
        unstaged: kind === "u" || (code[1] ?? ".") !== ".",
        untracked: false,
        unmerged: kind === "u",
      };
      if (kind === "2") {
        const origin = fields[index + 1];
        index += 1;
        if (origin) file.renamedFrom = origin;
      }
      files.push(file);
    }
  }

  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { branch, files };
}

function untrackedFile(path: string): ChangedFile {
  return { path, index: ".", worktree: "?", staged: false, unstaged: true, untracked: true, unmerged: false };
}

/** Split an entry into its first `count` space-separated fields plus the path. */
function splitFields(entry: string, count: number): [string[], string] | null {
  const head: string[] = [];
  let cursor = 0;
  for (let field = 0; field < count; field += 1) {
    const next = entry.indexOf(" ", cursor);
    if (next < 0) return null;
    head.push(entry.slice(cursor, next));
    cursor = next + 1;
  }
  const path = entry.slice(cursor);
  return path ? [head, path] : null;
}

function applyBranchHeader(branch: BranchInfo, entry: string): void {
  const [, key, ...rest] = entry.split(" ");
  const value = rest.join(" ");
  if (key === "branch.oid") branch.revision = value === "(initial)" ? null : value;
  else if (key === "branch.head") {
    if (value === "(detached)") branch.detached = true;
    else branch.branch = value;
  } else if (key === "branch.upstream") branch.upstream = value;
  else if (key === "branch.ab") {
    const match = value.match(/^\+(\d+)\s+-(\d+)$/);
    if (match) {
      branch.ahead = Number(match[1]);
      branch.behind = Number(match[2]);
    }
  }
}

// ── remote identity ─────────────────────────────────────────────────────────

export interface RemoteIdentity {
  name: string;
  /** The fetch URL, exactly as git reports it. */
  url: string;
  /**
   * The URL git would actually PUSH to. Usually identical to `url`; a
   * configured `remote.<name>.pushurl` makes them differ, and a rail that
   * showed only the fetch URL would then confirm one destination and publish to
   * another. It is read and rendered separately for exactly that reason.
   */
  pushUrl: string;
  /** GitHub owner/name when the push URL is a GitHub repository, else null. */
  spec: RepoSpec | null;
}

/** The reason a repository state could not be read at all. */
export interface RepoStateError {
  ok: false;
  reason: string;
}

export interface BaseRef {
  /** Base branch name (short form, e.g. "main"), or null when unresolved. */
  branch: string | null;
  /** The commit the base resolved to, or null when it could not be resolved. */
  revision: string | null;
  /** True only when this call fetched the base from the remote just now. */
  fetched: boolean;
  /** Why the base is not a freshly fetched revision. Present whenever it is not. */
  reason?: string;
}

export interface RepoState {
  ok: true;
  root: string;
  remote: RemoteIdentity | null;
  head: BranchInfo;
  base: BaseRef;
  /** Commits ahead of / behind the BASE. Null is unknown, never zero. */
  aheadOfBase: number | null;
  behindBase: number | null;
  files: ChangedFile[];
}

export interface ReadStateOptions {
  /** Remote to read identity from. Default: the upstream's remote, else "origin". */
  remote?: string;
  /** Base branch override. Default: the upstream branch, else the remote HEAD. */
  base?: string;
  /** Fetch the base before resolving it. Off by default: reading is reading. */
  fetchBase?: boolean;
}

const git = (run: Runner, cwd: string, args: string[]) => run("git", [...GIT_GLOBAL_ARGS, "-C", cwd, ...args], cwd);

/**
 * Read the whole repository state in one pass.
 *
 * Never throws: a directory that is not a repository, a missing remote and an
 * unresolvable base are all reported as data. The caller decides what is fatal.
 */
export function readRepoState(run: Runner, cwd: string, options: ReadStateOptions = {}): RepoState | RepoStateError {
  const root = git(run, cwd, ["rev-parse", "--show-toplevel"]);
  if (root.status !== 0 || !root.stdout.trim()) {
    return { ok: false, reason: "not a git repository" };
  }
  const dir = root.stdout.trim();

  const status = git(run, dir, [...STATUS_V2_ARGS]);
  if (status.status !== 0) {
    return { ok: false, reason: status.stderr.trim() || "could not read the repository status" };
  }
  const { branch, files } = parseStatusV2(status.stdout);

  const remoteName = options.remote ?? branch.upstream?.split("/")[0] ?? "origin";
  const remote = readRemote(run, dir, remoteName);
  const base = resolveBase(run, dir, branch, remoteName, options);
  const { ahead, behind } = countAgainstBase(run, dir, branch.revision, base.revision);

  return { ok: true, root: dir, remote, head: branch, base, aheadOfBase: ahead, behindBase: behind, files };
}

export function readRemote(run: Runner, dir: string, name: string): RemoteIdentity | null {
  const fetchUrl = git(run, dir, ["remote", "get-url", name]);
  if (fetchUrl.status !== 0 || !fetchUrl.stdout.trim()) return null;
  const url = fetchUrl.stdout.trim();
  const push = git(run, dir, ["remote", "get-url", "--push", name]);
  const pushUrl = push.status === 0 && push.stdout.trim() ? push.stdout.trim() : url;
  return { name, url, pushUrl, spec: githubSpec(pushUrl) };
}

/** owner/name when the URL is a GitHub repository; null for anything else. */
export function githubSpec(url: string): RepoSpec | null {
  if (!/github\.com[/:]/i.test(url)) return null;
  try {
    return parseRepoSpec(url.replace(/^ssh:\/\//i, "").replace(/^[^@]*@?github\.com[/:]/i, ""));
  } catch {
    return null;
  }
}

function resolveBase(
  run: Runner,
  dir: string,
  branch: BranchInfo,
  remoteName: string,
  options: ReadStateOptions,
): BaseRef {
  const explicit = options.base?.trim();
  const upstreamBase = branch.upstream?.split("/").slice(1).join("/") || null;
  const name = explicit || upstreamBase || remoteHeadBranch(run, dir, remoteName);
  if (!name) {
    return { branch: null, revision: null, fetched: false, reason: "no base branch could be determined" };
  }

  if (options.fetchBase) {
    const fetched = git(run, dir, ["fetch", "--quiet", remoteName, name]);
    if (fetched.status === 0) {
      const tip = git(run, dir, ["rev-parse", "FETCH_HEAD"]);
      if (tip.status === 0 && tip.stdout.trim()) {
        return { branch: name, revision: tip.stdout.trim(), fetched: true };
      }
    }
    const local = localBaseRevision(run, dir, remoteName, name);
    return {
      branch: name,
      revision: local,
      fetched: false,
      reason: (fetched.stderr || fetched.stdout).trim() || "could not fetch the base branch",
    };
  }

  const local = localBaseRevision(run, dir, remoteName, name);
  return {
    branch: name,
    revision: local,
    fetched: false,
    reason: local ? "base read from the local remote-tracking ref, not fetched" : "base branch could not be resolved",
  };
}

function localBaseRevision(run: Runner, dir: string, remoteName: string, base: string): string | null {
  for (const ref of [`refs/remotes/${remoteName}/${base}`, `refs/heads/${base}`]) {
    const resolved = git(run, dir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (resolved.status === 0 && resolved.stdout.trim()) return resolved.stdout.trim();
  }
  return null;
}

function remoteHeadBranch(run: Runner, dir: string, remoteName: string): string | null {
  const head = git(run, dir, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remoteName}/HEAD`]);
  if (head.status !== 0) return null;
  const value = head.stdout.trim();
  if (!value) return null;
  return value.startsWith(`${remoteName}/`) ? value.slice(remoteName.length + 1) : value;
}

/**
 * Commits ahead of and behind the base. Both null when either end is unknown —
 * an unresolved base would otherwise make "0 behind" a claim nothing measured.
 */
function countAgainstBase(
  run: Runner,
  dir: string,
  head: string | null,
  base: string | null,
): { ahead: number | null; behind: number | null } {
  if (!head || !base) return { ahead: null, behind: null };
  const counted = git(run, dir, ["rev-list", "--left-right", "--count", `${base}...${head}`]);
  if (counted.status !== 0) return { ahead: null, behind: null };
  const match = counted.stdout.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) return { ahead: null, behind: null };
  return { ahead: Number(match[2]), behind: Number(match[1]) };
}

// ── selection helpers over the state ────────────────────────────────────────

export const stagedFiles = (state: RepoState): ChangedFile[] => state.files.filter((file) => file.staged);
export const unstagedFiles = (state: RepoState): ChangedFile[] =>
  state.files.filter((file) => file.unstaged && !file.untracked);
export const untrackedFiles = (state: RepoState): ChangedFile[] => state.files.filter((file) => file.untracked);
export const unmergedFiles = (state: RepoState): ChangedFile[] => state.files.filter((file) => file.unmerged);
