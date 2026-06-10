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
import { runLogsViewer } from "../ui/logs_viewer.js";
import { getRegistry, resetRegistry, saveSnapshot, loadSnapshot, listSnapshots, ContextRegistry, syncToBackend, loadFromBackend } from "../core/context_registry.js";
import { readCustodyLog } from "../core/custody.js";
import type { AuditEntry } from "../core/audit.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { delegateWorker, getOrchTree, broadcastToAgents, gatherResults, requireOrchestrator } from "../core/orchestrator.js";
import {
  filterMediaModels, resolveModelKey, autoRouteModel,
  buildMediaPrompt, dispatchGeneration, downloadMediaFile,
  ensureOutputDir, recordOutput, listOutput, findOutput, openOutput, clearOutput,
  ASPECT_RATIOS, IMAGE_SHORTCUTS, VIDEO_SHORTCUTS,
  parseStoryboard, saveStoryboard, loadStoryboard, listStoryboards,
  type MediaKind, type GenFlags, type GenResult,
} from "../core/vision.js";
import { basename } from "node:path";
import { existsSync as fsExistsSync } from "node:fs";

export interface SlashResult {
  exit: boolean;
  /** Set when the user confirmed a model/agent switch: the REPL must restart
   * the brain + clear context with the new selection. */
  restart?: { model?: string; agent?: string };
}

type Kind = "model" | "orchestrator";

// Media pipeline state — persists across turns in the same REPL session.
// Cleared on REPL restart. Used by /re-frame and /re-cut.
let _lastMediaUrl: string | null = null;
let _lastMediaModel: string | null = null;
let _lastMediaPrompt: string | null = null;
let _lastMediaKind: MediaKind | null = null;

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
    case "delegate": {
      await delegateSlash(ctx, out, arg);
      break;
    }
    case "tree": {
      await treeSlash(ctx, out);
      break;
    }
    case "broadcast": {
      await broadcastSlash(ctx, out, arg);
      break;
    }
    case "gather": {
      await gatherSlash(ctx, out, arg);
      break;
    }
    case "photogen":
    case "frame": {
      await photogenSlash(ctx, out, arg, cmd === "frame");
      break;
    }
    case "re-frame": {
      await reframeSlash(ctx, out, arg);
      break;
    }
    case "videogen":
    case "sequence": {
      await videogenSlash(ctx, out, arg, cmd === "sequence");
      break;
    }
    case "animate": {
      await animateSlash(ctx, out, arg);
      break;
    }
    case "re-cut": {
      await recutSlash(ctx, out, arg);
      break;
    }
    case "output": {
      await outputSlash(ctx, out, arg);
      break;
    }
    case "storyboard": {
      await storyboardSlash(ctx, out, arg);
      break;
    }
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
    case "pin":
      await pinSlash(ctx, out, arg, line);
      break;
    case "drop":
      await dropSlash(ctx, out, arg);
      break;
    case "snapshot":
      await snapshotSlash(ctx, out, arg);
      break;
    case "limit":
      await limitSlash(ctx, out, arg);
      break;
    case "audit-receipt":
      await auditReceiptSlash(ctx, out, arg);
      break;
    case "rollback":
      await rollbackSlash(ctx, out, arg);
      break;
    case "logs-view":
    case "logs": {
      out.write("\x1b[?25l"); // Hide cursor
      await runLogsViewer(out);
      break;
    }
    default:
      out.write(`unknown command: /${cmd}  (try /help)\n`);
  }
  return { exit: false };
}

// ── /pin ──────────────────────────────────────

async function pinSlash(ctx: AppContext, out: Writable, arg: string, _line: string): Promise<void> {
  if (!arg.trim() || arg.trim() === "list" || arg.trim() === "ls") {
    const pins = getRegistry().pins;
    if (pins.length === 0) {
      out.write("(no pinned files — use /pin <path> [reason] to pin one)\n");
      return;
    }
    out.write(theme.cyan("📌  Pinned Context\n"));
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
    for (const p of pins) {
      out.write(`  ${theme.bold(p.label)}  ${theme.dim(p.path)}  ${theme.muted(p.reason)}\n`);
    }
    return;
  }

  const parts = arg.trim().split(/\s+/);
  const pth = parts[0]!;
  const reason = parts.slice(1).join(" ") || "pinned";

  const resolved = pth.startsWith("/") ? pth : join(process.cwd(), pth);
  const label = pth.split("/").pop() || pth;

  const entry = getRegistry().pin(resolved, label, reason);
  out.write(`${theme.cyan("📌 pinned")} ${theme.bold(entry.label)}  ${theme.dim(entry.path)}  (${entry.reason})\n`);
  out.write(theme.dim("  This file will persist in context across /recon and /autonomous-execution loops.\n"));
  syncAfter(ctx);
}

