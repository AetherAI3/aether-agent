import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type WorkspaceScope = "current" | "other" | "unscoped";

function fold(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

export function normalizeWorkspace(cwd: string): string {
  if (!cwd.trim()) throw new Error("workspace path is empty");
  const absolute = resolve(cwd);
  const canonical = existsSync(absolute) ? realpathSync.native(absolute) : absolute;
  return fold(canonical.replace(/[\\/]+$/, "") || sep);
}

export function workspaceFingerprint(cwd: string): string {
  return createHash("sha256").update(normalizeWorkspace(cwd)).digest("hex").slice(0, 16);
}

export function workspaceScope(recordCwd: string | undefined, currentCwd: string): WorkspaceScope {
  if (!recordCwd) return "unscoped";
  try {
    return normalizeWorkspace(recordCwd) === normalizeWorkspace(currentCwd) ? "current" : "other";
  } catch {
    return "other";
  }
}

export function isCurrentWorkspace(recordCwd: string | undefined, currentCwd: string): boolean {
  return workspaceScope(recordCwd, currentCwd) === "current";
}

export function requireOpaqueId(id: string, label = "id"): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) || id === "." || id === "..") {
    throw new Error(`invalid ${label}`);
  }
  return id;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

function canonicalizeCandidate(candidate: string): string {
  if (existsSync(candidate)) return fold(realpathSync.native(candidate));
  const suffix: string[] = [];
  let cursor = candidate;
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(cursor.slice(parent.length).replace(/^[\\/]+/, ""));
    cursor = parent;
  }
  const base = existsSync(cursor) ? realpathSync.native(cursor) : cursor;
  return fold(resolve(base, ...suffix));
}

export function confineToWorkspace(cwd: string, candidate: string, mustExist = false): string {
  const root = normalizeWorkspace(cwd);
  const lexical = fold(resolve(cwd, candidate));
  if (!inside(root, lexical)) throw new Error("path escapes workspace");
  const canonical = canonicalizeCandidate(lexical);
  if (!inside(root, canonical)) throw new Error("path escapes workspace through a link");
  if (mustExist && (!existsSync(canonical) || !statSync(canonical).isFile())) {
    throw new Error("workspace file does not exist");
  }
  return canonical;
}

export function resolveOpaqueChild(root: string, id: string, label = "id"): string {
  const safe = requireOpaqueId(id, label);
  const canonicalRoot = normalizeWorkspace(root);
  const child = fold(resolve(root, safe));
  if (!inside(canonicalRoot, child)) throw new Error(`invalid ${label}`);
  return child;
}
