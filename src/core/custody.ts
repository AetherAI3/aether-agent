// Client-held chain-of-custody log.
//
// The server signs each chat turn and returns the signed receipt in the stream,
// but stores nothing. This client persists those receipts locally so your chats
// are logged on your own machine — you hold the proof, not the server.
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { configDir } from "./config.js";

const MAX = 500;

export function custodyLogPath(): string {
  return join(configDir(), "custody.jsonl");
}

export interface CustodyRecord {
  protocol?: string;
  order_id?: string;
  commitment?: unknown;
  attestation?: unknown;
  received_at?: number;
  [k: string]: unknown;
}

/** Append one signed custody record (de-duped by order_id against the recent tail). */
export function appendCustody(custody: Record<string, unknown>): void {
  try {
    const orderId = custody["order_id"];
    if (!orderId) return;
    const existing = readCustodyLog(MAX);
    if (existing.some((e) => e.order_id === orderId)) return;
    const path = custodyLogPath();
    mkdirSync(dirname(path), { recursive: true });
    const rec: CustodyRecord = { ...custody, received_at: Date.now() };
    appendFileSync(path, JSON.stringify(rec) + "\n", "utf8");
  } catch {
    /* persistence is best-effort — never break the chat */
  }
}

/** Read the client-held custody log, newest-first, capped at `limit`. */
export function readCustodyLog(limit = 200): CustodyRecord[] {
  try {
    const path = custodyLogPath();
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
    const recs: CustodyRecord[] = [];
    for (const l of lines) {
      try {
        recs.push(JSON.parse(l) as CustodyRecord);
      } catch {
        /* skip corrupt */
      }
    }
    recs.reverse(); // newest-first
    return recs.slice(0, limit);
  } catch {
    return [];
  }
}

/** Short, stable hash-ish display for a commitment/attestation blob. */
export function shortCustodyHash(v: unknown): string {
  if (v == null) return "-";
  if (typeof v === "string") return v.slice(0, 12) || "-";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const inner = o["hash"] ?? o["env_hash"] ?? o["commitment_hash"] ?? o["digest"];
    if (inner != null) return String(inner).slice(0, 12);
  }
  return "✓"; // present but no obvious hash field
}