// ── /drop ─────────────────────────────────────

async function dropSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!arg.trim()) {
    const registry = getRegistry();
    out.write("usage: /drop <path>    evict a file from memory context\n");
    out.write("  /drop src/core/old.ts\n");
    if (registry.pins.length > 0) {
      out.write("\n  Pinned files (use /pin list for details):\n");
      for (const p of registry.pins) {
        out.write(`    ${theme.dim(p.label)}\n`);
      }
    }
    if (registry.drops.length > 0) {
      out.write("\n  Recently dropped:\n");
      for (const d of registry.drops.slice(-5)) {
        out.write(`    ${theme.dim(d)}\n`);
      }
    }
    return;
  }

  const pth = arg.trim();
  const resolved = pth.startsWith("/") ? pth : join(process.cwd(), pth);
  const wasPinned = getRegistry().isPinned(resolved);
  getRegistry().drop(resolved);

  if (wasPinned) {
    out.write(`${theme.cyan("🗑  dropped")} ${theme.bold(pth)} — removed from pinned context\n`);
  } else {
    out.write(`${theme.cyan("🗑  evicted")} ${theme.dim(pth)}\n`);
    out.write(theme.dim("  (wasn't pinned, but will be excluded from future context loads)\n"));
  }
  syncAfter(ctx);
}

// ── /snapshot ─────────────────────────────────

async function snapshotSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const registry = getRegistry();
  const sub = arg.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

  if (sub === "resume" || sub === "load") {
    const id = arg.trim().split(/\s+/).slice(1).join(" ");
    if (!id) {
      // Try cloud backend first
      const cloudLoaded = await loadFromBackend(ctx.api);
      if (cloudLoaded) {
        const reg = getRegistry();
        out.write(`${theme.cyan("☁ loaded from cloud")} ${theme.bold(reg.sessionLabel)}  (${reg.pins.length} pins, cap ${reg.uvtCap ?? "none"})\n`);
        out.write(theme.dim("  Use /pin list to see restored context.\n"));
        return;
      }
      const snaps = listSnapshots();
      if (snaps.length === 0) {
        out.write("(no snapshots — use /snapshot to save one)\n");
        return;
      }
      out.write(theme.cyan("💾  Saved Snapshots\n"));
      out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
      for (const s of snaps) {
        const pinCnt = s.data.pins.length;
        const cap = s.data.uvtCap ? `  cap ${s.data.uvtCap} UVT` : "";
        out.write(`  ${theme.bold(s.id)}  ${theme.dim(s.data.createdAt)}  ${s.data.sessionLabel}  (${pinCnt} pins${cap})\n`);
      }
      out.write(theme.dim("\n  /snapshot resume <filename>   to restore a snapshot\n"));
      return;
    }
    const data = loadSnapshot(id);
    if (!data) {
      out.write(`no snapshot: ${id}  (use /snapshot to list)\n`);
      return;
    }
    const restored = ContextRegistry.fromSnapshot(data);
    resetRegistry();
    Object.assign(getRegistry(), restored);
    out.write(`${theme.cyan("📂 restored")} ${theme.bold(data.sessionLabel)}  (${data.pins.length} pins, cap ${data.uvtCap ?? "none"})\n`);
    out.write(`  cwd: ${data.cwd}\n`);
    out.write(theme.dim("  Use /pin list to see restored context.\n"));
    return;
  }

  if (sub === "list" || sub === "ls") {
    const snaps = listSnapshots();
    if (snaps.length === 0) {
      out.write("(no snapshots)\n");
      return;
    }
    out.write(theme.cyan("💾  Snapshots\n"));
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
    for (const s of snaps) {
      const pinCnt = s.data.pins.length;
      out.write(`  ${theme.bold(s.data.sessionLabel)}  ${theme.dim(s.data.createdAt)}  (${pinCnt} pins)\n`);
    }
    return;
  }

  const snapPath = saveSnapshot(registry);
  const basename = snapPath.split("/").pop() || snapPath;
  out.write(`${theme.cyan("💾 snapshot saved")}  ${theme.bold(basename)}\n`);
  out.write(`  ${theme.dim(snapPath)}\n`);
  out.write(`  pins: ${registry.pins.length}   UVT cap: ${registry.uvtCap ?? "none"}   drops: ${registry.drops.length}\n`);
  out.write(theme.dim("  Resume with: /snapshot resume <filename>\n"));
  syncAfter(ctx);
}

// ── /limit ────────────────────────────────────

/** Fire-and-forget backend sync. Never blocks the REPL. */
function syncAfter(ctx: AppContext): void {
  void syncToBackend(ctx.api).catch(() => {});
}

function renderUvtBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const color = pct > 80 ? theme.muted : pct > 50 ? theme.dim : theme.cyan;
  return color("[" + "█".repeat(filled) + "░".repeat(empty) + "]");
}

async function limitSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const registry = getRegistry();

  if (!arg.trim()) {
    const current = registry.uvtCap;
    const spent = registry.uvtSpent;
    if (current == null) {
      out.write("UVT cap: none (uncapped)\n");
    } else {
      const remaining = Math.max(0, current - spent);
      const pct = current > 0 ? Math.round((spent / current) * 100) : 0;
      const bar = renderUvtBar(pct, 20);
      out.write(`UVT cap: ${theme.bold(String(current))}   spent: ${spent}   remaining: ${remaining}  ${bar}\n`);
    }
    out.write(theme.dim("  /limit <amount>    set cap (e.g., /limit 50000)\n"));
    out.write(theme.dim("  /limit off         remove cap\n"));
    return;
  }

  if (arg.trim().toLowerCase() === "off" || arg.trim().toLowerCase() === "none") {
    registry.uvtCap = null;
    out.write(theme.cyan("UVT cap removed — session is uncapped.\n"));
    return;
  }

  const n = Number(arg.trim());
  if (!Number.isFinite(n) || n <= 0) {
    out.write(`invalid: ${arg} — use a positive number (e.g., /limit 50000)\n`);
    return;
  }

  registry.setUvtCap(Math.floor(n));
  out.write(`${theme.cyan("⚡ UVT cap set")}  ${theme.bold(String(Math.floor(n)))}  — agent will pause and ask permission if ceiling hit\n`);
  syncAfter(ctx);
}

// ── /audit-receipt ────────────────────────────

function hashShortCustody(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 12);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const inner = o["hash"] ?? o["env_hash"] ?? o["commitment_hash"] ?? o["digest"];
    if (inner != null) return String(inner).slice(0, 12);
  }
  return "\u2713";
}

async function auditReceiptSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const nArg = Number(arg);
  const limit = Number.isInteger(nArg) && nArg > 0 ? Math.min(nArg, 100) : 20;

  const custody = readCustodyLog(limit);
  let serverEntries: AuditEntry[] = [];
  try {
    serverEntries = await fetchTrail(ctx.api, { limit });
  } catch {
    /* offline — local custody is enough */
  }

  out.write(theme.cyan("🧾  Audit Receipt\n"));
  out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));

  const H_TIME = 26;
  const H_ORDER = 14;
  const H_EVENT = 14;
  const H_COMMIT = 14;
  const H_PATH = 20;

  const header =
    "time".padEnd(H_TIME) +
    "order_id".padEnd(H_ORDER) +
    "event".padEnd(H_EVENT) +
    "commitment".padEnd(H_COMMIT) +
    "path";
  out.write(theme.bold("  " + header) + "\n");
  out.write(theme.dim("  " + "─".repeat(H_TIME + H_ORDER + H_EVENT + H_COMMIT + H_PATH)) + "\n");

  for (const c of custody) {
    const ts = c.received_at != null ? new Date(c.received_at).toISOString().padEnd(H_TIME) : "—".padEnd(H_TIME);
    const oid = (String(c.order_id ?? "—")).slice(0, H_ORDER - 1).padEnd(H_ORDER);
    const evt = "chat_turn".padEnd(H_EVENT);
    const comm = (hashShortCustody(c.commitment) ?? "—").slice(0, H_COMMIT - 1).padEnd(H_COMMIT);
    const pathCol = String(c.path ?? "—").slice(0, H_PATH - 1).padEnd(H_PATH);
    out.write(`  ${theme.dim(ts)}${oid}${theme.cyan(evt)}${theme.dim(comm)}${pathCol}\n`);
  }

  for (const e of serverEntries) {
    const ts = String(e.timestamp).padEnd(H_TIME);
    const oid = e.orderId.slice(0, H_ORDER - 1).padEnd(H_ORDER);
    const evt = e.eventType.padEnd(H_EVENT);
    const comm = (e.commitmentHash ?? "—").slice(0, H_COMMIT - 1).padEnd(H_COMMIT);
    const pathCol = (e.path ?? "—").slice(0, H_PATH - 1).padEnd(H_PATH);
    out.write(`  ${theme.dim(ts)}${theme.dim(oid)}${theme.muted(evt)}${theme.dim(comm)}${pathCol}\n`);
  }

  const totalEntries = custody.length + serverEntries.length;
  const uvtTotal = getRegistry().uvtSpent;
  const boxContent = [
    "",
    `  Total entries: ${totalEntries}`,
    `  UVT spent:     ${uvtTotal}`,
    `  UVT cap:       ${getRegistry().uvtCap ?? "none"}`,
    "",
    "  Export proof:  aether receipt <order_id>",
    "  Full log:      /logs-view",
    "",
  ];
  out.write("\n" + box(boxContent, { width: 60 }) + "\n");
}

