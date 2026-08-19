// skills.lock.json — records the digests of skills at lock time.
//
// A lock is safe to commit: it contains digests and paths only, never a trust
// decision or a secret. Trust lives in the local trust store (skill_trust.ts).
// Writes are atomic (write-tmp-then-rename, same rationale as config.ts).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir } from "../config.js";

export const SKILL_LOCK_SCHEMA_VERSION = 1;

export interface SkillLockEntry {
  id: string;
  version: string;
  /** Relative source path for project locks; absolute allowed for user locks. */
  source: string;
  sha256: string;
  dependencies: readonly string[];
}

export interface SkillLock {
  schemaVersion: number;
  skills: readonly SkillLockEntry[];
}

export function projectLockPath(projectRoot: string): string {
  return join(projectRoot, ".aether", "skills.lock.json");
}

export function userLockPath(): string {
  return join(configDir(), "skills.lock.json");
}

export type LockReadResult =
  | { ok: true; lock: SkillLock }
  | { ok: false; missing: boolean; error: string };

export function readSkillLock(path: string): LockReadResult {
  if (!existsSync(path)) return { ok: false, missing: true, error: "lock file not found: " + path };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { ok: false, missing: false, error: "lock file is not valid JSON: " + path };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, missing: false, error: "lock file must be a JSON object" };
  }
  const record = raw as Record<string, unknown>;
  if (record["schema_version"] !== SKILL_LOCK_SCHEMA_VERSION) {
    return { ok: false, missing: false, error: "unsupported lock schema_version: " + String(record["schema_version"]) };
  }
  const skillsRaw = record["skills"];
  if (!Array.isArray(skillsRaw)) return { ok: false, missing: false, error: "lock skills must be an array" };
  const skills: SkillLockEntry[] = [];
  for (const entry of skillsRaw) {
    if (typeof entry !== "object" || entry === null) return { ok: false, missing: false, error: "lock entry must be an object" };
    const item = entry as Record<string, unknown>;
    const id = item["id"];
    const version = item["version"];
    const source = item["source"];
    const sha256 = item["sha256"];
    const dependencies = item["dependencies"];
    if (typeof id !== "string" || typeof version !== "string" || typeof source !== "string" || typeof sha256 !== "string") {
      return { ok: false, missing: false, error: "lock entry missing id/version/source/sha256" };
    }
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      return { ok: false, missing: false, error: "lock entry sha256 must be 64 hex chars: " + id };
    }
    skills.push({
      id, version, source, sha256,
      dependencies: Array.isArray(dependencies) ? dependencies.filter((d): d is string => typeof d === "string") : [],
    });
  }
  return { ok: true, lock: { schemaVersion: SKILL_LOCK_SCHEMA_VERSION, skills } };
}

export function writeSkillLock(path: string, entries: readonly SkillLockEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const body = {
    schema_version: SKILL_LOCK_SCHEMA_VERSION,
    skills: sorted.map((entry) => ({
      id: entry.id,
      version: entry.version,
      source: entry.source,
      sha256: entry.sha256,
      dependencies: [...entry.dependencies].sort(),
    })),
  };
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

export interface LockDrift {
  /** In the index but absent from the lock. */
  unlocked: readonly string[];
  /** In the lock but no longer discovered. */
  missing: readonly string[];
  /** Present in both but digest differs. */
  changed: readonly string[];
}

export function compareLock(
  lock: SkillLock,
  discovered: ReadonlyMap<string, string>,
): LockDrift {
  const locked = new Map(lock.skills.map((entry) => [entry.id, entry.sha256]));
  const unlocked: string[] = [];
  const changed: string[] = [];
  for (const [id, sha256] of discovered) {
    const lockedSha = locked.get(id);
    if (lockedSha == null) unlocked.push(id);
    else if (lockedSha !== sha256) changed.push(id);
  }
  const missing = [...locked.keys()].filter((id) => !discovered.has(id));
  return { unlocked: unlocked.sort(), missing: missing.sort(), changed: changed.sort() };
}
