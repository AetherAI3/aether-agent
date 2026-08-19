// The ship rail: turning a finished worktree into a pull request.
//
// Until now this was a printed string — `prCreateHint` told the user what to
// type. That is safe, but it is not a rail, and it meant nothing in this repo
// ever exercised PR creation, so no test could cover it.
//
// Three rules this module exists to keep:
//
//  1. argv arrays, never a shell string. A branch name, title or body is
//     attacker-influenced the moment a model writes it, and a title like
//     `$(rm -rf ~)` is only dangerous if a shell ever sees it. Nothing here
//     builds a command line.
//  2. the user's own gh session, never an Aether credential. No env is set, so
//     the child inherits the user's configuration exactly as ghAuthStatus does.
//  3. nothing merges, nothing pushes to a base branch. This opens a pull
//     request and returns its URL. Landing it stays a human action.

import type { RepoSpec } from "./repo.js";
import type { Runner } from "./worktree.js";

export interface ShipRequest {
  spec: RepoSpec;
  /** The branch the work is on. Never the base. */
  head: string;
  /** The branch to open against. Omitted means the repository default. */
  base?: string;
  title: string;
  body: string;
  /** Stated in the plan when the run produced a verification result. */
  verification?: string;
}

export type ShipOutcome = { ok: true; url: string } | { ok: false; reason: string; hint?: string };

/** `gh pr create` argv. Pure, so a test can assert the exact vector. */
export function prCreateArgs(request: ShipRequest): string[] {
  const argv = [
    "pr",
    "create",
    "-R",
    request.spec.full,
    "--head",
    request.head,
    "--title",
    request.title,
    "--body",
    request.body,
  ];
  if (request.base) argv.push("--base", request.base);
  return argv;
}

/**
 * Refusals that are about intent rather than syntax. A head branch that parses
 * as an option would be swallowed by gh as a flag; a PR from a branch onto
 * itself is never what was meant; and a PR whose head is the default branch
 * means the work was committed somewhere it should not have been.
 */
export function validateShip(request: ShipRequest): string | null {
  const head = request.head.trim();
  if (!head) return "no head branch to open a pull request from";
  if (head.startsWith("-")) return `refusing a head branch that parses as an option: ${head}`;
  if (request.base && request.base.trim() === head) {
    return `refusing to open a pull request from ${head} onto itself`;
  }
  if (head === "main" || head === "master") {
    return `refusing to open a pull request with ${head} as the head — commit the work to its own branch first`;
  }
  if (!request.title.trim()) return "a pull request needs a title";
  return null;
}

/**
 * Open the pull request. Never merges, never pushes, never force-anything.
 *
 * The runner is injected so the whole path is testable without a gh session,
 * and so a test can assert the exact argv rather than trusting a string.
 */
export function openPullRequest(request: ShipRequest, run: Runner): ShipOutcome {
  const invalid = validateShip(request);
  if (invalid) return { ok: false, reason: invalid };

  if (run("gh", ["--version"]).status !== 0) {
    return {
      ok: false,
      reason: "the gh CLI is not available",
      hint: `install gh, or open it by hand: gh pr create -R ${request.spec.full} --head ${request.head} --fill`,
    };
  }

  if (run("gh", ["auth", "status"]).status !== 0) {
    return { ok: false, reason: "gh is not signed in", hint: "run: gh auth login" };
  }

  const created = run("gh", prCreateArgs(request));
  if (created.status !== 0) {
    return { ok: false, reason: (created.stderr || created.stdout).trim() || "gh pr create failed" };
  }

  // gh prints the pull request URL on success. Take the last URL it emitted
  // rather than the whole buffer, which can carry warnings ahead of the result.
  const url = (created.stdout.match(/https:\/\/\S+/g) ?? []).pop();
  if (!url) return { ok: false, reason: "gh reported success but printed no pull request URL" };
  return { ok: true, url };
}

/**
 * What the user sees BEFORE anything is created. Opening a pull request
 * publishes work under their name, so the exact destination is stated up front
 * rather than summarised after the fact.
 */
export function renderShipPlan(request: ShipRequest): string {
  const lines = [
    `  repository  ${request.spec.full}`,
    `  head        ${request.head}`,
    `  base        ${request.base ?? "(repository default)"}`,
    `  title       ${request.title}`,
  ];
  if (request.verification) lines.push(`  verified    ${request.verification}`);
  lines.push("", "  this opens a pull request. it does not merge, and it does not push to the base.");
  return lines.join("\n") + "\n";
}
