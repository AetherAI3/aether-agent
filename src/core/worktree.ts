// worktree.ts — gh-gated isolated git worktrees + the gh<->Aether account link.
//
// The 2.0 contract: before a coding run touches your tree, the host asks "are you
// working in this repo?" (commands/code.ts owns that gate). If `gh` is
// authenticated, we go one safer and run inside a REAL isolated git worktree on a
// fresh `aether/<slug>` branch, so the agent's edits never land on your working
// branch until you merge. If gh is NOT authed, the gate degrades to confirm-only
// and the run happens in-place (with a nudge to `gh auth login`).
//
// Account linking: when the user is gh-authenticated we record the gh login
// locally (configDir()/gh-link.json) so the terminal session knows which GitHub
// account is in play. The server-side bind (linking that GitHub account to the
// Aether account on aethersystems.net) is the website's job and is deliberately
// NOT fabricated here — we expose the local record + a best-effort, no-op-unless-
// configured sync hook, never an invented endpoint.
//
// Every external process call goes through an injected Runner, so the whole module
// is unit-testable with a fake and the cmdCode gate can avoid ALL side effects in
// non-interactive (pipe / CI / test) runs.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { configDir } from "./config.js";

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run an external command (argv form, no shell — safe with spaces in paths). */
export type Runner = (cmd: string, args: string[], cwd?: string) => RunResult;

/** Default runner over spawnSync. ENOENT (binary missing) reads as status 127. */
export function defaultRunner(): Runner {
  return (cmd, args, cwd) => {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
    if (r.error) return { status: 127, stdout: "", stderr: String(r.error) };
    return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
}

// ── gh authentication ───────────────────────────────────────────────────────
export interface GhStatus {
  /** Is `gh` installed AND logged in? */
  authed: boolean;
  /** The GitHub login, when it can be parsed from `gh auth status`. */
  user?: string;
  /** The host (github.com or an enterprise host), when parseable. */
  host?: string;
}

/**
 * Probe `gh auth status`. Exit 0 = authenticated. We parse the login + host from
 * the human-readable output (stderr on most gh versions), tolerating both the
 * modern "account <user>" and older "as <user>" phrasings. Never throws.
 */
export function ghAuthStatus(run: Runner): GhStatus {
  const r = run("gh", ["auth", "status"]);
  if (r.status !== 0) return { authed: false };
  const text = `${r.stdout}\n${r.stderr}`;
  const user = /\baccount\s+(\S+)/i.exec(text)?.[1] ?? /\bas\s+(\S+)/i.exec(text)?.[1];
  const host = /Logged in to (\S+)/i.exec(text)?.[1];
  const status: GhStatus = { authed: true };
  if (user) status.user = user;
  if (host) status.host = host;
  return status;
}

// ── git repo probing ─────────────────────────────────────────────────────────
/** Is `cwd` inside a git work tree? */
export function isGitRepo(run: Runner, cwd: string): boolean {
  const r = run("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], cwd);
  return r.status === 0 && r.stdout.trim() === "true";
}

/** The repo's top-level directory, or null if `cwd` is not in a git repo. */
export function repoRoot(run: Runner, cwd: string): string | null {
  const r = run("git", ["-C", cwd, "rev-parse", "--show-toplevel"], cwd);
  if (r.status !== 0) return null;
  const top = r.stdout.trim();
  return top.length ? top : null;
}

// ── slug + worktree creation ──────────────────────────────────────────────────
/** Turn a free-text task into a short, branch-safe slug. Deterministic + pure. */
export function slugify(task: string, max = 32): string {
  const s = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "task";
}

/** Where isolated worktrees live — OUTSIDE the repo, so they never dirty it. */
export function worktreeBase(): string {
  return join(configDir(), "worktrees");
}

export interface WorktreeResult {
  ok: boolean;
  /** Absolute path of the new worktree (when ok). */
  path?: string;
  /** The branch checked out in it, e.g. "aether/fix-tests" (when ok). */
  branch?: string;
  /** Failure detail (when !ok). */
  error?: string;
}

/**
 * Create a real isolated worktree for `root` on a fresh `aether/<slug>` branch.
 * The worktree lives under worktreeBase() (outside the repo). On a branch/path
 * collision it retries with a numeric suffix a few times. Never throws.
 */
export function createWorktree(
  run: Runner,
  root: string,
  slug: string,
  base: string = worktreeBase(),
): WorktreeResult {
  try {
    mkdirSync(base, { recursive: true });
  } catch (err) {
    return { ok: false, error: `cannot create worktree base: ${String(err)}` };
  }
  const repoName = basename(root) || "repo";
  let lastErr = "";
  for (let n = 0; n < 5; n++) {
    const suffix = n === 0 ? slug : `${slug}-${n + 1}`;
    const branch = `aether/${suffix}`;
    const path = join(base, `${repoName}-${suffix}`);
    if (existsSync(path)) {
      lastErr = `path exists: ${path}`;
      continue;
    }
    const r = run("git", ["-C", root, "worktree", "add", path, "-b", branch]);
    if (r.status === 0) return { ok: true, path, branch };
    lastErr = (r.stderr || r.stdout || `git exited ${r.status}`).trim();
  }
  return { ok: false, error: lastErr || "could not create worktree" };
}

// ── gh <-> Aether account link (local record) ─────────────────────────────────
export interface GhLink {
  gh_user: string;
  host: string;
  linked_at: string;
}

/** Path of the local link record. */
export function ghLinkPath(): string {
  return join(configDir(), "gh-link.json");
}

/**
 * Record (locally) which GitHub account is linked to this Aether terminal session.
 * Best-effort: a write failure is swallowed (linking is a convenience, never a
 * gate). The server-side bind to the Aether account is performed by the website
 * during `gh auth` consent and is intentionally not invented here.
 */
export function linkGhAccount(user: string, host = "github.com", now: () => string = () => new Date().toISOString()): GhLink | null {
  const link: GhLink = { gh_user: user, host, linked_at: now() };
  try {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(ghLinkPath(), JSON.stringify(link, null, 2) + "\n", "utf8");
    return link;
  } catch {
    return null;
  }
}

/** Read the local gh<->Aether link record, or null if none / unreadable. */
export function readGhLink(): GhLink | null {
  try {
    const raw = readFileSync(ghLinkPath(), "utf8");
    const obj = JSON.parse(raw) as Partial<GhLink>;
    if (obj && typeof obj.gh_user === "string") {
      return { gh_user: obj.gh_user, host: obj.host ?? "github.com", linked_at: obj.linked_at ?? "" };
    }
  } catch {
    /* no record / unreadable — not linked */
  }
  return null;
}
