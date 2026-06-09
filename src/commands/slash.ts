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
import { AGENTS_PATH } from "../core/transport.js";
import { fetchTrail } from "../core/audit.js";
import { isApiToken } from "./auth.js";
import { getVaultSnapshot, searchNotes, notesByTag, getNotesTree } from "../core/vault.js";
import { WORKFLOW_TEMPLATES, listWorkflows } from "../core/workflow.js";
import { theme } from "../ui/theme.js";
import { handleGoal, handleGoals, goalHelp } from "./goals.js";
import { box, titledBox } from "../ui/box.js";
import { pickModel } from "../ui/model_picker.js";

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
      await showPicker(ctx, out, "model");
      break;
    case "model": {
      if (!arg) {
        const r = await showPicker(ctx, out, "model");
        if (r) return { exit: false, restart: r };
        break;
      }
      const r = await select(ctx, out, arg, "model");
      if (r) return { exit: false, restart: r };
      break;
    }
    case "agent": {
      if (!arg) {
        const r = await showPicker(ctx, out, "orchestrator");
        if (r) return { exit: false, restart: r };
        break;
      }
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
    case "agents": {
      await agentsSlash(ctx, out);
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
    case "self-review":
    case "recon":
    case "plan":
    case "writing-skills":
    case "autonomous-execution":
    case "research":
    case "review":
    case "code-review":
      out.write(`/${cmd} is handled directly in the interactive REPL.\n`);
      break;
    default:
      out.write(`unknown command: /${cmd}  (try /help)\n`);
  }
  return { exit: false };
}

