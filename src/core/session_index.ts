// src/core/session_index.ts — the session library's index.
//
// Listing sessions used to work the only way available: read every directory
// under the logs root, parse every manifest, sort. That is O(sessions) file
// reads for a question asked on every launch, and it is the reason there was no
// session list worth showing — the listing cost grew with the user's history.
//
// This module adds ONE small durable document beside the session directories:
//
//   <logsRoot>/index.json   {schemaVersion, entries: [SessionIndexEntry, ...]}
//
// The index is a CACHE with an authority rule: the per-session manifest.json is
// the truth, the index is a fast copy of it. Anything the index cannot answer
// is answered by rebuilding from manifests — never by rendering an empty list.
// That rule is what makes it safe to delete, corrupt, or lose the index.
//
// Concurrency is the whole difficulty. Two `aether agent` runs closing in the
// same second must both appear; a crash mid-write must not destroy the previous
// generation; a half-written file must be recognised as broken rather than read
// as "no sessions". durable_store.ts already implements exactly that
// transaction (lock -> read -> mutate -> temp write -> flush -> backup ->
// rename), so this module supplies the schema and the rebuild, not a second
// copy of the mechanism.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  atomicWriteFile,
  preserveCorrupt,
  readJsonFile,
  withFileLock,
  type JsonReadFailure,
} from "./durable_store.js";
import { logsRoot } from "./logs_root.js";
import { normalizeWorkspace, requireOpaqueId, workspaceFingerprint } from "./workspace_scope.js";
import { sanitizeTerm } from "../ui/text.js";
import { clipCodePoints } from "../ui/theme.js";

/** Bumped only when a reader written today could MISREAD tomorrow's file.
 *  Additive optional fields do not bump it — old readers ignore what they do
 *  not know, which is why every field below that a listing can live without is
 *  optional. */
export const SESSION_INDEX_SCHEMA_VERSION = 1;

export const SESSION_INDEX_FILE = "index.json";
const SESSION_INDEX_BACKUP = "index.json.bak";
const SESSION_INDEX_LOCK = "index.lock";

/** Bound on untrusted strings. A task is written by whoever ran the agent; a
 *  branch name comes off a checkout. Both are printed. */
const MAX_TEXT = 400;

/** One row of the library. Every field is derivable from a manifest, so a lost
 *  index costs time, never information. */
export interface SessionIndexEntry {
  sessionId: string;
  /** Normalized absolute workspace path the session ran in. */
  workspace: string;
  /** Stable short hash of `workspace` — how a row is matched to "here" without
   *  printing an absolute path in a shared table. */
  workspaceFingerprint: string;
  task: string;
  model: string;
  brain: "local" | "cloud";
  started: string;
  ended: string | null;
  finalStatus: string;
  /** Failing tests the run left behind, when it left any. */
  remaining?: number;
  /** The command this session's verify gate ran, when one was named. */
  testCmd?: string;
  /** Number of distinct files the run wrote. Absent = not recorded, which is
   *  NOT the same as zero and must never be rendered as zero. */
  filesTouched?: number;
  events?: number;
  toolCalls?: number;
  /** Repository identity, when the session ran inside a checkout. */
  repoRemote?: string;
  branch?: string;
  baseRev?: string;
  headRev?: string;
  /** The worktree path, when the run used one distinct from the workspace. */
  worktree?: string;
  /** Pull request opened from this session, when one was. */
  prUrl?: string;
  /** Human label, when the session was given one. */
  label?: string;
  /** Skill ids/versions applied, when the run recorded provenance. */
  skills?: string[];
  /** Digest of the instruction graph in force, when recorded. */
  instructionsDigest?: string;
  /** Archived rows stay in the index (the record is not deleted) but are hidden
   *  from the default listing. */
  archived?: boolean;
}

export interface SessionIndexDocument {
  schemaVersion: number;
  entries: SessionIndexEntry[];
}

/** Why a read did not use the stored index. Surfaced, never swallowed: a user
 *  whose index was corrupt is told it was rebuilt and where the broken copy
 *  went. */
export interface SessionIndexRecovery {
  reason: JsonReadFailure | "schema" | "shape";
  detail: string;
  /** Path the unusable copy was preserved at, when it could be preserved. */
  preserved?: string;
}

