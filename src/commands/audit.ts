// `aether audit [limit]` — show your recent chain-of-custody receipts.
//
// The server signs each chat turn and returns it in the stream but stores
// nothing, so the DEFAULT view reads the CLIENT-HELD log this machine persists
// (~/.config/aether/custody.jsonl). Each row shows order_id + commitment/
// attestation hashes + timestamp; pass an order_id to `aether receipt` to export
// a proof package. `--json` emits the raw records.
//
// `aether audit server [limit]` is a secondary path that hits the stateless
// server trail for any non-chat custody it still surfaces.

import type { AppContext } from "../core/context.js";
import { fetchTrail } from "../core/audit.js";
import { readCustodyLog, type CustodyRecord } from "../core/custody.js";

const DEFAULT_LIMIT = 50;

export async function cmdAudit(ctx: AppContext, argv: string[]): Promise<number> {
  if (argv[0] === "server") {
    return auditServer(ctx, argv.slice(1));
  }
  return auditClient(ctx, argv);
}

/** Default: the client-held custody log of this user's CLI chats. */
function auditClient(ctx: AppContext, argv: string[]): number {
  const limit = parseLimit(argv[0]);
  const records = readCustodyLog(limit);

  if (ctx.flags.json) {
    process.stdout.write(JSON.stringify(records, null, 2) + "\n");
    return 0;
  }
  if (records.length === 0) {
    process.stdout.write("(no client-held custody — chat to sign your first turn)\n");
    return 0;
  }
  for (const r of records) {
    const ts = r.received_at != null ? new Date(r.received_at).toISOString() : "-";
    const orderId = String(r.order_id ?? "-");
    const commitment = hashOf(r.commitment);
    const attestation = hashOf(r.attestation);
    process.stdout.write(`${ts}\t${orderId}\tc:${commitment}\ta:${attestation}\n`);
  }
  return 0;
}

/** Secondary: the stateless server trail. */
async function auditServer(ctx: AppContext, argv: string[]): Promise<number> {
  const limit = parseLimit(argv[0]);
  const entries = await fetchTrail(ctx.api, { limit });

  if (ctx.flags.json) {
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    return 0;
  }
  if (entries.length === 0) {
    process.stdout.write("(no server audit entries)\n");
    return 0;
  }
  for (const e of entries) {
    const sig = e.commitmentHash ?? "-";
    process.stdout.write(`${e.timestamp}\t${e.eventType}\t${sig}\t${e.orderId}\t${e.path ?? ""}\n`);
  }
  return 0;
}

/** Short, stable hash-ish display for a commitment/attestation blob. */
function hashOf(v: CustodyRecord["commitment"]): string {
  if (v == null) return "-";
  if (typeof v === "string") return v.slice(0, 12) || "-";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const inner = o["hash"] ?? o["env_hash"] ?? o["commitment_hash"] ?? o["digest"];
    if (inner != null) return String(inner).slice(0, 12);
  }
  return "✓"; // present but no obvious hash field
}

function parseLimit(arg: string | undefined): number {
  const n = arg ? Number(arg) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 500) : DEFAULT_LIMIT;
}
