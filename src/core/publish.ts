// publish.ts — the one place work leaves the machine.
//
// Everything before this is local and undoable. A push is neither, so this
// module is written as a list of refusals rather than a list of capabilities:
//
//  - Only HEAD is pushed, and only to a branch of the same name. The refspec is
//    fully qualified on both sides, so there is no ref that git could resolve to
//    something other than the branch the user was shown.
//  - The base branch is never a push target. A head named main/master is
//    refused outright: work committed there was committed in the wrong place,
//    and publishing it is not the fix.
//  - Nothing forces. There is no --force, no --force-with-lease, no
//    --delete and no tag push anywhere in this file, and a test asserts the
//    argv never contains one.
//  - The destination is re-read immediately before the push and compared to the
//    URL the user was shown. A remote that changed under the confirmation is a
//    different destination, and consent was for the old one.
//
// The pull-request half derives its target from the same state, so the repo the
// PR opens against is the repo the push actually went to — not a slug parsed
// from a different URL.

import { GIT_GLOBAL_ARGS } from "./git_commit_guard.js";
import type { RepoState } from "./review_state.js";
import { readRemote } from "./review_state.js";
import type { ShipRequest } from "./ship.js";
import type { Runner } from "./worktree.js";

const git = (run: Runner, dir: string, args: string[]) => run("git", [...GIT_GLOBAL_ARGS, "-C", dir, ...args], dir);

/** Branch names that are a base somewhere, and are never a head to publish. */
export const PROTECTED_HEADS: readonly string[] = ["main", "master", "HEAD", "trunk", "develop"];

export type PublishOutcome =
  | { ok: true; branch: string; remote: string; url: string; upstreamSet: boolean }
  | { ok: false; reason: string; hint?: string };

const no = (reason: string, hint?: string): PublishOutcome =>
  hint === undefined ? { ok: false, reason } : { ok: false, reason, hint };

/**
 * The refspec: `refs/heads/<branch>:refs/heads/<branch>`.
 *
 * The short form (`git push origin my-branch`) resolves the source through
 * git's ref lookup, so a tag or a remote ref sharing the name can be what
 * actually travels. Fully qualifying both sides removes the lookup entirely.
 */
export const publishRefspec = (branch: string): string => `refs/heads/${branch}:refs/heads/${branch}`;

/** `git push` argv. Pure, so a test can assert the exact vector. */
export function pushArgs(remote: string, branch: string, setUpstream: boolean): string[] {
  return ["push", ...(setUpstream ? ["--set-upstream"] : []), "--", remote, publishRefspec(branch)];
}

/**
 * Refusals that are about intent rather than syntax.
 *
 * Ordered so the most specific message wins: a detached HEAD and a head named
 * `main` are different mistakes needing different advice, and collapsing them
 * into "cannot publish" would hide which one happened.
 */
export function validatePublish(state: RepoState): string | null {
  if (state.head.detached) return "HEAD is detached — check out a branch before publishing";
  const branch = state.head.branch?.trim();
  if (!branch) return "there is no branch to publish";
  if (branch.startsWith("-")) return `refusing a branch name that parses as an option: ${branch}`;
  if (PROTECTED_HEADS.includes(branch)) {
    return `refusing to publish ${branch} — commit the work to its own branch first`;
  }
  if (!state.head.revision) return "this branch has no commits yet";
  if (!state.remote) return "this repository has no remote to publish to";
  if (state.base.branch === branch) {
    return `${branch} is also the base branch here — publishing it would push to the base`;
  }
  return null;
}

/**
 * Push HEAD to its own branch on the remote.
 *
 * The remote is re-read first. `readRemote` is the same function that produced
 * the identity rendered in the plan, so a mismatch here means the repository's
 * configuration changed between the confirmation and the push — which is
 * exactly when publishing to it anyway would be wrong.
 */
export function publishHead(run: Runner, state: RepoState, options: { setUpstream?: boolean } = {}): PublishOutcome {
  const invalid = validatePublish(state);
  if (invalid) return no(invalid);

  const branch = state.head.branch!;
  const expected = state.remote!;
  const current = readRemote(run, state.root, expected.name);
  if (!current) return no(`the remote ${expected.name} is gone`);
  if (current.pushUrl !== expected.pushUrl) {
    return no(
      `the push destination for ${expected.name} changed since it was shown to you ` +
        `(${expected.pushUrl} → ${current.pushUrl}) — nothing was pushed`,
    );
  }

  const setUpstream = options.setUpstream ?? state.head.upstream === null;
  const pushed = git(run, state.root, pushArgs(expected.name, branch, setUpstream));
  if (pushed.status !== 0) {
    const output = (pushed.stderr || pushed.stdout).trim();
    const rejected = /non-fast-forward|fetch first|behind its remote/i.test(output);
    return no(
      output || "git push failed",
      rejected
        ? "the remote branch has commits this one does not. This rail never force-pushes — " +
          "pull or rebase onto it yourself, then publish again."
        : undefined,
    );
  }
  return { ok: true, branch, remote: expected.name, url: current.pushUrl, upstreamSet: setUpstream };
}

/** What the user sees BEFORE the push. The destination is stated, not summarised. */
export function renderPublishPlan(state: RepoState): string {
  const lines = [
    `  remote      ${state.remote?.name ?? "(none)"}`,
    `  destination ${state.remote?.pushUrl ?? "(none)"}`,
    `  branch      ${state.head.branch ?? "(detached)"} → ${publishRefspec(state.head.branch ?? "?")}`,
    `  commit      ${state.head.revision?.slice(0, 12) ?? "(none)"}`,
  ];
  if (state.remote && state.remote.pushUrl !== state.remote.url) {
    lines.push(`  ! this remote fetches from ${state.remote.url} and pushes somewhere else`);
  }
  lines.push("", "  this pushes your branch. it does not push the base, and it never forces.");
  return lines.join("\n") + "\n";
}

// ── the pull-request half ───────────────────────────────────────────────────

export interface ShipPlanOptions {
  title: string;
  body: string;
  /** Base override. Default: the base the state resolved. */
  base?: string;
  /** How the change was verified, when it was. Never fabricated. */
  verification?: string;
}

/**
 * Derive the pull-request request from the same state the push used.
 *
 * The repository comes from the remote's PUSH url, so the pull request opens
 * against the repository the commits actually went to. Deriving it from the
 * fetch URL would be the one way to open a PR in a repository that does not
 * contain the branch.
 */
export function planShip(state: RepoState, options: ShipPlanOptions): ShipRequest | { ok: false; reason: string } {
  const invalid = validatePublish(state);
  if (invalid) return { ok: false, reason: invalid };
  const spec = state.remote?.spec;
  if (!spec) {
    return {
      ok: false,
      reason: `${state.remote?.pushUrl ?? "this remote"} is not a GitHub repository — there is no pull request to open`,
    };
  }
  const base = options.base?.trim() || state.base.branch || undefined;
  const head = state.head.branch!;
  if (base === head) return { ok: false, reason: `refusing to open a pull request from ${head} onto itself` };
  if (!options.title.trim()) return { ok: false, reason: "a pull request needs a title" };

  const request: ShipRequest = { spec, head, title: options.title, body: options.body };
  if (base) request.base = base;
  if (options.verification) request.verification = options.verification;
  return request;
}
