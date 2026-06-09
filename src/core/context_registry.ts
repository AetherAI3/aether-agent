// src/core/context_registry.ts — session-scoped context memory manager.
//
// /pin    — force a file/module into persistent context
// /drop   — evict a file from context
// /snapshot — save registry + session metadata to disk
// /limit  — hard UVT cap for the session
//
// All data is in-memory for the current REPL session. /snapshot serializes
// to ~/.aether-agent/snapshots/<timestamp>.json so sessions can be resumed.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ApiClient } from "./transport.js";
import { AGENT_CONTEXT_PATH } from "./transport.js";

// ── Types ──

export interface PinnedEntry {
  /** File path or module identifier. */
  path: string;
  /** Human label (filename, interface name, etc.). */
  label: string;
  /** Why it was pinned — shown on /snapshot resume so agent knows what mattered. */
  reason: string;
  /** ISO timestamp when pinned. */
  pinnedAt: string;
}

export interface SnapshotData {
  /** ISO timestamp of snapshot. */
  createdAt: string;
  /** The active branch / task description. */
  sessionLabel: string;
  /** Pinned entries at snapshot time. */
  pins: PinnedEntry[];
  /** Dropped paths (for reference — what was intentionally evicted). */
  drops: string[];
  /** UVT cap if set. */
  uvtCap: number | null;
  /** UVT spent so far (read from custody log). */
  uvtSpent: number;
  /** Active plan file path (if any). */
  planPath: string | null;
  /** Working directory. */
  cwd: string;
}

// ── In-memory state (one per REPL session) ──

export class ContextRegistry {
  pins: PinnedEntry[] = [];
  drops: string[] = [];
  uvtCap: number | null = null;
  uvtSpent = 0;
  planPath: string | null = null;
  sessionLabel = "untitled";

  pin(path: string, label: string, reason: string): PinnedEntry {
    // Deduplicate — remove from drops if it was dropped, update pin
    this.drops = this.drops.filter((d) => d !== path);
    const existing = this.pins.findIndex((p) => p.path === path);
    const entry: PinnedEntry = { path, label, reason, pinnedAt: new Date().toISOString() };
    if (existing >= 0) {
      this.pins[existing] = entry;
    } else {
      this.pins.push(entry);
    }
    return entry;
  }

  drop(path: string): boolean {
    this.pins = this.pins.filter((p) => p.path !== path);
    if (!this.drops.includes(path)) {
      this.drops.push(path);
      return true;
    }
    return false; // already dropped
  }

  isPinned(path: string): boolean {
    return this.pins.some((p) => p.path === path);
  }

  setUvtCap(amount: number): void {
    this.uvtCap = amount;
  }

  /** Check if UVT cap is exceeded. Returns remaining or -1 if exceeded. */
  checkUvtCap(): { capped: boolean; remaining: number; cap: number | null } {
    if (this.uvtCap == null) return { capped: false, remaining: Infinity, cap: null };
    const remaining = this.uvtCap - this.uvtSpent;
    return { capped: remaining <= 0, remaining: Math.max(0, remaining), cap: this.uvtCap };
  }

  /** Export snapshot data for serialization. */
  toSnapshot(): SnapshotData {
    return {
      createdAt: new Date().toISOString(),
      sessionLabel: this.sessionLabel,
      pins: [...this.pins],
      drops: [...this.drops],
      uvtCap: this.uvtCap,
      uvtSpent: this.uvtSpent,
      planPath: this.planPath,
      cwd: process.cwd(),
    };
  }

  /** Restore from a snapshot file. */
  static fromSnapshot(data: SnapshotData): ContextRegistry {
    const reg = new ContextRegistry();
    reg.sessionLabel = data.sessionLabel;
    reg.pins = data.pins;
    reg.drops = data.drops;
    reg.uvtCap = data.uvtCap;
    reg.uvtSpent = data.uvtSpent;
    reg.planPath = data.planPath;
    return reg;
  }
}

// ── Singleton ──

let _registry: ContextRegistry | null = null;

export function getRegistry(): ContextRegistry {
  if (!_registry) _registry = new ContextRegistry();
  return _registry;
}

/** Reset the registry (e.g., on /clear or new session). */
export function resetRegistry(): void {
  _registry = new ContextRegistry();
}

// ── Snapshot persistence ──

export function snapshotsRoot(): string {
  return process.env["AETHER_SNAPSHOT_DIR"] ?? join(homedir(), ".aether-agent", "snapshots");
}

export function saveSnapshot(reg: ContextRegistry): string {
  const dir = snapshotsRoot();
  mkdirSync(dir, { recursive: true });
  const data = reg.toSnapshot();
  const filename = `snapshot-${data.createdAt.replace(/[:.]/g, "-")}.json`;
  const path = join(dir, filename);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  return path;
}

export function loadSnapshot(id: string): SnapshotData | null {
  const dir = snapshotsRoot();
  const path = join(dir, id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SnapshotData;
  } catch {
    return null;
  }
}

export function listSnapshots(): Array<{ id: string; data: SnapshotData }> {
  const dir = snapshotsRoot();
  if (!existsSync(dir)) return [];
  const results: Array<{ id: string; data: SnapshotData }> = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const data = loadSnapshot(name);
    if (data) results.push({ id: name, data });
  }
  results.sort((a, b) => b.data.createdAt.localeCompare(a.data.createdAt));
  return results;
}

// ── Backend sync ──

/**
 * Push the current registry state to the AETHER-CLOUD backend.
 * Fail-soft: logs a warning on network error, never throws.
 * Returns true if the sync succeeded.
 */
export async function syncToBackend(api: ApiClient): Promise<boolean> {
  try {
    const reg = getRegistry();
    await api.postJson(AGENT_CONTEXT_PATH, reg.toSnapshot());
    return true;
  } catch (err) {
    // Best-effort — backend may be offline or vault not configured
    return false;
  }
}

/**
 * Pull the last-saved context state from the backend into the registry.
 * Returns true if state was loaded, false if no state or error.
 */
export async function loadFromBackend(api: ApiClient): Promise<boolean> {
  try {
    const resp = await api.getJson<{ found: boolean; state: SnapshotData | null }>(AGENT_CONTEXT_PATH);
    if (!resp.found || !resp.state) return false;
    const reg = getRegistry();
    reg.sessionLabel = resp.state.sessionLabel;
    reg.pins = resp.state.pins;
    reg.drops = resp.state.drops;
    reg.uvtCap = resp.state.uvtCap;
    reg.uvtSpent = resp.state.uvtSpent;
    reg.planPath = resp.state.planPath;
    return true;
  } catch {
    return false;
  }
}
