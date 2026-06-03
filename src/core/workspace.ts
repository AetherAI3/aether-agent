// Workspace — local file context the coding agent reads, and the edits it
// applies. The agent brain runs server-side (Aether's servers); this is the local hands.
//
// Edits are applied as whole-file writes; diff/patch edits are planned.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { WorkspaceContext } from "./envelope.js";

export interface FileEdit {
  /** Path relative to cwd (or absolute within cwd). */
  path: string;
  /** Full new file contents (whole-file replace). */
  contents: string;
}

/** Read the named files into a WorkspaceContext (skips missing / non-files). */
export function gatherContext(cwd: string, files: string[]): WorkspaceContext {
  const out: Record<string, string> = {};
  for (const f of files) {
    const abs = isAbsolute(f) ? f : join(cwd, f);
    if (existsSync(abs) && statSync(abs).isFile()) {
      out[relative(cwd, abs)] = readFileSync(abs, "utf8");
    }
  }
  return { cwd, files: out };
}

/** Apply one edit, refusing any path that escapes cwd (traversal guard). */
export function applyEdit(cwd: string, edit: FileEdit): void {
  const abs = resolve(cwd, edit.path);
  const root = resolve(cwd);
  if (abs !== root && !abs.startsWith(root + pathSep())) {
    throw new Error(`refusing edit outside workspace: ${edit.path}`);
  }
  writeFileSync(abs, edit.contents, "utf8");
}

function pathSep(): string {
  return process.platform === "win32" ? "\\" : "/";
}
