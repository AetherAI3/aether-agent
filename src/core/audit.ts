// request audit (chain of custody).
//
// Every chat is signed server-side; the integrity id is `commitment_hash`.
// The CLI never signs — it reads the per-user audit trail and can export a
// cryptographic proof package on demand. Routes confirmed in the Aether API:
//   GET  /audit/trail/live   -> { entries:[{... commitment_hash}], count }
//   POST /audit/export-proof -> { entry_ids } -> proof package (v1.0)

import type { ApiClient } from "./transport.js";
import { AUDIT_TRAIL_PATH, EXPORT_PROOF_PATH } from "./transport.js";

export interface AuditEntry {
  timestamp: number | string;
  phase: string;
  orderId: string;
  eventType: string;
  path?: string;
  source?: string;
  severity?: string;
  commitmentHash?: string;
}

interface RawTrailResponse {
  entries: Array<Record<string, unknown>>;
  count: number;
}

export interface TrailOptions {
  limit?: number;
  eventType?: string;
  since?: number;
}

export async function fetchTrail(api: ApiClient, opts: TrailOptions = {}): Promise<AuditEntry[]> {
  const q = new URLSearchParams();
  if (opts.limit != null) q.set("limit", String(opts.limit));
  if (opts.eventType) q.set("event_type", opts.eventType);
  if (opts.since != null) q.set("since", String(opts.since));
  const qs = q.toString();
  const r = await api.getJson<RawTrailResponse>(qs ? `${AUDIT_TRAIL_PATH}?${qs}` : AUDIT_TRAIL_PATH);
  return (r.entries ?? []).map(normalizeEntry);
}

/** Export a cryptographic proof package for the given audit order ids. */
export async function exportProof(api: ApiClient, entryIds: string[]): Promise<unknown> {
  return api.postJson<unknown>(EXPORT_PROOF_PATH, { entry_ids: entryIds });
}

function normalizeEntry(o: Record<string, unknown>): AuditEntry {
  return {
    timestamp: (o["timestamp"] as number | string) ?? "",
    phase: String(o["phase"] ?? ""),
    orderId: String(o["order_id"] ?? ""),
    eventType: String(o["event_type"] ?? ""),
    path: strOrUndef(o["path"]),
    source: strOrUndef(o["source"]),
    severity: strOrUndef(o["severity"]),
    commitmentHash: strOrUndef(o["commitment_hash"]),
  };
}

function strOrUndef(v: unknown): string | undefined {
  return v == null || v === "" ? undefined : String(v);
}
