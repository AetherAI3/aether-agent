// Client-held chain-of-custody log.
//
// The server signs each chat turn and returns the signed receipt in the stream,
// but stores nothing. This client persists those receipts locally so your chats
// are logged on your own machine — you hold the proof, not the server.
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { configDir } from "./config.js";

const MAX = 500;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_STRING_LENGTH = 8192;
const MAX_DEPTH = 8;
const MAX_COLLECTION_ITEMS = 256;
const TOP_LEVEL_FIELDS = new Set(["protocol", "order_id", "commitment_hash", "commitment", "attestation"]);
const SENSITIVE_KEY = /(?:token|secret|password|passwd|authorization|api[_-]?key|private[_-]?key|credential|cookie)/i;
const SECRET_VALUE = /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[opusr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,}|npm_[A-Za-z0-9]{8,}|pypi-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|Bearer\s+[A-Za-z0-9._~+/-]{8,})\b/i;
const QUERY_SECRET = /[?&](?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|password|passwd|secret|signature|sig)=/i;
const TERMINAL_CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]|\x1b/;

export function custodyLogPath(): string {
  return join(configDir(), "custody.jsonl");
}

export interface CustodyRecord {
  protocol?: string;
  order_id?: string;
  commitment_hash?: string;
  commitment?: unknown;
  attestation?: unknown;
  received_at?: number;
}

/** Closed, bounded receipt normalization. Signed proof data is either retained
 * byte-for-byte or rejected; it is never silently redacted (which would make
 * the signature unverifiable). */
export function normalizeCustodyRecord(value: unknown): CustodyRecord | null {
  if (!isPlainRecord(value)) return null;
  const incoming = value as Record<string, unknown>;
  const keys = Object.keys(incoming).filter((key) => key !== "received_at");
  if (keys.some((key) => !TOP_LEVEL_FIELDS.has(key))) return null;
  const orderId = incoming["order_id"];
  if (typeof orderId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(orderId)) return null;
  if (incoming["protocol"] !== undefined && !safeText(incoming["protocol"], 128)) return null;
  if (incoming["commitment_hash"] !== undefined && !safeText(incoming["commitment_hash"], 1024)) return null;
  if (incoming["commitment"] !== undefined && !safeJson(incoming["commitment"], 0)) return null;
  if (incoming["attestation"] !== undefined && !safeJson(incoming["attestation"], 0)) return null;
  if (
    incoming["received_at"] !== undefined &&
    (typeof incoming["received_at"] !== "number" || !Number.isFinite(incoming["received_at"]))
  ) return null;

  const record: CustodyRecord = {
    ...(typeof incoming["protocol"] === "string" ? { protocol: incoming["protocol"] } : {}),
    order_id: orderId,
    ...(typeof incoming["commitment_hash"] === "string" ? { commitment_hash: incoming["commitment_hash"] } : {}),
    ...(incoming["commitment"] === undefined ? {} : { commitment: incoming["commitment"] }),
    ...(incoming["attestation"] === undefined ? {} : { attestation: incoming["attestation"] }),
    ...(typeof incoming["received_at"] === "number" ? { received_at: incoming["received_at"] } : {}),
  };
  try {
    if (Buffer.byteLength(JSON.stringify(record), "utf8") > MAX_RECORD_BYTES) return null;
  } catch {
    return null;
  }
  return record;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeText(value: unknown, max = MAX_STRING_LENGTH): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    !TERMINAL_CONTROL.test(value) &&
    !SECRET_VALUE.test(value) &&
    !QUERY_SECRET.test(value)
  );
}

function safeJson(value: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return safeText(value);
  if (Array.isArray(value)) {
    return value.length <= MAX_COLLECTION_ITEMS && value.every((item) => safeJson(item, depth + 1));
  }
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_COLLECTION_ITEMS &&
    entries.every(
      ([key, item]) =>
        safeText(key, 128) &&
        !SENSITIVE_KEY.test(key) &&
        safeJson(item, depth + 1),
    )
  );
}

/**
 * Append one signed custody record (de-duped by order_id against the recent
 * tail). `path` is injectable so `doctor --live` can prove this exact code path
 * against a doctor-owned sandbox instead of writing into the user's real log.
 */
export function appendCustody(
  custody: Record<string, unknown>,
  path: string = custodyLogPath(),
): void {
  try {
    const normalized = normalizeCustodyRecord(custody);
    if (!normalized?.order_id) return;
    const orderId = normalized.order_id;
    const existing = readCustodyLog(MAX, path);
    if (existing.some((e) => e.order_id === orderId)) return;
    mkdirSync(dirname(path), { recursive: true });
    const rec: CustodyRecord = { ...normalized, received_at: Date.now() };
    appendFileSync(path, JSON.stringify(rec) + "\n", "utf8");
  } catch {
    /* persistence is best-effort — never break the chat */
  }
}

/** Read the client-held custody log, newest-first, capped at `limit`. */
export function readCustodyLog(limit = 200, path: string = custodyLogPath()): CustodyRecord[] {
  try {
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
    const recs: CustodyRecord[] = [];
    for (const l of lines) {
      try {
        const normalized = normalizeCustodyRecord(JSON.parse(l));
        if (normalized) recs.push(normalized);
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