export interface SessionIndexRead {
  entries: SessionIndexEntry[];
  /** Present when the stored index could not be used and the entries were
   *  rebuilt from the manifests on disk. */
  recovery?: SessionIndexRecovery;
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === "string"
    ? clipCodePoints(sanitizeTerm(value).replace(/\s+/g, " ").trim(), max)
    : "";
}

function optionalText(value: unknown, max = MAX_TEXT): string | undefined {
  return text(value, max) || undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export function indexPath(root: string = logsRoot()): string {
  return join(root, SESSION_INDEX_FILE);
}

/** `workspaceFingerprint` must never throw a listing away: an unusable path
 *  still gets a stable (empty) bucket rather than killing the read. */
function safeFingerprint(workspace: string): string {
  try {
    return workspaceFingerprint(workspace);
  } catch {
    return "";
  }
}

/** Validate one untrusted row. Returns null for anything that cannot be a row —
 *  a single bad entry costs that row, not the whole library. */
export function parseIndexEntry(value: unknown): SessionIndexEntry | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const sessionId = text(body["sessionId"], 160);
  if (!sessionId) return null;
  try {
    // The id is used as a directory name on every path that follows it.
    requireOpaqueId(sessionId, "session id");
  } catch {
    return null;
  }
  const workspace = text(body["workspace"], 1024);
  if (!workspace) return null;
  const skills = Array.isArray(body["skills"])
    ? (body["skills"] as unknown[])
        .filter((s): s is string => typeof s === "string")
        .slice(0, 32)
        .map((s) => text(s, 120))
        .filter(Boolean)
    : undefined;
  const remaining = count(body["remaining"]);
  const filesTouched = count(body["filesTouched"]);
  const events = count(body["events"]);
  const toolCalls = count(body["toolCalls"]);
  const testCmd = optionalText(body["testCmd"]);
  const repoRemote = optionalText(body["repoRemote"], 512);
  const branch = optionalText(body["branch"], 256);
  const baseRev = optionalText(body["baseRev"], 64);
  const headRev = optionalText(body["headRev"], 64);
  const worktree = optionalText(body["worktree"], 1024);
  const prUrl = optionalText(body["prUrl"], 512);
  const label = optionalText(body["label"], 160);
  const instructionsDigest = optionalText(body["instructionsDigest"], 128);
  return {
    sessionId,
    workspace,
    workspaceFingerprint: text(body["workspaceFingerprint"], 64) || safeFingerprint(workspace),
    task: text(body["task"]),
    model: text(body["model"], 120),
    brain: body["brain"] === "cloud" ? "cloud" : "local",
    started: text(body["started"], 40),
    ended: text(body["ended"], 40) || null,
    finalStatus: text(body["finalStatus"], 40) || "unknown",
    ...(remaining != null && remaining > 0 ? { remaining } : {}),
    ...(testCmd ? { testCmd } : {}),
    ...(filesTouched != null ? { filesTouched } : {}),
    ...(events != null ? { events } : {}),
    ...(toolCalls != null ? { toolCalls } : {}),
    ...(repoRemote ? { repoRemote } : {}),
    ...(branch ? { branch } : {}),
    ...(baseRev ? { baseRev } : {}),
    ...(headRev ? { headRev } : {}),
    ...(worktree ? { worktree } : {}),
    ...(prUrl ? { prUrl } : {}),
    ...(label ? { label } : {}),
    ...(skills && skills.length ? { skills } : {}),
    ...(instructionsDigest ? { instructionsDigest } : {}),
    ...(body["archived"] === true ? { archived: true } : {}),
  };
}

/** Build an index row from a session's manifest.json body. The manifest is the
 *  authority; this is the projection of it the library renders. */
export function entryFromManifest(sessionId: string, manifest: unknown): SessionIndexEntry | null {
  if (manifest == null || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  const body = { ...(manifest as Record<string, unknown>) };
  body["sessionId"] = body["sessionId"] ?? sessionId;
  // Manifests spell the workspace "cwd"; the index spells it "workspace"
  // because a row outlives the process whose cwd it was.
  if (body["workspace"] == null) body["workspace"] = body["cwd"];
  return parseIndexEntry(body);
}

/** Session directory names under `root`. Only directories holding a manifest
 *  count, and only names that are legal session ids. */
function sessionDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    try {
      requireOpaqueId(name, "session id");
      if (statSync(join(root, name)).isDirectory() && existsSync(join(root, name, "manifest.json"))) {
        out.push(name);
      }
    } catch {
      /* not a session directory */
    }
  }
  return out;
}

