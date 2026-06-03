// `aether models`            — list models + orchestrators (unified catalog)
// `aether models use <id>`   — set the local default model/orchestrator
// `aether agents`            — orchestrators only (filtered from the catalog)
//
// Source: GET /models (lib/plan_tiers.TIER_MATRIX SSOT). One list, `kind`
// distinguishes models from orchestrators. Locked (unavailable-on-tier) rows
// are shown with a lock so users see what an upgrade unlocks.

import type { AppContext } from "../core/context.js";
import type { CatalogResponse } from "../types.js";
import { MODELS_PATH } from "../core/transport.js";
import { saveConfig } from "../core/config.js";

export async function cmdModels(ctx: AppContext, argv: string[]): Promise<number> {
  const sub = argv[0];
  if (sub === "use") {
    const id = argv[1];
    if (!id) {
      process.stderr.write("usage: aether models use <id>\n");
      return 2;
    }
    ctx.cfg.defaultModel = id;
    saveConfig(ctx.cfg);
    process.stdout.write(`default model → ${id}\n`);
    return 0;
  }

  const cat = await ctx.api.getJson<CatalogResponse>(MODELS_PATH);
  if (ctx.flags.json) {
    process.stdout.write(JSON.stringify(cat, null, 2) + "\n");
    return 0;
  }
  const activeDefault = ctx.cfg.defaultModel || cat.default;
  process.stdout.write(`tier: ${cat.tier}   default: ${cat.default}\n`);
  for (const m of cat.models) {
    process.stdout.write(renderRow(m, activeDefault));
  }
  return 0;
}

export async function cmdAgents(ctx: AppContext): Promise<number> {
  const cat = await ctx.api.getJson<CatalogResponse>(MODELS_PATH);
  const orchestrators = cat.models.filter((m) => m.kind === "orchestrator");
  if (ctx.flags.json) {
    process.stdout.write(JSON.stringify(orchestrators, null, 2) + "\n");
    return 0;
  }
  for (const a of orchestrators) {
    process.stdout.write(renderRow(a, ctx.cfg.defaultModel || cat.default));
  }
  return 0;
}

function renderRow(m: CatalogResponse["models"][number], activeDefault: string): string {
  const mark = m.id === activeDefault ? "*" : m.available ? " " : "🔒";
  const kind = m.kind === "orchestrator" ? "orch " : "model";
  const cap = m.monthly_uvt_cap != null ? `  cap ${m.monthly_uvt_cap}` : "";
  return `${mark} ${m.id}\t${kind}\t${m.tier_min ?? "-"}\t${m.label}${cap}\n`;
}
