// src/core/media_history.ts — durable identity and custody for generated media.
//
// The v1 log was a bare JSON array whose `index` was `entries.length + 1`.
// Retention trims to 100, so the 101st generation, the 102nd, and every one
// after all claimed index 101 — `output open 101` resolved to whichever
// duplicate came first. A parse failure returned `[]`, so a corrupt log was
// indistinguishable from "no generations yet", and the whole file was rewritten
// with a bare writeFileSync, so an interrupted write could lose every entry.
//
// v2 gives each artifact a UUID that never changes, a persistent monotonic
// `sequence` alias that survives trimming (so `output open 285` stays
// convenient), and a visible recovery state so history can never silently
// vanish. Writes go through durable_store's locked, fsync'd, backed-up
// transaction.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { preserveCorrupt, readJsonFile } from "./durable_store.js";

export const MEDIA_HISTORY_SCHEMA_VERSION = 2;
export const MEDIA_RETENTION = 100;

export type MediaEntryKind = "image" | "video" | "3d";
export type MediaEntrySource = "agent-media" | "recovered";

export interface MediaEntry {
  artifactId: string;
  /** Decimal string. Monotonic, persisted, never derived from entries.length. */
  sequence: string;
  createdAt: string;
  kind: MediaEntryKind;
  displayName: string;
  filePath: string;
  url: string;
  model: string;
  prompt: string;
  sizeBytes: number;
  source: MediaEntrySource;
  metadata?: Record<string, unknown>;
}

export interface MediaHistoryDoc {
  schemaVersion: number;
  generation: number;
  nextSequence: string;
  updatedAt: string;
  entries: MediaEntry[];
}

export type HistoryState = "ok" | "migrated" | "recovered-backup" | "rebuilt" | "degraded";

export interface HistoryWarning {
  code: string;
  message: string;
  recoveredAt: string;
  preservedCorruptPath?: string;
}

export interface HistoryLoad {
  doc: MediaHistoryDoc;
  state: HistoryState;
  warning?: HistoryWarning;
}

export interface HistoryPaths {
  outputDir: string;
  primary: string;
  backup: string;
  lock: string;
}

export function historyPaths(outputDir: string): HistoryPaths {
  const primary = join(outputDir, ".genlog.json");
  return { outputDir, primary, backup: primary + ".bak", lock: primary + ".lock" };
}

// ═════════════════════════════════════════════════════════════════════
// Validation
// ═════════════════════════════════════════════════════════════════════

const KINDS = new Set<MediaEntryKind>(["image", "video", "3d"]);

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}

/** Runtime shape check. Compile-time types say nothing about a file on disk. */
export function isMediaEntry(value: unknown): value is MediaEntry {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  if (typeof e["artifactId"] !== "string" || !e["artifactId"]) return false;
  if (!isDecimalString(e["sequence"])) return false;
  if (typeof e["createdAt"] !== "string") return false;
  if (!KINDS.has(e["kind"] as MediaEntryKind)) return false;
  if (typeof e["displayName"] !== "string") return false;
  const filePath = typeof e["filePath"] === "string" ? e["filePath"] : "";
  const url = typeof e["url"] === "string" ? e["url"] : "";
  // An entry with neither a local path nor a URL is unresolvable — it can
  // never be opened, so it is not a valid record of an artifact.
  if (!filePath && !url) return false;
  return typeof e["sizeBytes"] === "number" && Number.isFinite(e["sizeBytes"]);
}

/** Validate a parsed root document. Returns null when the shape is wrong. */
export function validateDoc(value: unknown): MediaHistoryDoc | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const doc = value as Record<string, unknown>;
  if (typeof doc["schemaVersion"] !== "number") return null;
  if (typeof doc["generation"] !== "number" || !Number.isFinite(doc["generation"])) return null;
  if (!isDecimalString(doc["nextSequence"])) return null;
  if (typeof doc["updatedAt"] !== "string") return null;
  if (!Array.isArray(doc["entries"]) || !doc["entries"].every(isMediaEntry)) return null;
  return doc as unknown as MediaHistoryDoc;
}

export function emptyDoc(now: string): MediaHistoryDoc {
  return {
    schemaVersion: MEDIA_HISTORY_SCHEMA_VERSION,
    generation: 0,
    nextSequence: "1",
    updatedAt: now,
    entries: [],
  };
}

export function maxSequenceOf(entries: readonly MediaEntry[]): bigint {
  return entries.reduce((max, e) => {
    const value = BigInt(e.sequence);
    return value > max ? value : max;
  }, 0n);
}

// ═════════════════════════════════════════════════════════════════════
// v1 migration
// ═════════════════════════════════════════════════════════════════════