// ── /rollback ─────────────────────────────────

async function rollbackSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const n = parseInt(arg.trim()) || 1;
  if (n < 1 || n > 50) {
    out.write("usage: /rollback [n]    revert last n filesystem changes (1-50, default 1)\n");
    return;
  }

  const cwd = process.cwd();
  const gitDir = join(cwd, ".git");
  if (!existsSync(gitDir)) {
    out.write(theme.muted("Not in a git repository. /rollback requires git for safe undo.\n"));
    return;
  }

  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  try {
    const status = execSync("git diff --name-only", { cwd, encoding: "utf8", timeout: 5000 });
    const dirty = status.trim().split("\n").filter(Boolean);
    if (dirty.length === 0) {
      out.write("(working tree clean — nothing to rollback)\n");
      return;
    }

    out.write(`${theme.cyan("\u21A9  Ready to rollback")}  ${dirty.length} files changed\n`);
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
    const show = dirty.slice(0, 20);
    for (const f of show) {
      out.write(`  ${theme.muted(f)}\n`);
    }
    if (dirty.length > 20) {
      out.write(`  ${theme.dim(`... and ${dirty.length - 20} more`)}\n`);
    }

    const ok = ctx.flags.yes || (await ctx.confirm(`\nRevert all ${dirty.length} uncommitted changes? [y/N] `));
    if (!ok) {
      out.write("cancelled.\n");
      return;
    }

    execSync("git checkout -- .", { cwd, encoding: "utf8", timeout: 10000 });
    out.write(`${theme.cyan("\u21A9 rolled back")}  ${dirty.length} files restored to last commit.\n`);
    out.write(theme.dim("  Git reflog untouched — all commits preserved.\n"));
  } catch (err) {
    out.write(`\u2717 ${err instanceof Error ? err.message : String(err)}\n`);
  }
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
      theme.dim("/audit") + " [n]         recent audit trail  " + theme.dim("/audit-receipt") + "  full receipt",
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
      theme.iceBlue("🧠") + "  " + theme.bold("Context & Limits"),
      "",
      theme.dim("/pin") + " <path> [reason]    force file into persistent context",
      theme.dim("/pin list") + "                list pinned files",
      theme.dim("/drop") + " <path>              evict file from context",
      theme.dim("/snapshot") + "               save session state to disk",
      theme.dim("/snapshot resume") + " <id>     reload a saved snapshot",
      theme.dim("/limit") + " <uvt>              cap UVT spend for this session",
      theme.dim("/audit-receipt") + " [n]       verified log of tool calls + UVT",
      theme.dim("/rollback") + " [n]            revert last n filesystem changes",
      theme.dim("/logs-view") + "              interactive session log browser",
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
    [
      "",
      theme.iceBlue("🎻") + "  " + theme.bold("Orchestra"),
      "",
      theme.dim("/delegate") + " <model> <task>  delegate sub-task to a worker model",
      theme.dim("/tree") + "                   live orchestration hierarchy",
      theme.dim("/broadcast") + ' "<msg>"      inject directive to all sub-agents',
      theme.dim("/gather") + " <id|all>        merge completed work to staging",
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

// ── Orchestrator slash handlers ─────────────────

async function delegateSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!requireOrchestrator(ctx, out)) return;
  const parts = arg.split(/\s+/);
  const model = parts[0];
  const task = parts.slice(1).join(" ");
  if (!model || !task) {
    out.write("usage: /delegate <model> <task>\n");
    return;
  }
  try {
    const r = await delegateWorker(ctx.api, ctx.flags.agent!, model, task);
    out.write(`delegated → worker ${r.worker_id} (${r.status}) running ${model}\n`);
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function treeSlash(ctx: AppContext, out: Writable): Promise<void> {
  if (!requireOrchestrator(ctx, out)) return;
  try {
    const r = await getOrchTree(ctx.api, ctx.flags.agent!);
    out.write(theme.bold(`orchestrator: ${r.orchestrator}`) + "\n");
    if (r.workers.length === 0) {
      out.write("  (no active sub-agents)\n");
      return;
    }
    // Columns: id, model, step, tokens, UVT
    const idW = Math.max(10, ...r.workers.map(w => w.id.length));
    const modelW = Math.max(10, ...r.workers.map(w => w.model.length));
    const stepW = Math.max(12, ...r.workers.map(w => w.step.length));
    const header = "  " +
      "id".padEnd(idW) + "  " +
      "model".padEnd(modelW) + "  " +
      "step".padEnd(stepW) + "  " +
      "tokens".padEnd(10) + "  " +
      "UVT";
    out.write(theme.dim(header) + "\n");
    out.write(theme.dim("  " + "─".repeat(idW + modelW + stepW + 30)) + "\n");
    for (const w of r.workers) {
      out.write(
        `  ${theme.bold(w.id.padEnd(idW))}  ` +
        `${w.model.padEnd(modelW)}  ` +
        `${w.step.padEnd(stepW)}  ` +
        `${String(w.tokens).padEnd(10)}  ` +
        `${w.uvt}\n`
      );
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function broadcastSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!requireOrchestrator(ctx, out)) return;
  const message = arg.trim();
  if (!message) {
    out.write("usage: /broadcast \"<message>\"\n");
    return;
  }
  try {
    const r = await broadcastToAgents(ctx.api, ctx.flags.agent!, message);
    out.write(`broadcast → delivered to ${r.delivered_to} sub-agents\n`);
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ═════════════════════════════════════════════════════════════════════
// Media pipeline — /photogen /frame /re-frame /videogen /sequence
// /animate /re-cut /output /storyboard handlers
// ═════════════════════════════════════════════════════════════════════

// NOTE: gatherSlash was originally defined above and is preserved.
// It was not removed — only its closing brace block was used as the anchor.

async function gatherSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!requireOrchestrator(ctx, out)) return;
  const workerId = arg.trim();
  if (!workerId) { out.write("usage: /gather <sub_agent_id|all>\n"); return; }
  try {
    const r = await gatherResults(ctx.api, ctx.flags.agent!, workerId);
    if (r.results.length === 0) { out.write("(no results to gather)\n"); return; }
    for (const res of r.results) {
      out.write(`${theme.bold(res.worker_id)}:\n`);
      if (res.files.length) out.write(`  files:  ${res.files.join(", ")}\n`);
      if (res.diffs.length) out.write(`  diffs:  ${res.diffs.length} diff(s)\n`);
      if (res.patches.length) out.write(`  patches: ${res.patches.length} patch(es)\n`);
    }
  } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
}

function parseSlashFlags(raw: string, _kind: MediaKind): { prompt: string; flags: GenFlags } {
  const flags: GenFlags = {};
  const parts = raw.split(/\s+/);
  const promptParts: string[] = [];
  let inFlags = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] ?? "";
    if (!inFlags && p.startsWith("--")) { inFlags = true; }
    if (inFlags) {
      const next = parts[i + 1] ?? "";
      if (p === "--model" && next) { flags.model = next; i++; }
      else if (p === "--aspect" && next) { flags.aspect = next; i++; }
      else if ((p === "--count" || p === "--batch") && next) { flags.count = parseInt(next, 10) || 1; i++; }
      else if (p === "--4k") { flags.fourK = true; }
      else if (p === "--vector") { flags.vector = true; }
      else if ((p === "--duration" || p === "--10s") && next) { flags.duration = parseInt(next, 10) || 10; i++; }
      else if (p === "--1080p") { flags.hd1080 = true; }
      else if (p === "--audio") { flags.audio = true; }
      else if (p === "--save-to-vault") { flags.saveToVault = true; }
      else if (p === "--ref" && next) { flags.ref = next; i++; }
      else if (p === "--open") { flags.open = true; }
    } else {
      promptParts.push(p);
    }
  }
  return { prompt: promptParts.join(" "), flags };
}

