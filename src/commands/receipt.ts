// `aether receipt <order_id>` — export the Aether audit cryptographic proof
// package for a signed audit entry (POST /audit/export-proof). Find order ids
// with `aether audit`.

import type { AppContext } from "../core/context.js";
import { exportProof } from "../core/audit.js";

export async function cmdReceipt(ctx: AppContext, orderId: string): Promise<number> {
  if (!orderId) {
    process.stderr.write("usage: aether receipt <order_id>   (list ids: aether audit)\n");
    return 2;
  }
  const proof = await exportProof(ctx.api, [orderId]);
  process.stdout.write(JSON.stringify(proof, null, 2) + "\n");
  return 0;
}
