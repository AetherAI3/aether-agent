// ship_record.ts — the lifecycle binding: session ↔ worktree ↔ branch ↔ commit
// ↔ pull request.
//
// Each of those five is recorded somewhere already, and nothing joined them up.
// The consequences were small and constant: a worktree nobody could say was
// finished with, a branch whose pull request you had to go and look for, and a
// "published" claim with no URL behind it.
//
// The record is written only from facts that already happened — a push that
// returned, a pull request that printed a URL. Nothing here predicts. A field
// that is not known is null, and null renders as unknown rather than as a
// reassuring default.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config.js";
import type { RepoState } from "./review_state.js";
import type { VerificationStatus } from "./verification_record.js";

export const SHIP_RECORD_VERSION = 1;

export interface ShipRecord {
  version: number;
  /** The repository this branch lives in. */
  repoRoot: string;
  branch: string;
  /** The commit this record is about. A later commit makes the rest stale. */
  headRevision: string;
  base: string | null;
  remote: { name: string; pushUrl: string } | null;
  /** The agent session that produced the work, when one did. */
  sessionId: string | null;
  /** When the branch was pushed. Null means it never was. */
  publishedAt: string | null;
  /** The pull request URL. Null means there is no pull request, not "pending". */
  prUrl: string | null;
  verification: { status: VerificationStatus; command: string | null; exitCode: number | null } | null;
  updatedAt: string;
}

/**
 * Records live under configDir()/ship/<repo>/<branch>.json, both segments
 * hashed. A branch name contains slashes, dots and — on a hostile remote —
 * anything else git accepts, so using it as a path component is a directory
 * traversal waiting to be found. Hashing removes the question entirely, and the
 * readable name is stored inside the file where it cannot be a path.
 */
const key = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 16);

export const shipRecordDir = (repoRoot: string): string => join(configDir(), "ship", key(repoRoot));

export const shipRecordPath = (repoRoot: string, branch: string): string =>
  join(shipRecordDir(repoRoot), `${key(branch)}.json`);

export function readShipRecord(repoRoot: string, branch: string): ShipRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(shipRecordPath(repoRoot, branch), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as ShipRecord;
    if (record.version !== SHIP_RECORD_VERSION) return null;
    return typeof record.branch === "string" && typeof record.headRevision === "string" ? record : null;
  } catch {
    return null;
  }
}

export function writeShipRecord(record: ShipRecord): void {
  const path = shipRecordPath(record.repoRoot, record.branch);
  mkdirSync(shipRecordDir(record.repoRoot), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", "utf8");
  renameSync(temporary, path);
}

/** Every record for one repository, newest first. Unreadable files are skipped, not fatal. */
export function listShipRecords(repoRoot: string): ShipRecord[] {
  let names: string[];
  try {
    names = readdirSync(shipRecordDir(repoRoot));
  } catch {
    return [];
  }
  const records: ShipRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(shipRecordDir(repoRoot), name), "utf8"));
      const record = parsed as ShipRecord;
      if (record && record.version === SHIP_RECORD_VERSION && typeof record.branch === "string") records.push(record);
    } catch {
      continue;
    }
  }
  return records.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
}

export interface RecordContext {
  sessionId?: string | null;
  now?: string;
}

/**
 * Start (or refresh) the record for the branch the state is on.
 *
 * A record whose headRevision no longer matches is REPLACED rather than
 * updated: its publish and pull-request fields were true of a different
 * commit, and carrying them forward is how a rail ends up reporting an old
 * pull request as if it contained the work in front of you.
 */
export function bindShipRecord(state: RepoState, context: RecordContext = {}): ShipRecord | null {
  const branch = state.head.branch;
  const head = state.head.revision;
  if (!branch || !head) return null;

  const now = context.now ?? new Date().toISOString();
  const existing = readShipRecord(state.root, branch);
  const carry = existing && existing.headRevision === head;
  return {
    version: SHIP_RECORD_VERSION,
    repoRoot: state.root,
    branch,
    headRevision: head,
    base: state.base.branch,
    remote: state.remote ? { name: state.remote.name, pushUrl: state.remote.pushUrl } : null,
    sessionId: context.sessionId ?? existing?.sessionId ?? null,
    publishedAt: carry ? existing.publishedAt : null,
    prUrl: carry ? existing.prUrl : null,
    verification: carry ? existing.verification : null,
    updatedAt: now,
  };
}

/** Record a push that actually returned. */
export function recordPublished(record: ShipRecord, now = new Date().toISOString()): ShipRecord {
  return { ...record, publishedAt: now, updatedAt: now };
}

/**
 * Record a pull request. A blank URL is refused: "opened a pull request" with
 * nothing to point at is the failure this rail is supposed to make impossible.
 */
export function recordPullRequest(record: ShipRecord, url: string, now = new Date().toISOString()): ShipRecord | null {
  const trimmed = url.trim();
  if (!/^https?:\/\/\S+$/.test(trimmed)) return null;
  return { ...record, prUrl: trimmed, updatedAt: now };
}

export function recordVerification(
  record: ShipRecord,
  verification: { status: VerificationStatus; command: string | null; exitCode: number | null },
  now = new Date().toISOString(),
): ShipRecord {
  return { ...record, verification, updatedAt: now };
}

export type CleanupVerdict = { ok: true } | { ok: false; reason: string };

/**
 * May this worktree be cleaned up?
 *
 * Only when everything in it is recoverable from somewhere else: no uncommitted
 * changes, the commit that is checked out is the commit that was published, and
 * a pull request exists to carry it. Anything less and removing the worktree
 * destroys the only copy of something.
 */
export function canCleanWorktree(state: RepoState, record: ShipRecord | null): CleanupVerdict {
  if (state.files.length) {
    return { ok: false, reason: `${state.files.length} uncommitted change(s) — they exist nowhere else` };
  }
  if (!record) return { ok: false, reason: "nothing recorded this branch as published" };
  if (!record.publishedAt) return { ok: false, reason: `${record.branch} was never pushed` };
  if (record.headRevision !== state.head.revision) {
    return { ok: false, reason: "there are commits here newer than the ones that were published" };
  }
  if (!record.prUrl) return { ok: false, reason: "no pull request carries this branch yet" };
  return { ok: true };
}

/** One-line lifecycle summary. Unknown is printed as unknown. */
export function renderShipRecord(record: ShipRecord): string {
  const lines = [
    `  branch      ${record.branch}`,
    `  commit      ${record.headRevision.slice(0, 12)}`,
    `  base        ${record.base ?? "(unknown)"}`,
    `  remote      ${record.remote ? `${record.remote.name} → ${record.remote.pushUrl}` : "(none)"}`,
    `  session     ${record.sessionId ?? "(none recorded)"}`,
    `  published   ${record.publishedAt ?? "no"}`,
    `  pull req    ${record.prUrl ?? "none"}`,
  ];
  if (record.verification) {
    const exit = record.verification.exitCode;
    lines.push(
      `  verified    ${record.verification.status}` +
        (record.verification.command ? ` (${record.verification.command}${exit === null ? "" : ` → ${exit}`})` : ""),
    );
  } else {
    lines.push("  verified    unknown");
  }
  return lines.join("\n") + "\n";
}
