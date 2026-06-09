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
import { getVaultSnapshot, searchNotes, notesByTag, getNotesTree } from "../core/vault.js";
import { WORKFLOW_TEMPLATES, listWorkflows } from "../core/workflow.js";
import { theme } from "../ui/theme.js";
import { handleGoal, handleGoals, goalHelp } from "./goals.js";

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
    case "vault": {
      await vaultStatusSlash(ctx, out);
      break;
    }
    case "vault-context": {
      await vaultContextSlash(ctx, out);
      break;
    }
    case "vault-search": {
      await vaultSearchSlash(ctx, out, arg);
      break;
    }
    case "vault-recent": {
      await vaultRecentSlash(ctx, out, arg);
      break;
    }
    case "vault-project": {
      await vaultProjectSlash(ctx, out, arg);
      break;
    }
    case "vault-tag": {
      await vaultTagSlash(ctx, out, arg);
      break;
    }
    case "vault-tree": {
      await vaultTreeSlash(ctx, out);
      break;
    }
    case "workflow": {
      await workflowSlash(ctx, out);
      break;
    }
    case "workflow-templates": {
      await workflowTemplatesSlash(ctx, out);
      break;
    }
    case "workflow-template": {
      await workflowTemplateSlash(ctx, out, arg);
      break;
    }
    case "goal": {
      const parts = arg.split(/\s+/);
      const subcmd = parts[0] ?? "";
      const rest = parts.slice(1).join(" ");
      await handleGoal(ctx, out, subcmd.toLowerCase(), rest);
      break;
    }
    case "goals": {
      await handleGoals(ctx, out, arg);
      break;
    }
    case "doctor":
      await doctor(ctx, out);
      break;
    case "mcp":
      out.write("MCP servers — coming soon. Aether Agent will manage MCP tools here.\n");
      break;
    case "clear":
      out.write("\x1b[2J\x1b[H");
      break;
    case "queue":
    case "steer":
    case "btw":
    case "writing-plans":
    case "subagent-driven-execution":
      out.write(`/${cmd} is handled directly in the interactive REPL.\n`);
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
      "/vault                vault status",
      "/vault-context        load vault context into session",
      "/vault-search <q>     search vault notes",
      "/vault-recent [n]     recent vault notes",
      "/vault-project <name> list project notes",
      "/vault-tag <tag>      list notes by tag",
      "/vault-tree           vault folder tree",
      "/workflow             workflow status",
      "/workflow-templates   list workflow templates",
      "/workflow-template <n> load template by number",
      "/goal <desc>      create a new goal (agent plans phases)",
      "/goals            list saved goals",
      "/doctor            diagnose your setup",
      "/mcp               MCP servers (coming soon)",
      "/queue <task>          queue a task (runs after current one completes)",
      "/steer <guidance>      set mid-task steering for the next turn",
      "/btw <note>            add a contextual side note for the next turn",
      "/writing-plans <topic> invoke agent to write an implementation plan",
      "/subagent-driven-execution <task>  decompose + delegate via subagents",
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

// ── Vault slash handlers ────────────────────────

async function vaultStatusSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    const r = await getVaultSnapshot(ctx.api, 800);
    out.write(`vault: ${r.note_count} notes\n`);
  } catch {
    out.write("vault: unreachable\n");
  }
}

async function vaultContextSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    await getVaultSnapshot(ctx.api, 2000);
    out.write("vault context loaded for next agent turn.\n");
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function vaultSearchSlash(ctx: AppContext, out: Writable, query: string): Promise<void> {
  if (!query) { out.write("usage: /vault-search <query>\n"); return; }
  try {
    const r = await searchNotes(ctx.api, query, { limit: 10 });
    if (r.results.length === 0) { out.write("no results.\n"); return; }
    for (const n of r.results) {
      out.write(`  ${n.title || n.path}  (${n.path})\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function vaultRecentSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  try {
    const n = Math.min(parseInt(arg) || 10, 50);
    const r = await searchNotes(ctx.api, "", { limit: n });
    if (r.results.length === 0) { out.write("(empty vault)\n"); return; }
    for (const row of r.results) {
      out.write(`  ${row.title || row.path}\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function vaultProjectSlash(ctx: AppContext, out: Writable, name: string): Promise<void> {
  if (!name) { out.write("usage: /vault-project <name>\n"); return; }
  try {
    const r = await searchNotes(ctx.api, "", { project: name, limit: 20 });
    if (r.results.length === 0) { out.write(`no notes for project: ${name}\n`); return; }
    for (const n of r.results) {
      out.write(`  ${n.title || n.path}  [${n.tags.join(", ")}]\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function vaultTagSlash(ctx: AppContext, out: Writable, tag: string): Promise<void> {
  if (!tag) { out.write("usage: /vault-tag <tag>\n"); return; }
  try {
    const r = await notesByTag(ctx.api, tag, 20);
    if (r.results.length === 0) { out.write(`no notes with tag: ${tag}\n`); return; }
    for (const n of r.results) {
      out.write(`  ${n.title || n.path}  (${n.path})\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── Workflow slash handlers ─────────────────────

async function workflowSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    const workflows = await listWorkflows(ctx.api);
    out.write(`workflow: ${workflows.length} in vault  ·  ${WORKFLOW_TEMPLATES.length} templates available\n`);
    if (workflows.length > 0) {
      for (const w of workflows.slice(0, 5)) out.write(`  ${w.name}  (${Math.round(w.size/1024)} KB)\n`);
    }
  } catch {
    out.write("workflow: unavailable\n");
  }
}

async function workflowTemplatesSlash(ctx: AppContext, out: Writable): Promise<void> {
  for (let i = 0; i < WORKFLOW_TEMPLATES.length; i++) {
    const t = WORKFLOW_TEMPLATES[i]!;
    out.write(`  ${String(i+1)}. ${t.icon} ${t.name}  (${t.category}, ${t.difficulty})\n`);
  }
  out.write("load: /workflow-template <n>\n");
}

async function workflowTemplateSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const n = parseInt(arg);
  if (isNaN(n) || n < 1 || n > WORKFLOW_TEMPLATES.length) {
    out.write(`invalid: ${arg} (1-${WORKFLOW_TEMPLATES.length})\n`);
    return;
  }
  const t = WORKFLOW_TEMPLATES[n - 1]!;
  out.write(`${t.icon} ${t.name}: ${t.subtitle}\n`);
  out.write(`  ${t.workflow.nodes?.length || 0} nodes · ${t.workflow.edges?.length || 0} edges\n`);
  out.write(`  save with: aether workflow save ${t.id}\n`);
}

async function vaultTreeSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    const r = await getNotesTree(ctx.api);
    if (r.tree.length === 0) { out.write("(empty vault)\n"); return; }
    for (const e of r.tree) {
      out.write(`  ${e.folder || "/"}  (${e.count} notes)\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