const SF = theme.dim;

async function photogenSlash(ctx: AppContext, out: Writable, arg: string, _framed: boolean): Promise<void> {
  const { prompt, flags } = parseSlashFlags(arg, "image");
  if (!prompt) {
    out.write("usage: /photogen <prompt> [--model nano] [--aspect 16_9] [--count 4] [--4k] [--vector]\n");
    out.write("usage: /frame <prompt> --aspect <ratio>\n");
    return;
  }
  const kind: MediaKind = "image";
  const modelKey = flags.model ? resolveModelKey(flags.model) : autoRouteModel(prompt, kind);
  const fullPrompt = buildMediaPrompt(prompt, flags, kind);
  const count = Math.min(10, Math.max(1, flags.count ?? 1));
  const outdir = ensureOutputDir();
  out.write(SF(`generating ${count} image(s) with ${modelKey}: "${prompt}"\n\n`));
  for (let i = 0; i < count; i++) {
    try {
      const vp = count > 1 ? `${fullPrompt} [variant ${i + 1} of ${count}]` : fullPrompt;
      out.write(SF(`[${i + 1}/${count}] `));
      const resp = await dispatchGeneration(ctx.api, vp, modelKey, flags);
      if (resp.media_url) {
        out.write(SF("downloading...\n"));
        const filepath = await downloadMediaFile(ctx.api, resp.media_url, outdir, modelKey, kind, resp.filename);
        const result: GenResult = {
          model: modelKey, prompt: vp, kind, filepath, filename: basename(filepath),
          url: resp.media_url, timestamp: new Date().toISOString(), flags,
        };
        const entry = recordOutput(result);
        out.write(`  ${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n`);
        out.write(`  ${SF(resp.media_url)}\n\n`);
        _lastMediaUrl = resp.media_url; _lastMediaModel = modelKey; _lastMediaPrompt = vp; _lastMediaKind = kind;
      } else {
        out.write(SF("  no media URL returned\n"));
      }
    } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
  }
}

