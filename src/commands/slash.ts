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
import { isApiToken } from "./auth.js";
import { theme } from "../ui/theme.js";

export interface SlashResult {
  exit: boolean;
  /** Set when the user confirmed a model/agent switch: the REPL must restart
   * the brain + clear context with the new selection. */
  restart?: { model?: string; agent?: string };
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

/** Warm the catalog cache in the background. Fail-soft: a rejected fetch is
 * swallowed so the prompt is never blocked and the user sees no error. */
export async function primeCatalog(ctx: AppContext): Promise<void> {
  try {
    await getCatalog(ctx, true);
  } catch {
    /* offline / token not ready — /models will retry lazily */
  }
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
    case "model": {
      const r = await select(ctx, out, arg, "model");
      if (r) return { exit: false, restart: r };
      break;
    }
    case "agent": {
      const r = await select(ctx, out, arg, "orchestrator");
      if (r) return { exit: false, restart: r };
      break;
    }
    case "tier":
      await showTier(ctx, out);
      break;
    case "audit":
      await showAudit(ctx, out, arg);
      break;
    case "doctor":
      await doctor(ctx, out);
      break;
    case "mcp": {
      if (!process.stdin.isTTY) {
        out.write("MCP manager needs an interactive terminal — run `aether mcp`.\n");
        break;
      }
      const { mcpFromRepl } = await import("./mcp.js");
      await mcpFromRepl(ctx);
      break;
    }
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
      "/doctor            diagnose your setup",
      "/mcp               manage MCP servers (connect, add, repair)",
      "/clear             clear screen",
      "/exit              leave",
      "",
    ].join("\n"),
  );
}

async function doctor(ctx: AppContext, out: Writable): Promise<void> {
  out.write("Aether Agent · doctor\n");
  out.write(`  api:    ${ctx.cfg.baseUrl}\n`);
  const t = await ctx.tokens.get();
  if (!t) {
    out.write("  auth:   ✗ not logged in — run: aether auth login\n");
  } else {
    out.write(`  auth:   ✓ ${isApiToken(t) ? "API token" : "session token"}\n`);
  }
  try {
    const cat = await getCatalog(ctx);
    out.write(`  server: ✓ reachable (tier ${cat.tier})\n`);
  } catch {
    out.write("  server: ✗ unreachable or token rejected\n");
  }
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

async function select(
  ctx: AppContext,
  out: Writable,
  arg: string,
  kind: Kind,
): Promise<{ model?: string; agent?: string } | null> {
  if (!arg) {
    out.write(`usage: /${kind === "model" ? "model" : "agent"} <n|id>\n`);
    return null;
  }
  const cat = await getCatalog(ctx);
  const item = resolveSelection(byKind(cat, kind), arg);
  if (!item) {
    out.write(`no such ${kind}: ${arg}\n`);
    return null;
  }
  if (!item.available) {
    out.write(`${item.id} is locked on tier ${cat.tier}\n`);
    return null;
  }
  out.write(
    theme.dim(
      `⚠ Switching ${kind === "model" ? "model" : "orchestrator"} to ${item.label} will ` +
        `restart the session and clear context.\n`,
    ),
  );
  const ok = ctx.flags.yes || (await ctx.confirm("Continue? [y/N] "));
  if (!ok) {
    out.write("kept current session.\n");
    return null;
  }
  return kind === "model" ? { model: item.id } : { agent: item.id };
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