/**
 * Rebuild the entry list from the manifests on disk.
 *
 * Reads manifest.json ONLY. events.jsonl is never opened here — that file is
 * the transcript and can be megabytes; a listing that had to parse it would
 * reintroduce exactly the cost this index exists to remove.
 */
export function rebuildEntries(root: string = logsRoot()): SessionIndexEntry[] {
  const entries: SessionIndexEntry[] = [];
  for (const id of sessionDirs(root)) {
    const read = readJsonFile<unknown>(join(root, id, "manifest.json"));
    if (!read.ok) continue;
    const entry = entryFromManifest(id, read.value);
    if (entry) entries.push(entry);
  }
  return sortEntries(entries);
}

/** Newest first, with a TOTAL order: equal timestamps fall back to the id, so
 *  two sessions started in the same millisecond never swap places between
 *  renders. */
export function sortEntries(entries: SessionIndexEntry[]): SessionIndexEntry[] {
  return [...entries].sort((a, b) =>
    a.started === b.started ? b.sessionId.localeCompare(a.sessionId) : a.started < b.started ? 1 : -1,
  );
}

function parseDocument(value: unknown): { entries: SessionIndexEntry[] } | SessionIndexRecovery {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return { reason: "shape", detail: "index is not a JSON object" };
  }
  const body = value as Record<string, unknown>;
  const version = body["schemaVersion"];
  if (!Number.isInteger(version) || (version as number) < 1) {
    return { reason: "schema", detail: "index has no usable schemaVersion" };
  }
  if ((version as number) > SESSION_INDEX_SCHEMA_VERSION) {
    // Refuse forward: a newer Aether Agent may store rows this build would drop
    // on its next write, silently deleting the newer install's history.
    return {
      reason: "schema",
      detail:
        `index was written by a newer Aether Agent (schema ${String(version)}); ` +
        "upgrade with: npm i -g aether-agents",
    };
  }
  if (!Array.isArray(body["entries"])) return { reason: "shape", detail: "index has no entries array" };
  const entries: SessionIndexEntry[] = [];
  for (const raw of body["entries"] as unknown[]) {
    const entry = parseIndexEntry(raw);
    if (entry) entries.push(entry);
  }
  return { entries };
}

function isRecovery(
  value: { entries: SessionIndexEntry[] } | SessionIndexRecovery,
): value is SessionIndexRecovery {
  return "reason" in value;
}

/** Paths whose unusable copy has already been preserved in this process.
 *  Without this, a refused index (a forward schema is never overwritten) would
 *  drop a fresh `.corrupt.<stamp>` copy beside itself on EVERY listing. The
 *  evidence is kept once per run, which is what "preserved" has to mean. */
const preservedOnce = new Set<string>();

function preserveOnce(path: string, now?: string): string | null {
  if (preservedOnce.has(path)) return null;
  preservedOnce.add(path);
  return now ? preserveCorrupt(path, now) : preserveCorrupt(path);
}

/**
 * Read the library.
 *
 * Never throws for a broken index: an unusable file is preserved beside itself
 * and the entries are rebuilt from the manifests, with the reason reported so
 * the caller can SAY that recovery happened. A rebuilt read does not rewrite
 * the index — writing is a writer's job, and a read path that repaired on every
 * listing would fight concurrent runs for the lock. {@link syncSessionIndex} is
 * the read that DOES repair, and it is what the commands call.
 */
export function readSessionIndex(root: string = logsRoot(), now?: string): SessionIndexRead {
  const path = indexPath(root);
  const read = readJsonFile<unknown>(path);
  if (!read.ok) {
    if (read.reason === "missing") {
      // No index yet is the normal state of a fresh install, and of every
      // session written before this feature existed. Rebuilding is the answer,
      // and it is not a recovery worth reporting.
      return { entries: rebuildEntries(root) };
    }
    const preserved = preserveOnce(path, now);
    return {
      entries: rebuildEntries(root),
      recovery: { reason: read.reason, detail: read.detail, ...(preserved ? { preserved } : {}) },
    };
  }
  const parsed = parseDocument(read.value);
  if (isRecovery(parsed)) {
    const preserved = preserveOnce(path, now);
    return { entries: rebuildEntries(root), recovery: { ...parsed, ...(preserved ? { preserved } : {}) } };
  }
  return { entries: sortEntries(parsed.entries) };
}