async function reframeSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!_lastMediaUrl || _lastMediaKind !== "image") { out.write(SF("  no previous image to edit\n")); return; }
  if (!arg) { out.write("usage: /re-frame <edit description>\n"); return; }
  const editPrompt = `Edit the previously generated image: ${arg}`;
  const flags: GenFlags = { model: "edit", ref: _lastMediaUrl };
  out.write(SF(`editing with gpt-image-2: "${arg}"\n\n`));
  try {
    const resp = await dispatchGeneration(ctx.api, editPrompt, "vision_gpt_image2", flags);
    if (resp.media_url) {
      const filepath = await downloadMediaFile(ctx.api, resp.media_url, ensureOutputDir(), "vision_gpt_image2", "image", resp.filename);
      const entry = recordOutput({ model: "vision_gpt_image2", prompt: editPrompt, kind: "image", filepath, filename: basename(filepath), url: resp.media_url, timestamp: new Date().toISOString(), flags });
      out.write(`${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n`);
      _lastMediaUrl = resp.media_url; _lastMediaModel = "vision_gpt_image2"; _lastMediaPrompt = editPrompt;
    }
  } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
}

async function videogenSlash(ctx: AppContext, out: Writable, arg: string, cinematic: boolean): Promise<void> {
  const { prompt, flags } = parseSlashFlags(arg, "video");
  if (!prompt) { out.write("usage: /videogen <prompt> [--model seedance] [--duration 10] [--1080p] [--audio]\n  /sequence <prompt>\n"); return; }
  const kind: MediaKind = "video";
  const modelKey = flags.model ? resolveModelKey(flags.model) : cinematic ? "seedance" : autoRouteModel(prompt, kind);
  if (!flags.duration) flags.duration = 5;
  const fullPrompt = buildMediaPrompt(prompt, flags, kind);
  out.write(SF(`generating video with ${modelKey}: "${prompt}"\n\n`));
  try {
    const resp = await dispatchGeneration(ctx.api, fullPrompt, modelKey, flags);
    if (resp.media_url) {
      out.write(SF("downloading video...\n"));
      const filepath = await downloadMediaFile(ctx.api, resp.media_url, ensureOutputDir(), modelKey, kind, resp.filename);
      const entry = recordOutput({ model: modelKey, prompt: fullPrompt, kind, filepath, filename: basename(filepath), url: resp.media_url, timestamp: new Date().toISOString(), flags });
      out.write(`${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n  ${SF(resp.media_url)}\n\n`);
      _lastMediaUrl = resp.media_url; _lastMediaModel = modelKey; _lastMediaPrompt = fullPrompt; _lastMediaKind = kind;
    }
  } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
}

async function animateSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const args = arg.trim().split(/\s+/);
  const ref = args[0];
  const extraPrompt = args.slice(1).join(" ");
  if (!ref) { out.write("usage: /animate <image_url|file.png|#n> [motion description]\n"); return; }
  let refUrl = ref;
  if (/^#?\d+$/.test(ref)) {
    const entry = findOutput(ref.replace("#", ""));
    if (entry) refUrl = entry.url;
    else { out.write(SF(`  no output matching "${ref}"\n`)); return; }
  }
  const prompt = `Animate this image into a fluid video sequence${extraPrompt ? ": " + extraPrompt : ""}`;
  out.write(SF(`animating from ${refUrl.slice(0, 50)}...\n\n`));
  try {
    const resp = await dispatchGeneration(ctx.api, prompt, "vision_seedance", { model: "seedance", ref: refUrl, duration: 5 });
    if (resp.media_url) {
      const filepath = await downloadMediaFile(ctx.api, resp.media_url, ensureOutputDir(), "vision_seedance", "video", resp.filename);
      const entry = recordOutput({ model: "vision_seedance", prompt, kind: "video", filepath, filename: basename(filepath), url: resp.media_url, timestamp: new Date().toISOString(), flags: { model: "seedance", ref: refUrl, duration: 5 } });
      out.write(`${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n`);
      _lastMediaUrl = resp.media_url; _lastMediaModel = "vision_seedance"; _lastMediaPrompt = prompt; _lastMediaKind = "video";
    }
  } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
}