function printHelp(out: Writable): void {
  const BOX = 62;

  const sections = [
    [
      "",
      theme.iceBlue("☁") + "  " + theme.bold("Session"),
      "",
      theme.dim("/models") + "            list chat models",
      theme.dim("/model") + " <n|id>      switch model  " + theme.dim("/agent") + "    list orchestrators",
      theme.dim("/agent") + " <n|id>      switch orchestrator  " + theme.dim("/tier") + "      plan tier + default",
      theme.dim("/audit") + " [n]         recent Aether audit trail",
      theme.dim("/doctor") + "            diagnose your setup",
      theme.dim("/clear") + "             clear screen  " + theme.dim("/exit") + "          leave",
      theme.dim("/agents") + "            view active agent sessions",
      "",
    ],
    [
      "",
      theme.iceBlue("⚡") + "  " + theme.bold("Agent Modes"),
      "",
      theme.dim("/autonomous-execution") + " <task>  execute without asking",
      theme.dim("/subagent-driven-execution") + " <task>  decompose + delegate",
      theme.dim("/self-review") + "           review your own recent work",
      theme.dim("/recon") + " <topic>          deep reconnaissance",
      theme.dim("/plan") + " <topic>           write implementation plan",
      theme.dim("/research") + " <topic>        research-gather-summarize",
      theme.dim("/review") + "               full project review + summary",
      theme.dim("/code-review") + "           sweep: clean up + simplify",
      theme.dim("/writing-skills") + "        author reusable skills",
      theme.dim("/writing-plans") + " <topic>    write plan to .hermes/plans/",
      "",
    ],
    [
      "",
      theme.iceBlue("🎯") + "  " + theme.bold("Steering"),
      "",
      theme.dim("/queue") + " <task>          queue a task (runs when current finishes)",
      theme.dim("/steer") + " <guidance>      mid-task steering for next turn",
      theme.dim("/btw") + " <note>            contextual side note (accumulates)",
      "",
    ],
    [
      "",
      theme.iceBlue("🎯") + "  " + theme.bold("Goals & Workflows"),
      "",
      theme.dim("/goal") + " <desc>          create goal (agent plans phases)",
      theme.dim("/goals") + "            list saved goals  " + theme.dim("/goals") + " <id>  view goal",
      theme.dim("/goal view") + " [id]        show chain + detail",
      theme.dim("/goal start|pause|resume|cancel|complete|note") + "",
      theme.dim("/workflow") + "             workflow status",
      theme.dim("/workflow-templates") + "   list templates",
      theme.dim("/workflow-template") + " <n> load template",
      "",
    ],
    [
      "",
      theme.iceBlue("📁") + "  " + theme.bold("Vault"),
      "",
      theme.dim("/vault") + "                vault status  " + theme.dim("/vault-context") + "    load into session",
      theme.dim("/vault-search") + " <q>     search notes  " + theme.dim("/vault-recent") + " [n] recent",
      theme.dim("/vault-project") + " <name> project notes  " + theme.dim("/vault-tag") + " <tag> tagged",
      theme.dim("/vault-tree") + "           folder tree",
      "",
    ],
    [
      "",
      theme.iceBlue("🤖") + "  " + theme.bold("Agents"),
      "",
      theme.dim("/agents") + "            view all active agent sessions (name, time, UVT)",
      "",
    ],
  ];

  for (const sec of sections) {
    out.write(box(sec, { width: BOX }) + "\n\n");
  }
  out.write("  " + theme.dim("All /commands work in the interactive REPL (aether).") + "\n");
  out.write("  " + theme.dim("/agent <n|id> triggers model picker: select, confirm, restart.") + "\n\n");
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

/** Launch interactive picker, then show the standard warning + confirm. */
async function showPicker(
  ctx: AppContext,
  out: Writable,
  kind: Kind,
): Promise<{ model?: string; agent?: string } | null> {
  const cat = await getCatalog(ctx);
  const items = byKind(cat, kind);

  const picked = await pickModel(items, out);
  if (!picked) {
    // pickModel returned null — either cancelled (Esc) or non-TTY fallback.
    // If non-TTY, render a flat numbered list so the user can still /model <n>.
    if (!process.stdin.isTTY) {
      const current =
        kind === "model"
          ? ctx.flags.model ?? ctx.cfg.defaultModel ?? cat.default
          : ctx.flags.agent;
      out.write(`tier: ${cat.tier}\n`);
      items.forEach((m, i) => {
        const mark = m.id === current ? "\u203A" : m.available ? " " : "\uD83D\uDD12";
        const cap = m.monthly_uvt_cap != null ? `  cap ${m.monthly_uvt_cap}` : "";
        out.write(`${mark} ${String(i + 1).padStart(2)}. ${m.id}\t${m.label}${cap}\n`);
      });
      out.write(kind === "model" ? "switch: /model <n|id>\n" : "switch: /agent <n|id>\n");
    } else {
      out.write("kept current session.\n");
    }
    return null;
  }

  if (!picked.available) {
    out.write(`${picked.id} is locked on tier ${cat.tier}\n`);
    return null;
  }

  // Show warning + confirm (same as existing select() logic)
  out.write(
    theme.dim(
      `\u26A0 Switching ${kind === "model" ? "model" : "orchestrator"} to ${picked.label} will ` +
        `restart the session and clear context.\n`,
    ),
  );
  const ok = ctx.flags.yes || (await ctx.confirm("Continue? [y/N] "));
  if (!ok) {
    out.write("kept current session.\n");
    return null;
  }
  return kind === "model" ? { model: picked.id } : { agent: picked.id };
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

// ── Agents slash handler ────────────────────────

async function agentsSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    const resp = await ctx.api.getJson<{ agents?: Array<{
      name?: string; status?: string; working_time?: string;
      uvt_streamed?: number; task?: string;
    }> }>(AGENTS_PATH);
    const agents = resp.agents ?? [];
    if (agents.length === 0) {
      out.write("(no active agents)\n");
      return;
    }
    // Columns: name, status, working time, UVT streamed, task
    const nameW = Math.max(20, ...agents.map(a => (a.name ?? "?").length));
    const statusW = 12;
    const timeW = 14;
    const uvtW = 12;

    // Header
    const header = "  " +
      "name".padEnd(nameW) + "  " +
      "status".padEnd(statusW) + "  " +
      "time".padEnd(timeW) + "  " +
      "UVT".padEnd(uvtW) + "  " +
      "task";
    out.write(theme.bold(header) + "\n");
    out.write(theme.dim("  " + "─".repeat(nameW + statusW + timeW + uvtW + 30)) + "\n");

    for (const a of agents) {
      const name = (a.name ?? "?").padEnd(nameW);
      const status = (a.status ?? "?").padEnd(statusW);
      const time = (a.working_time ?? "—").padEnd(timeW);
      const uvt = a.uvt_streamed != null
        ? String(a.uvt_streamed).padEnd(uvtW)
        : "—".padEnd(uvtW);
      const task = (a.task ?? "").slice(0, 50);

      const statusColor = a.status === "running" ? theme.cyan :
        a.status === "complete" ? theme.dim : theme.muted;

      out.write(`  ${theme.bold(name)}${statusColor(status)}${theme.dim(time)}${theme.dim(uvt)}${task}\n`);
    }
  } catch {
    out.write("agents: unreachable (are you logged in? aether auth login)\n");
  }
}
