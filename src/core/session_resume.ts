// src/core/session_resume.ts — local-first session resume. Reads the JSONL the
// SessionLog already wrote under ~/.aether-agent/logs/<id>/ and rehydrates the
// transcript. No backend, works offline. (Cross-device sync is Plan B.)

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { logsRoot, monologueLine } from "./session_log.js";
import { decodeEvent, type BrainEvent } from "./brain_protocol.js";
import { isCurrentWorkspace, resolveOpaqueChild } from "./workspace_scope.js";

export interface SessionManifest {
  sessionId: string;
  task: string;
  model: string;
  brain: "local" | "cloud";
  started: string;
  ended?: string | null;
  finalStatus?: string;
  cwd?: string;
  /** Failing tests the run left behind, when it left any. */
  remaining?: number;
  /** The command this session's verify gate ran, when one was named. */
  testCmd?: string;
}

export interface LoadedSession {
  dir: string;
  manifest: SessionManifest;
  events: Array<Record<string, unknown>>;
}

/** Load one session by id (directory name) from the logs root. */
export function loadSession(id: string, root: string = logsRoot(), cwd?: string): LoadedSession {
  const dir = resolveOpaqueChild(root, id, "session id");
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`no such session: ${id}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SessionManifest;
  if (cwd !== undefined && !isCurrentWorkspace(manifest.cwd, cwd)) {
    throw new Error(`session belongs to another workspace: ${id}`);
  }
  const eventsPath = join(dir, "events.jsonl");
  const events = existsSync(eventsPath)
    ? readFileSync(eventsPath, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];
  return { dir, manifest, events };
}
/** The most recently started session, or null if none. */
export function latestSession(cwd: string, root: string = logsRoot()): LoadedSession | null {
  if (!existsSync(root)) return null;
  const ids = readdirSync(root).filter((n) => {
    try {
      return statSync(join(root, n)).isDirectory() && existsSync(join(root, n, "manifest.json"));
    } catch {
      return false;
    }
  });
  let best: LoadedSession | null = null;
  for (const id of ids) {
    try {
      const s = loadSession(id, root);
      if (!isCurrentWorkspace(s.manifest.cwd, cwd)) continue;
      if (!best || s.manifest.started > best.manifest.started) best = s;
    } catch {
      /* skip unreadable */
    }
  }
  return best;
}

/** Render stored events back into transcript lines (reuses monologueLine). */
export function replayLines(events: Array<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const raw of events) {
    const ev: BrainEvent | null = decodeEvent(raw);
    if (!ev) continue;
    const line = monologueLine(ev);
    if (line) out.push(line);
  }
  return out;
}