async function recutSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!_lastMediaUrl || _lastMediaKind !== "video") { out.write(SF("  no previous video to edit\n")); return; }
  if (!arg) { out.write("usage: /re-cut <edit description>\n"); return; }
  const modelKey = _lastMediaModel || "vision_seedance";
  const editPrompt = `Edit the previously generated video: ${arg}`;
  out.write(SF(`editing video: "${arg}"\n\n`));
  try {
    const resp = await dispatchGeneration(ctx.api, editPrompt, modelKey, { model: modelKey, ref: _lastMediaUrl });
    if (resp.media_url) {
      const filepath = await downloadMediaFile(ctx.api, resp.media_url, ensureOutputDir(), modelKey, "video", resp.filename);
      const entry = recordOutput({ model: modelKey, prompt: editPrompt, kind: "video", filepath, filename: basename(filepath), url: resp.media_url, timestamp: new Date().toISOString(), flags: {} });
      out.write(`${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n`);
      _lastMediaUrl = resp.media_url; _lastMediaPrompt = editPrompt;
    }
  } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
}

async function outputSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const ref = parts.slice(1).join(" ");
  if (sub === "open" || sub === "o") {
    if (!ref) { out.write("usage: /output open <n|filename>\n"); return; }
    const entry = findOutput(ref);
    if (!entry) { out.write(SF(`  no output matching "${ref}"\n`)); return; }
    try { openOutput(entry); out.write(`${theme.iceBlue("→")} opened ${entry.filename}\n`); }
    catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
    return;
  }
  if (sub === "clean" || sub === "clear") { out.write(SF(`  cleared ${clearOutput()} entries\n`)); return; }
  const entries = listOutput(10);
  if (!entries.length) { out.write(SF("  (no generations yet — use /photogen or /videogen)\n")); return; }
  out.write(`${theme.iceBlue("📦")}  RECENT GENERATIONS\n\n`);
  for (const e of entries) {
    const icon = e.kind === "video" ? "🎬" : e.kind === "3d" ? "🧊" : "🖼";
    const sp = e.prompt.length > 50 ? e.prompt.slice(0, 47) + "..." : e.prompt;
    out.write(`  ${theme.iceBlue("#" + e.index)} ${icon}  ${e.filename}\n     ${SF(`${e.model}  ${(e.size_bytes/1024/1024).toFixed(1)}MB  ${sp}`)}\n`);
  }
  out.write(SF("\n  /output open <n>  — open in default viewer\n\n"));
}

async function storyboardSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(" ");
  if (sub === "list" || sub === "ls") {
    const boards = listStoryboards();
    if (!boards.length) { out.write(SF("  (no saved storyboards)\n")); return; }
    out.write(`\n${theme.iceBlue("🎬")}  STORYBOARDS\n\n`);
    for (const b of boards) out.write(`  ${b.id.padEnd(20)} ${b.title.slice(0, 40)}  ${b.scenes} scenes  [${b.status}]\n`);
    return;
  }
  if (sub === "view" && rest) {
    const sb = loadStoryboard(rest);
    if (!sb) { out.write(SF(`  no storyboard "${rest}"\n`)); return; }
    sbPreview(sb, out);
    return;
  }
  if (sub === "--preview" || sub === "--generate" || sub === "--animate" || sub === "--render") {
    const boards = listStoryboards();
    const id = rest || (boards[0]?.id ?? "");
    const sb = loadStoryboard(id);
    if (!sb) { out.write(SF("  no storyboard found\n")); return; }
    const phase = sub.replace("--", "");
    if (phase === "preview") { sbPreview(sb, out); return; }
    await sbRender(ctx, sb, phase, out);
    return;
  }
  if (!arg.trim()) { out.write("usage: /storyboard <prompt|file> [--scenes n] [--style style]\n  /storyboard --preview|--generate|--animate|--render [id]\n  /storyboard list|view <id>\n"); return; }
  let sourceType: "prompt" | "script_file" = "prompt";
  let source = arg;
  let opts: { scenes?: number; style?: string } = {};
  const firstArg = parts[0] ?? "";
  if (fsExistsSync(firstArg) && /\.(md|txt)$/i.test(firstArg)) {
    sourceType = "script_file"; source = firstArg; opts = sbFlagParse(parts.slice(1).join(" "));
  } else {
    const fi = parts.findIndex(p => p.startsWith("--"));
    if (fi > 0) { source = parts.slice(0, fi).join(" "); opts = sbFlagParse(parts.slice(fi).join(" ")); }
  }
  out.write(SF("parsing storyboard...\n"));
  try {
    const result = await parseStoryboard(ctx.api, source, sourceType, opts);
    const sb = { id: `sb_${Date.now().toString(36)}`, title: result.title, source_type: sourceType, source, style: result.style, total_scenes: result.scenes.length, scenes: result.scenes, created_at: new Date().toISOString(), status: "draft" as const };
    saveStoryboard(sb);
    sbPreview(sb, out);
    out.write(SF("\n/storyboard --generate   to generate all keyframes\n"));
    out.write(SF("/storyboard --animate    to animate the sequence\n"));
    out.write(SF("/storyboard --render     full pipeline\n"));
  } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
}