interface LegacyEntry {
  index?: unknown;
  filename?: unknown;
  filepath?: unknown;
  model?: unknown;
  prompt?: unknown;
  kind?: unknown;
  url?: unknown;
  timestamp?: unknown;
  size_bytes?: unknown;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function legacyKind(value: unknown): MediaEntryKind {
  return KINDS.has(value as MediaEntryKind) ? (value as MediaEntryKind) : "image";
}

function legacyIndexOf(row: LegacyEntry): number | null {
  const index = row.index;
  return typeof index === "number" && Number.isInteger(index) && index > 0 ? index : null;
}

/**
 * Rebuild a v2 document from the legacy array. Duplicate, missing, and invalid
 * legacy indexes are repaired here — before the document is committed — so the
 * runtime resolver never has to "pick the first match".
 *
 * Ordering is canonical: sort by `timestamp` when present, falling back to the
 * stored array order (v1 pushed newest last) for entries without one. The sort
 * is stable, so repeated migrations of the same input produce the same order
 * and the same sequences.
 */
export function migrateLegacy(
  legacy: readonly unknown[],
  now: string,
  newId: () => string = randomUUID,
): MediaHistoryDoc {
  const rows = legacy
    .filter((row): row is LegacyEntry =>
      row != null && typeof row === "object" && !Array.isArray(row))
    .map((row, position) => ({ row, position }));

  const ordered = [...rows].sort((a, b) => {
    const ta = str(a.row.timestamp);
    const tb = str(b.row.timestamp);
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    return a.position - b.position;
  });

  // Only an index that is a positive integer AND unique across the whole legacy
  // set may be preserved. Everything else is reallocated above the survivors,
  // which is what repairs the run of duplicate 101s.
  const counts = new Map<number, number>();
  for (const { row } of ordered) {
    const index = legacyIndexOf(row);
    if (index !== null) counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  const preserved = new Set(
    [...counts.entries()].filter(([, count]) => count === 1).map(([index]) => index),
  );
  let cursor = preserved.size ? BigInt(Math.max(...preserved)) : 0n;

  const entries = ordered
    .map(({ row }): MediaEntry => {
      const index = legacyIndexOf(row);
      let sequence: string;
      if (index !== null && preserved.has(index)) {
        sequence = String(index);
      } else {
        cursor += 1n;
        sequence = cursor.toString();
      }
      const size =
        typeof row.size_bytes === "number" && Number.isFinite(row.size_bytes) ? row.size_bytes : 0;
      return {
        artifactId: newId(),
        sequence,
        createdAt: str(row.timestamp, now),
        kind: legacyKind(row.kind),
        displayName: str(row.filename),
        filePath: str(row.filepath),
        url: str(row.url),
        model: str(row.model),
        prompt: str(row.prompt),
        sizeBytes: size,
        source: "agent-media",
        metadata: index === null ? {} : { legacyIndex: index },
      };
    })
    .filter(isMediaEntry);

  return {
    schemaVersion: MEDIA_HISTORY_SCHEMA_VERSION,
    generation: 1,
    nextSequence: (maxSequenceOf(entries) + 1n).toString(),
    updatedAt: now,
    entries,
  };
}

// ═════════════════════════════════════════════════════════════════════
// Directory rebuild (last-resort recovery)
// ═════════════════════════════════════════════════════════════════════

const MEDIA_EXTENSIONS = new Map<string, MediaEntryKind>([
  [".png", "image"], [".jpg", "image"], [".jpeg", "image"], [".webp", "image"],
  [".svg", "image"], [".gif", "image"],
  [".mp4", "video"], [".webm", "video"], [".mov", "video"],
  [".glb", "3d"], [".gltf", "3d"],
]);

/**
 * Derive a stable ID from immutable file facts so re-running a rebuild over the
 * same directory yields the same artifacts instead of a fresh duplicate set.
 * Formatted as a UUIDv8 so every consumer can treat IDs uniformly.
 */
export function recoveryId(name: string, sizeBytes: number, mtimeMs: number): string {
  const digest = createHash("sha256")
    .update(`${name} ${sizeBytes} ${Math.trunc(mtimeMs)}`)
    .digest("hex");
  const variant = ((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    "8" + digest.slice(13, 16),
    variant + digest.slice(17, 20),
    digest.slice(20, 32),
  ].join("-");
}

/**
 * Recover what the filesystem still proves. Prompt and model are unknowable
 * from a file on disk, so they stay empty and `source` records the uncertainty
 * rather than inventing plausible values.
 */
export function rebuildFromDirectory(outputDir: string, now: string): MediaEntry[] {
  if (!existsSync(outputDir)) return [];
  let names: string[];
  try {
    names = readdirSync(outputDir);
  } catch {
    return [];
  }
  const found: Array<{ entry: MediaEntry; sortKey: number }> = [];
  for (const name of names) {
    const dot = name.lastIndexOf(".");
    const kind = dot < 0 ? undefined : MEDIA_EXTENSIONS.get(name.slice(dot).toLowerCase());
    if (!kind) continue;
    const full = join(outputDir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    found.push({
      sortKey: stat.mtimeMs,
      entry: {
        artifactId: recoveryId(name, stat.size, stat.mtimeMs),
        sequence: "1",
        createdAt: new Date(stat.mtimeMs).toISOString(),
        kind,
        displayName: name,
        filePath: full,
        url: "",
        model: "",
        prompt: "",
        sizeBytes: stat.size,
        source: "recovered",
        metadata: { rebuiltAt: now },
      },
    });
  }
  found.sort((a, b) =>
    a.sortKey === b.sortKey
      ? a.entry.displayName.localeCompare(b.entry.displayName)
      : a.sortKey - b.sortKey,
  );
  return found.map(({ entry }, i) => ({ ...entry, sequence: String(i + 1) }));
}

// ═════════════════════════════════════════════════════════════════════
// Load with recovery
// ═════════════════════════════════════════════════════════════════════

function warning(
  code: string,
  message: string,
  now: string,
  preservedCorruptPath?: string,
): HistoryWarning {
  return preservedCorruptPath
    ? { code, message, recoveredAt: now, preservedCorruptPath }
    : { code, message, recoveredAt: now };
}

function docFrom(entries: MediaEntry[], now: string): MediaHistoryDoc {
  return {
    schemaVersion: MEDIA_HISTORY_SCHEMA_VERSION,
    generation: 1,
    nextSequence: (maxSequenceOf(entries) + 1n).toString(),
    updatedAt: now,
    entries,
  };
}

/**
 * Read the best usable generation: primary, then backup, then a rebuild from
 * the output directory. Every degraded outcome carries a warning, so a caller
 * can never mistake a failure for an empty history.
 */
export function loadHistory(paths: HistoryPaths, now = new Date().toISOString()): HistoryLoad {
  const primary = readJsonFile<unknown>(paths.primary);

  if (primary.ok) {
    if (Array.isArray(primary.value)) {
      return { doc: migrateLegacy(primary.value, now), state: "migrated" };
    }
    const version = (primary.value as Record<string, unknown>)["schemaVersion"];
    if (typeof version === "number" && version > MEDIA_HISTORY_SCHEMA_VERSION) {
      // A newer Aether wrote this. Downgrading it to v2 would destroy fields
      // this binary cannot even name, so refuse and stay read-only.
      return {
        doc: emptyDoc(now),
        state: "degraded",
        warning: warning(
          "schema-too-new",
          `media history schema v${version} was written by a newer Aether; this build reads up to v${MEDIA_HISTORY_SCHEMA_VERSION} and will not overwrite it`,
          now,
        ),
      };
    }
    const valid = validateDoc(primary.value);
    if (valid) return { doc: valid, state: "ok" };
  }

  // Nothing written yet, and nothing to fall back to: a genuinely empty history.
  if (!primary.ok && primary.reason === "missing" && !existsSync(paths.backup)) {
    return { doc: emptyDoc(now), state: "ok" };
  }

  const preserved = preserveCorrupt(paths.primary, now) ?? undefined;

  const backup = readJsonFile<unknown>(paths.backup);
  if (backup.ok) {
    const fromBackup = Array.isArray(backup.value)
      ? migrateLegacy(backup.value, now)
      : validateDoc(backup.value);
    if (fromBackup) {
      return {
        doc: fromBackup,
        state: "recovered-backup",
        warning: warning(
          "recovered-from-backup",
          "media history primary was unusable; recovered the previous known-good generation",
          now,
          preserved,
        ),
      };
    }
  }

  const rebuilt = rebuildFromDirectory(paths.outputDir, now);
  if (rebuilt.length) {
    return {
      doc: docFrom(rebuilt, now),
      state: "rebuilt",
      warning: warning(
        "rebuilt-from-files",
        `media history was rebuilt from ${rebuilt.length} file(s) on disk; prompt and model could not be recovered`,
        now,
        preserved,
      ),
    };
  }

  return {
    doc: emptyDoc(now),
    state: "degraded",
    warning: warning(
      "history-lost",
      "media history could not be read or rebuilt; this is not the same as an empty history",
      now,
      preserved,
    ),
  };
}