function serialize(entries: SessionIndexEntry[]): string {
  const doc: SessionIndexDocument = {
    schemaVersion: SESSION_INDEX_SCHEMA_VERSION,
    entries: sortEntries(entries),
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

/** True when the stored index is one this build may overwrite. A future-schema
 *  index is left alone: losing a newer install's rows is worse than skipping an
 *  index update. */
function writable(root: string): boolean {
  const read = readJsonFile<unknown>(indexPath(root));
  if (!read.ok) return true;
  const parsed = parseDocument(read.value);
  return !(isRecovery(parsed) && parsed.reason === "schema" && parsed.detail.includes("newer"));
}

/**
 * Apply `mutate` to the library under the index lock.
 *
 * The read happens INSIDE the lock, which is what makes concurrent writers
 * safe: two runs closing at the same moment each see the other's row before
 * writing their own, instead of both expanding a stale snapshot with one
 * silently winning. atomicWriteFile keeps the previous generation as
 * index.json.bak, so an interrupted rename leaves a recoverable file.
 */
export interface SessionIndexWrite {
  entries: SessionIndexEntry[];
  /** False when the mutation was computed but NOT persisted — today that means
   *  the stored index belongs to a newer Aether Agent. Returned rather than
   *  thrown so a caller can say "not saved" instead of reporting a change it
   *  did not make. */
  written: boolean;
}

export function mutateSessionIndex(
  mutate: (entries: SessionIndexEntry[]) => SessionIndexEntry[],
  root: string = logsRoot(),
): SessionIndexWrite {
  return withFileLock(join(root, SESSION_INDEX_LOCK), "session-index", () => {
    const current = readSessionIndex(root).entries;
    const next = sortEntries(mutate(current));
    if (!writable(root)) return { entries: current, written: false };
    atomicWriteFile(indexPath(root), serialize(next), { backupPath: join(root, SESSION_INDEX_BACKUP) });
    return { entries: next, written: true };
  });
}

/** Field-wise merge: an absent field in the update does not erase a known one.
 *  Absent stays absent — never coerced to 0 or "". */
export function mergeEntry(prior: SessionIndexEntry, update: SessionIndexEntry): SessionIndexEntry {
  const merged: SessionIndexEntry = { ...prior };
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    if (key === "ended" && value === null) continue;
    (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}

/** Insert or update one row, keyed by session id. Later facts win field by
 *  field, so a session indexed at start and updated at close keeps the start
 *  fields the close call does not carry. */
export function upsertSessionIndex(entry: SessionIndexEntry, root: string = logsRoot()): void {
  const clean = parseIndexEntry(entry);
  if (!clean) return;
  mutateSessionIndex((entries) => {
    const prior = entries.find((e) => e.sessionId === clean.sessionId);
    const rest = entries.filter((e) => e.sessionId !== clean.sessionId);
    return [...rest, prior ? mergeEntry(prior, clean) : clean];
  }, root);
}

// ── reconciliation ──────────────────────────────────────────────────────────

export interface SessionIndexSync extends SessionIndexRead {
  /** Session directories on disk that produced no row — a manifest that is
   *  missing, unreadable, or not a session record. Reported, never silently
   *  dropped: a library that quietly shows fewer sessions than the disk holds
   *  is worse than one that says two of them could not be read. */
  unreadable: string[];
  /** Rows recovered from manifests because the stored index lacked them. */
  backfilled: number;
}

/**
 * Read the library AND make it agree with the disk.
 *
 * {@link readSessionIndex} trusts the stored file whenever it parses, which is
 * wrong the moment the file is merely INCOMPLETE rather than broken — every
 * session recorded before this index existed, and every session written by a
 * build that could not take the lock, is on disk with a manifest and absent
 * from the index. Trusting the file there would make a user's history vanish
 * the first time a new session was written.
 *
 * So the reconciliation is: read the index (one file), list the session
 * directories (one directory read, no file opens), and open a manifest ONLY for
 * an id the index does not already carry. Steady state is therefore one file
 * read and one readdir regardless of how many sessions exist; the backfill is
 * paid once, because the result is written back.
 *
 * events.jsonl is never opened on this path.
 */
export function syncSessionIndex(root: string = logsRoot(), now?: string): SessionIndexSync {
  const read = readSessionIndex(root, now);
  const stored = existsSync(indexPath(root));
  const known = new Set(read.entries.map((entry) => entry.sessionId));
  const unreadable: string[] = [];
  const added: SessionIndexEntry[] = [];
  for (const id of sessionDirs(root)) {
    if (known.has(id)) continue;
    const manifest = readJsonFile<unknown>(join(root, id, "manifest.json"));
    const entry = manifest.ok ? entryFromManifest(id, manifest.value) : null;
    if (entry) added.push(entry);
    else unreadable.push(id);
  }
  const base: SessionIndexSync = {
    entries: sortEntries([...read.entries, ...added]),
    ...(read.recovery ? { recovery: read.recovery } : {}),
    unreadable,
    backfilled: added.length,
  };
  // Write back when the stored file is absent, unusable, or short of the disk.
  // Nothing to write means nothing is written: a listing must not take the lock
  // and rewrite a healthy index on every invocation.
  if (!added.length && stored && !read.recovery) return base;
  if (!base.entries.length) return base;
  try {
    const merged = mutateSessionIndex((current) => {
      const have = new Set(current.map((entry) => entry.sessionId));
      return [...current, ...base.entries.filter((entry) => !have.has(entry.sessionId))];
    }, root);
    return { ...base, entries: merged.entries };
  } catch {
    // The cache could not be written (locked, read-only home). The answer above
    // is still correct — it came from the manifests — and the next read retries.
    return base;
  }
}

/** What an archive attempt actually did. Three outcomes, not two: a row that
 *  was never saved because the stored index belongs to a newer Aether Agent is
 *  not the same as a row that was archived, and the CLI must not print the same
 *  sentence for both. */
export type ArchiveResult = "archived" | "not-found" | "not-saved";

/** Mark a session archived (hidden from the default listing). The session
 *  directory, its worktree, its branch and its files are untouched — archiving
 *  is a view decision, not a deletion. */
export function archiveSession(
  sessionId: string,
  root: string = logsRoot(),
  archived = true,
): ArchiveResult {
  let found = false;
  const result = mutateSessionIndex(
    (entries) =>
      entries.map((entry) => {
        if (entry.sessionId !== sessionId) return entry;
        found = true;
        if (archived) return { ...entry, archived: true };
        const { archived: _was, ...rest } = entry;
        return rest;
      }),
    root,
  );
  if (!found) return "not-found";
  return result.written ? "archived" : "not-saved";
}

export interface PruneResult {
  /** Rows dropped from the index. Never a file, a directory, or a branch. */
  removed: SessionIndexEntry[];
  /** False when the change was computed but not persisted. */
  written: boolean;
}

/** Drop rows whose session directory is gone. Removes INDEX ROWS only — this
 *  never deletes a directory, a worktree, a branch, or a user file. */
export function pruneMissingSessions(root: string = logsRoot()): PruneResult {
  const removed: SessionIndexEntry[] = [];
  const result = mutateSessionIndex((entries) => {
    const kept: SessionIndexEntry[] = [];
    for (const entry of entries) {
      if (existsSync(join(root, entry.sessionId, "manifest.json"))) kept.push(entry);
      else removed.push(entry);
    }
    return kept;
  }, root);
  // A prune that was not persisted removed nothing, whatever the closure saw.
  return { removed: result.written ? removed : [], written: result.written };
}

/** Rows for one workspace. Matching is on the NORMALIZED path, so a row is
 *  never selected by id resemblance, and two spellings of one path agree. */
export function entriesForWorkspace(entries: SessionIndexEntry[], cwd: string): SessionIndexEntry[] {
  let here: string;
  try {
    here = normalizeWorkspace(cwd);
  } catch {
    return [];
  }
  return entries.filter((entry) => {
    try {
      return normalizeWorkspace(entry.workspace) === here;
    } catch {
      return false;
    }
  });
}

/** Find one row by EXACT id. A prefix is deliberately not accepted: two
 *  workspaces can hold sessions whose ids share a timestamp prefix, and the
 *  library must never continue the wrong project's work. */
export function findEntry(entries: SessionIndexEntry[], sessionId: string): SessionIndexEntry | null {
  return entries.find((entry) => entry.sessionId === sessionId) ?? null;
}
