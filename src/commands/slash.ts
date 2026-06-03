// In-REPL slash commands (Claude-Code style). The interactive `aether` session
// routes any line starting with "/" here. Models + orchestrators come from the
// shared GET /models catalog, so the terminal switches models exactly like the
// desktop picker and web do.
//
//   /help                 list commands
//   /models               list chat models (numbered)
//   /model <n|id>         switch model
//   /agents               list orchestrators (Neo/Kronus)
//   /agent <n|id>         switch orchestrator
//   /tier                 show plan tier + default
//   /audit [n]            recent Aether audit trail
//   /clear                clear the screen
//   /exit | /quit         leave the REPL

import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import type { CatalogItem, CatalogResponse } from "../types.js";
import { MODELS_PATH } from "../core/transport.js";
import { fetchTrail } from "../core/audit.js";

export interface SlashResult {
  exit: boolean;
}

type Kind = "model" | "orchestrator";

// Catalog is cached per REPL session; a fresh session re-fetches.
let _catalog: CatalogResponse | null = null;

/** Resolve a selection arg (1-based index OR id) against a list. Pure. */
export function resolveSelection(items: CatalogItem[], arg: string): CatalogItem | null {
  const a = arg.trim();
  if (!a) return null;
  const n = Number(a);
  if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1] ?? null;
  return items.find((i) => i.id === a) ?? null;
}

async function getCatalog(ctx: AppContext, force = false): Promise<CatalogResponse> {
  if (!_catalog || force) {
    _catalog = await ctx.api.getJson<CatalogResponse>(MODELS_PATH);
  }
  return _catalog;
}

function byKind(cat: CatalogResponse, kind: Kind): CatalogItem[] {
  return cat.models.filter((m) => m.kind === kind);
}

export async function handleSlash(
  ctx: AppContext,
  line: string,
  out: Writable,
): Promise<SlashResult> {
  const parts = line.slice(1).trim().split(/\s+/);
  const cmd = (parts[0] ?? "").toLowerCase();
  const arg = parts.slice(1).join(" ");

  switch (cmd) {
    case "exit":
    case "quit":
      return { exit: true };
    case "help":
    case "":
      printHelp(out);
      break;
    case "models":
      await showList(ctx, out, "model");
      break;
    case "agents":
      await showList(ctx, out, "orchestrator");
      break;
    case "model":
      await select(ctx, out, arg, "model");
      break;
    case "agent":
      await select(ctx, out, arg, "orchestrator");
      break;
    case "tier":
      await showTier(ctx, out);
      break;
    case "audit":
      await showAudit(ctx, out, arg);
      break;
    case "clear":
      out.write("\x1b[2J\x1b[H");
      break;
    default:
      out.write(`unknown command: /${cmd}  (try /help)\n`);
  }
  return { exit: false };
}

function printHelp(out: Writable): void {
  out.write(
    [
      "/models            list chat models",
      "/model <n|id>      switch model",
      "/agents            list orchestrators (Neo/Kronus)",
      "/agent <n|id>      switch orchestrator",
      "/tier              plan tier + default",
      "/audit [n]         recent Aether audit trail",
      "/clear             clear screen",
      "/exit              leave",
      "",
    ].join("\n"),
  );
}

async function showList(ctx: AppContext, out: Writable, kind: Kind): Promise<void> {
  const cat = await getCatalog(ctx);
  const items = byKind(cat, kind);
  const current =
    kind === "model" ? ctx.flags.model ?? ctx.cfg.defaultModel ?? cat.default : ctx.flags.agent;
  out.write(`tier: ${cat.tier}\n`);
  items.forEach((m, i) => {
    const mark = m.id === current ? "›" : m.available ? " " : "🔒";
    const cap = m.monthly_uvt_cap != null ? `  cap ${m.monthly_uvt_cap}` : "";
    out.write(`${mark} ${String(i + 1).padStart(2)}. ${m.id}\t${m.label}${cap}\n`);
  });
  out.write(kind === "model" ? "switch: /model <n|id>\n" : "switch: /agent <n|id>\n");
}

async function select(ctx: AppContext, out: Writable, arg: string, kind: Kind): Promise<void> {
  if (!arg) {
    out.write(`usage: /${kind === "model" ? "model" : "agent"} <n|id>\n`);
    return;
  }
  const cat = await getCatalog(ctx);
  const item = resolveSelection(byKind(cat, kind), arg);
  if (!item) {
    out.write(`no such ${kind}: ${arg}\n`);
    return;
  }
  if (!item.available) {
    out.write(`${item.id} is locked on tier ${cat.tier}\n`);
    return;
  }
  if (kind === "orchestrator") {
    ctx.flags.agent = item.id;
    ctx.flags.model = undefined;
    out.write(`agent → ${item.label}\n`);
  } else {
    ctx.flags.model = item.id;
    ctx.flags.agent = undefined;
    out.write(`model → ${item.label}\n`);
  }
}

async function showTier(ctx: AppContext, out: Writable): Promise<void> {
  const cat = await getCatalog(ctx);
  const models = byKind(cat, "model").filter((m) => m.available).length;
  const orch = byKind(cat, "orchestrator").filter((m) => m.available).length;
  out.write(
    `tier: ${cat.tier}   default: ${cat.default}   available: ${models} models, ${orch} orchestrators\n`,
  );
}

async function showAudit(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const n = Number(arg);
  const limit = Number.isInteger(n) && n > 0 ? n : 10;
  const entries = await fetchTrail(ctx.api, { limit });
  if (entries.length === 0) {
    out.write("(no audit entries)\n");
    return;
  }
  for (const e of entries) {
    out.write(`${e.timestamp}\t${e.eventType}\t${e.commitmentHash ?? "-"}\t${e.orderId}\n`);
  }
}
