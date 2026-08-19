// Canonical content digest for a skill package.
//
// One SHA-256 over: normalized skill.json, SKILL.md (entrypoint), every
// DECLARED resource/eval file — deterministically path-sorted, length-prefixed
// so file boundaries cannot be forged by concatenation. Timestamps, filesystem
// metadata, and undeclared files never contribute. Trust binds to this digest.

import { createHash } from "node:crypto";
import { openSync, readSync, fstatSync, closeSync, constants } from "node:fs";
import { join, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import type { SkillManifest } from "./skill_schema.js";
import { SKILL_BOUNDS } from "./skill_bounds.js";

export interface SkillDigestResult {
  ok: true;
  sha256: string;
  /** Relative paths that contributed, sorted. */
  files: readonly string[];
}

export interface SkillDigestFailure {
  ok: false;
  error: string;
}

/** JSON with sorted keys at every level — a stable byte form of the manifest. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return "{" + keys.map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key])).join(",") + "}";
}

/**
 * Open one declared file with symlink-escape protection and a byte cap.
 * Uses open + fstat on the handle (not path-based stat) so the content that is
 * hashed is the content that was size-checked — no TOCTOU window between them.
 */
function readBoundedInsideRoot(root: string, relative: string, maxBytes: number):
  | { ok: true; bytes: Buffer }
  | { ok: false; error: string } {
  const absolute = resolve(root, relative);
  const realRoot = realpathSync(root);
  let real: string;
  try {
    real = realpathSync(absolute);
  } catch {
    return { ok: false, error: "declared file missing: " + relative };
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    return { ok: false, error: "declared file escapes the skill root: " + relative };
  }
  let fd: number;
  try {
    fd = openSync(real, constants.O_RDONLY);
  } catch {
    return { ok: false, error: "declared file unreadable: " + relative };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, error: "declared path is not a regular file: " + relative };
    if (stat.size > maxBytes) {
      return { ok: false, error: "declared file exceeds " + maxBytes + " bytes: " + relative };
    }
    const bytes = Buffer.alloc(Number(stat.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    if (offset !== bytes.length) return { ok: false, error: "short read on declared file: " + relative };
    return { ok: true, bytes };
  } finally {
    closeSync(fd);
  }
}

/** Every file the digest covers, relative to the skill root, sorted, deduplicated. */
export function digestFileList(manifest: SkillManifest): string[] {
  const files = new Set<string>([manifest.entrypoint]);
  for (const resource of manifest.context.resources) files.add(resource);
  if (manifest.health.evalManifest) files.add(manifest.health.evalManifest);
  return [...files].sort();
}

export function calculateSkillDigest(
  root: string,
  manifest: SkillManifest,
  rawManifestValue: unknown,
): SkillDigestResult | SkillDigestFailure {
  const hash = createHash("sha256");
  const manifestBytes = Buffer.from(canonicalJson(rawManifestValue), "utf8");
  hash.update("manifest\0");
  hash.update(String(manifestBytes.length) + "\0");
  hash.update(manifestBytes);

  const files = digestFileList(manifest);
  for (const relative of files) {
    const cap = relative === manifest.entrypoint
      ? SKILL_BOUNDS.maxInstructionBytes
      : SKILL_BOUNDS.maxResourceBytes;
    const read = readBoundedInsideRoot(root, relative, cap);
    if (!read.ok) return read;
    hash.update("file\0" + relative + "\0");
    hash.update(String(read.bytes.length) + "\0");
    hash.update(read.bytes);
  }
  return { ok: true, sha256: hash.digest("hex"), files };
}

/** Digest of one in-memory buffer — used for per-resource digests in the context packet. */
export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export { readBoundedInsideRoot };

/** Convenience for building a path inside a skill root without traversal risk. */
export function skillFilePath(root: string, relative: string): string {
  return join(root, relative);
}