function sbFlagParse(raw: string): { scenes?: number; style?: string } {
  const r: { scenes?: number; style?: string } = {};
  const p = raw.split(/\s+/);
  for (let i = 0; i < p.length; i++) {
    const next = p[i + 1] ?? "";
    if ((p[i] === "--scenes" || p[i] === "-n") && next) { r.scenes = parseInt(next, 10); i++; }
    else if (p[i] === "--style" && next) { r.style = next; i++; }
  }
  return r;
}

function sbPreview(sb: any, out: Writable): void {
  out.write(`\n${theme.iceBlue("🎬")}  STORYBOARD: ${sb.title}\n`);
  out.write(SF(`   style: ${sb.style}  |  scenes: ${sb.total_scenes}  |  status: ${sb.status}\n\n`));
  for (const s of sb.scenes) {
    out.write(
      `${theme.iceBlue("SCENE " + s.index)}  ${(s.shot_type||"WIDE").padEnd(8)} | ${(s.camera_movement||"static").padEnd(10)} | ${s.duration_sec}s  | ${s.transition}\n` +
      `  ${SF("visual:")} ${(s.keyframe_prompt||"").slice(0,80)}${(s.keyframe_prompt||"").length>80?"...":""}\n` +
      `  ${SF("motion:")} ${(s.animation_prompt||"").slice(0,80)}\n` +
      `  ${SF("palette:")} ${s.color_palette||"natural"}  ${SF("light:")} ${s.lighting||"ambient"}\n\n`
    );
  }
}

async function sbRender(ctx: AppContext, sb: any, phase: string, out: Writable): Promise<void> {
  if (phase === "generate" || phase === "render") {
    out.write(SF(`generating ${sb.total_scenes} keyframes...\n\n`));
    for (const s of sb.scenes) {
      out.write(SF(`  scene ${s.index}/${sb.total_scenes}: ${s.shot_type}\n`));
      try {
        const mk = autoRouteModel(s.keyframe_prompt, "image");
        const resp = await dispatchGeneration(ctx.api, s.keyframe_prompt, mk, { aspect: "16_9" });
        if (resp.media_url) {
          const fp = await downloadMediaFile(ctx.api, resp.media_url, ensureOutputDir(), mk, "image");
          s.generated_frame_url = resp.media_url; s.generated_frame_path = fp;
          recordOutput({ model: mk, prompt: s.keyframe_prompt, kind: "image", filepath: fp, filename: basename(fp), url: resp.media_url, timestamp: new Date().toISOString(), flags: {} });
          out.write(`    ${theme.iceBlue("✓")} scene ${s.index}\n`);
        }
      } catch (err) { out.write(`    ✗ ${err instanceof Error ? err.message : String(err)}\n`); }
    }
    sb.status = "keyframes_generated"; saveStoryboard(sb);
  }
  if (phase === "animate" || phase === "render") {
    const anim = sb.scenes.filter((s: any) => s.generated_frame_url);
    out.write(SF(`animating ${anim.length} scenes...\n\n`));
    for (const s of anim) {
      out.write(SF(`  scene ${s.index}: ${s.camera_movement} over ${s.duration_sec}s\n`));
      try {
        const resp = await dispatchGeneration(ctx.api, s.animation_prompt, "vision_seedance", { model: "seedance", ref: s.generated_frame_url, duration: s.duration_sec });
        if (resp.media_url) {
          const fp = await downloadMediaFile(ctx.api, resp.media_url, ensureOutputDir(), "vision_seedance", "video");
          recordOutput({ model: "vision_seedance", prompt: s.animation_prompt, kind: "video", filepath: fp, filename: basename(fp), url: resp.media_url, timestamp: new Date().toISOString(), flags: {} });
          out.write(`    ${theme.iceBlue("✓")} scene ${s.index}\n`);
        }
      } catch (err) { out.write(`    ✗ ${err instanceof Error ? err.message : String(err)}\n`); }
    }
    sb.status = "animated"; saveStoryboard(sb);
  }
}
