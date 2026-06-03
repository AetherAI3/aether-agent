// `aether audit [limit]` — show the recent audit chain-of-custody trail
// for the logged-in user (GET /audit/trail/live). Each row shows the
// commitment_hash + order_id; pass an order_id to `aether receipt` to export a
// proof package. `--json` emits the raw entries.

import type { AppContext } from "../core/context.js";
import { fetchTrail } from "../core/audit.js";

const DEFAULT_LIMIT = 50;

export async function cmdAudit(ctx: AppContext, argv: string[]): Promise<number> {
  const limit = parseLimit(argv[0]);
  const entries = await fetchTrail(ctx.api, { limit });

  if (ctx.flags.json) {
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    return 0;
  }
  if (entries.length === 0) {
    process.stdout.write("(no audit entries)\n");
    return 0;
  }
  for (const e of entries) {
    const sig = e.commitmentHash ?? "-";
    process.stdout.write(`${e.timestamp}\t${e.eventType}\t${sig}\t${e.orderId}\t${e.path ?? ""}\n`);
  }
  return 0;
}

function parseLimit(arg: string | undefined): number {
  const n = arg ? Number(arg) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 500) : DEFAULT_LIMIT;
}
