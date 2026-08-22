// verification_record.ts — "verified" is a claim about a specific tree.
//
// The verify gate (verify_gate.ts) establishes ground truth by re-running the
// host's own test command and reading its real exit code. That result is true
// of the tree it ran against and of nothing else: one more edit, one more
// commit, and the claim is about a tree that no longer exists.
//
// So a verification is stored WITH the identity of what it verified — the head
// commit and a digest of the working tree — and read back through a classifier
// that can return "stale". The review/ship rail may label a change verified
// only when the recorded identity still matches the tree in front of it. There
// is deliberately no code path that upgrades an unknown or stale reading to
// verified, because the whole point of the record is to make that impossible.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config.js";
import { GIT_GLOBAL_ARGS } from "./git_commit_guard.js";
import type { Runner } from "./worktree.js";

/** Schema version. A record written by a newer agent is refused, not guessed at. */
export const VERIFICATION_RECORD_VERSION = 1;

export interface VerificationRecord {
  version: number;
  /** The exact command that was run. Never a summary of it. */
  command: string;
  /** Its real exit code. 0 is the only value that can mean verified. */
  exitCode: number;
  ranAt: string;
  /** HEAD at the time of the run, or null on an unborn branch. */
  head: string | null;
  /** Digest of the working tree at the time of the run. */
  treeDigest: string;
  /** Failing count when the runner could parse one. Null is unknown, not zero. */
  remaining: number | null;
}

export type VerificationStatus = "verified" | "failed" | "stale" | "unknown";

export interface VerificationReading {
  status: VerificationStatus;
  /** Why the status is what it is — rendered to the user verbatim. */
  reason: string;
  record: VerificationRecord | null;
}

const git = (run: Runner, dir: string, args: string[]) => run("git", [...GIT_GLOBAL_ARGS, "-C", dir, ...args], dir);

/**
 * Above this many untracked paths the digest stops enumerating them.
 *
 * The cap exists so a repository with a huge untracked build directory cannot
 * turn every digest into an unbounded hash job. When it trips, the digest says
 * so in its own text, which changes the digest — so a capped tree can never
 * collide with an uncapped one and be read as unchanged.
 */
export const UNTRACKED_DIGEST_CAP = 200;

export interface TreeIdentity {
  head: string | null;
  digest: string;
}

/**
 * Identify the working tree: HEAD, every tracked difference from it, and the
 * content of every untracked file.
 *
 * Untracked content is hashed rather than merely listed. A test run that was
 * green because of an untracked fixture, followed by an edit to that fixture,
 * is exactly the case where a path-list digest would keep reporting "verified"
 * about a tree that changed.
 */
export function treeIdentity(run: Runner, dir: string): TreeIdentity {
  const hash = createHash("sha256");

  const head = git(run, dir, ["rev-parse", "HEAD"]);
  const headRev = head.status === 0 && head.stdout.trim() ? head.stdout.trim() : null;
  hash.update("head\0" + (headRev ?? "(unborn)") + "\0");

  // `diff HEAD` covers staged and unstaged changes to tracked files in one
  // pass; two separate diffs would miss a change that is staged and then
  // further edited only if they were compared separately.
  const tracked = git(run, dir, ["diff", "HEAD"]);
  hash.update("tracked\0" + (tracked.status === 0 ? tracked.stdout : "(diff failed)") + "\0");

  const listed = git(run, dir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const untracked = listed.status === 0 ? listed.stdout.split("\0").filter(Boolean).sort() : null;
  if (untracked === null) {
    hash.update("untracked\0(unreadable)\0");
  } else if (untracked.length > UNTRACKED_DIGEST_CAP) {
    hash.update(`untracked\0(capped at ${UNTRACKED_DIGEST_CAP}: ${untracked.length} paths)\0`);
    for (const path of untracked) hash.update(path + "\0");
  } else if (untracked.length) {
    const hashed = git(run, dir, ["hash-object", "--", ...untracked]);
    hash.update("untracked\0");
    for (const [index, path] of untracked.entries()) {
      const object = hashed.status === 0 ? (hashed.stdout.trim().split("\n")[index] ?? "(unhashed)") : "(unhashed)";
      hash.update(path + "\0" + object.trim() + "\0");
    }
  } else {
    hash.update("untracked\0(none)\0");
  }

  return { head: headRev, digest: hash.digest("hex") };
}

/**
 * Read a stored verification against the tree in front of us.
 *
 * The order of the checks is the point: identity is compared BEFORE the exit
 * code is consulted, so a stale record can never be reported as verified no
 * matter how green the run it describes was.
 */
export function classifyVerification(record: VerificationRecord | null, identity: TreeIdentity): VerificationReading {
  if (!record) {
    return { status: "unknown", reason: "nothing has verified this working tree", record: null };
  }
  if (record.version !== VERIFICATION_RECORD_VERSION) {
    return {
      status: "unknown",
      reason: `verification record is version ${record.version}, this agent understands ${VERIFICATION_RECORD_VERSION}`,
      record: null,
    };
  }
  if (record.head !== identity.head) {
    return {
      status: "stale",
      reason: `verified at ${short(record.head)}, HEAD is now ${short(identity.head)}`,
      record,
    };
  }
  if (record.treeDigest !== identity.digest) {
    return { status: "stale", reason: "the working tree changed since it was verified", record };
  }
  if (record.exitCode === 0) {
    return { status: "verified", reason: `${record.command} exited 0 at ${record.ranAt}`, record };
  }
  const failing = record.remaining === null ? "" : ` (${record.remaining} failing)`;
  return { status: "failed", reason: `${record.command} exited ${record.exitCode}${failing}`, record };
}

const short = (revision: string | null): string => (revision ? revision.slice(0, 8) : "(unborn)");

/** Per-repository record path. The root is hashed so no repository path leaks into a filename. */
export function verificationPath(root: string): string {
  const key = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(configDir(), "review", `${key}.json`);
}

export function readVerification(root: string): VerificationRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(verificationPath(root), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as VerificationRecord;
    return typeof record.treeDigest === "string" && typeof record.exitCode === "number" ? record : null;
  } catch {
    return null;
  }
}

/**
 * Write the record atomically.
 *
 * A torn record read back as JSON garbage classifies as "unknown", which is
 * safe; a torn record that happened to parse with an old digest and a new exit
 * code would not be. The rename makes neither possible.
 */
export function writeVerification(root: string, record: VerificationRecord): void {
  const path = verificationPath(root);
  mkdirSync(join(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", "utf8");
  renameSync(temporary, path);
}
