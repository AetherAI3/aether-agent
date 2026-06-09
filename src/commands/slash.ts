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
import { generateScaffold, isValidScaffoldType, SCAFFOLD_USAGE, type ScaffoldType } from "../core/scaffold.js";
import { portCode, readSource, writePortedFiles } from "../core/port.js";
import { generateDiff } from "../core/stage_diff.js";
import { startTestDrive } from "../core/test_drive.js";
import { runBenchmark } from "../core/bench.js";

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
    case "test-drive": {
      await testDriveSlash(ctx, out, arg);
      break;
    }
    case "bench": {
      await benchSlash(ctx, out, arg);
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
    case "token-budget":
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
    case "scaffold": {
      await scaffoldSlash(ctx, out, arg);
      break;
    }
    case "port": {
      await portSlash(ctx, out, arg);
      break;
    }
    case "purge": {
      await purgeSlash(ctx, out);
      break;
    }
    case "stage-diff": {
      await stageDiffSlash(ctx, out);
      break;
    }
    case "revert": {
      await revertSlash(ctx, out, arg);
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

// ── /scaffold ─────────────────────────────────

async function scaffoldSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.trim().split(/\s+/);
  const type = parts[0]?.toLowerCase() ?? "";
  const name = parts.slice(1).join(" ");

  if (!type || !name) {
    out.write(SCAFFOLD_USAGE + "\n");
    return;
  }

  if (!isValidScaffoldType(type)) {
    out.write(`invalid type: ${type} — use component, route, or module\n`);
    return;
  }

  try {
    out.write(`scaffolding ${type} "${name}"...\n`);
    const r = await generateScaffold(ctx.api, type as ScaffoldType, name);
    for (const f of r.files) {
      out.write(`  created: ${theme.bold(f.path)}  (${f.content.split("\n").length} lines)\n`);
    }
    out.write(`template: ${theme.dim(r.template_used)}\n`);
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── /purge ─────────────────────────────────────

async function purgeSlash(ctx: AppContext, out: Writable): Promise<void> {
  const registry = getRegistry();
  const { clearedPins, removedFiles } = registry.purge();

  // Reset the registry completely
  resetRegistry();

  // Clear screen
  out.write("\x1b[2J\x1b[H");

  const lines: string[] = [];
  if (clearedPins > 0) lines.push(`${clearedPins} pinned files`);
  if (removedFiles > 0) lines.push(`${removedFiles} temp files`);
  lines.push("UVT cap reset");
  lines.push("context flushed");

  out.write(`${theme.cyan("🧹 purged")}  ${lines.join(" · ")}\n`);
  out.write(theme.dim("  Session goal preserved. Agent memory reset to lean baseline.\n"));
}

// ── /port ─────────────────────────────────────

async function portSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.trim().split(/\s+/);
  const targetPath = parts[0];
  const targetLang = parts[1]?.toLowerCase();

  if (!targetPath || !targetLang) {
    out.write("usage: /port <file|dir> <target_language>\n");
    out.write("  /port src/utils.ts rust\n");
    out.write("  /port src/services/ python\n");
    return;
  }

  try {
    const files = readSource(targetPath);
    out.write(`reading ${files.length} file(s) from ${targetPath}...\n`);

    const r = await portCode(ctx.api, files, targetLang);
    out.write(`translated → ${r.files.length} file(s)\n`);

    const outDir = `ported_${targetLang}`;
    const written = writePortedFiles(r.files, outDir);
    for (const w of written) {
      out.write(`  ${theme.bold(w)}\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── /stage-diff ────────────────────────────────

async function stageDiffSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    const r = generateDiff();

    if (r.files.length === 0) {
      out.write("(working tree clean — nothing to stage)\n");
      return;
    }

    out.write(theme.cyan("📋  Stage Diff\n"));
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));

    out.write(`  ${r.stats.filesChanged} files  +${r.stats.additions} -${r.stats.deletions}\n\n`);

    for (const f of r.files.slice(0, 15)) {
      out.write(`  ${theme.muted(f)}\n`);
    }
    if (r.files.length > 15) {
      out.write(`  ${theme.dim(`... and ${r.files.length - 15} more`)}\n`);
    }

    out.write(`\n${theme.bold("Suggested commit:")}\n`);
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
    out.write(r.commitMessage + "\n");
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));

    const diffLines = r.diff.split("\n").slice(0, 30);
    out.write(`\n${theme.dim("Diff preview (first 30 lines):")}\n`);
    for (const line of diffLines) {
      if (line.startsWith("+")) out.write(theme.dim(line) + "\n");
      else if (line.startsWith("-")) out.write(theme.muted(line) + "\n");
      else out.write(theme.dim(line) + "\n");
    }

    if (r.diff.split("\n").length > 30) {
      out.write(theme.dim("  ... (truncated)\n"));
    }

    out.write(`\n${theme.dim("  Copy the commit message above and commit when ready.")}\n`);
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── /revert ─────────────────────────────────────

async function revertSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const target = arg.trim();
  if (!target) {
    out.write("usage: /revert <file|step_id>    surgical rollback\n");
    out.write("  /revert src/core/old.ts        revert single file\n");
    out.write("  /revert step-3                 revert to checkpoint (coming soon)\n");
    return;
  }

  const cwd = process.cwd();
  const gitDir = join(cwd, ".git");
  if (!existsSync(gitDir)) {
    out.write(theme.muted("Not in a git repository.\n"));
    return;
  }

  const { execSync } = require("node:child_process") as typeof import("node:child_process");

  if (target.startsWith("step-") || target.match(/^\d+$/)) {
    out.write(theme.muted("Step-based revert not yet available. Use /rollback to revert all, or /revert <file> for a single file.\n"));
    out.write(theme.dim("  Tracked step checkpoints planned for future release.\n"));
    return;
  }

  try {
    const isTracked = (() => {
      try {
        execSync(`git ls-files --error-unmatch "${target}"`, { cwd, encoding: "utf8", timeout: 3000 });
        return true;
      } catch { return false; }
    })();

    if (!isTracked) {
      out.write(`${theme.muted(target)} is not tracked by git.\n`);
      return;
    }

    const diffOut = execSync(`git diff --name-only -- "${target}"`, { cwd, encoding: "utf8", timeout: 3000 });
    if (!diffOut.trim()) {
      out.write(`(no uncommitted changes in ${target})\n`);
      return;
    }

    const fileDiff = execSync(`git diff -- "${target}"`, { cwd, encoding: "utf8", timeout: 5000 });
    const changes = fileDiff.trim().split("\n").length;

    out.write(`${theme.cyan("↩  Reverting")} ${theme.bold(target)}  (${changes} line changes)\n`);
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));

    for (const line of fileDiff.split("\n").slice(0, 10)) {
      if (line.startsWith("+")) out.write(theme.dim(line) + "\n");
      else if (line.startsWith("-")) out.write(theme.muted(line) + "\n");
      else out.write(theme.dim(line) + "\n");
    }

    const ok = ctx.flags.yes || (await ctx.confirm(`\nRevert ${target} to last commit? [y/N] `));
    if (!ok) {
      out.write("cancelled.\n");
      return;
    }

    execSync(`git checkout -- "${target}"`, { cwd, encoding: "utf8", timeout: 10000 });
    out.write(`${theme.cyan("↩ reverted")}  ${target} restored to last commit.\n`);
  } catch (err: any) {
    if (err?.stderr?.includes("did not match any file")) {
      out.write(`not found: ${target}\n`);
    } else {
      out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    }
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
      theme.dim("/token-budget") + " <uvt>       alias for /limit",
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
    [
      "",
      theme.iceBlue("⚡") + "  " + theme.bold("UVT Tools"),
      "",
      theme.dim("/scaffold") + " <type> <name>  generate boilerplate (component|route|module)",
      theme.dim("/port") + " <file> <lang>      translate code to another language",
      theme.dim("/test-drive") + ' "<target>"  auto-test: generate, run, fix, repeat',
      theme.dim("/bench") + " <target>          profile & optimize code",
      theme.dim("/purge") + "                    flush transient context & temp files",
      theme.dim("/token-budget") + " <uvt>       hard UVT cap (alias: /limit)",
      theme.dim("/stage-diff") + "               unified diff + commit message",
      theme.dim("/revert") + " <file|step>       surgical rollback",
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

async function gatherSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!requireOrchestrator(ctx, out)) return;
  const workerId = arg.trim();
  if (!workerId) {
    out.write("usage: /gather <sub_agent_id|all>\n");
    return;
  }
  try {
    const r = await gatherResults(ctx.api, ctx.flags.agent!, workerId);
    if (r.results.length === 0) {
      out.write("(no results to gather)\n");
      return;
    }
    for (const res of r.results) {
      out.write(`${theme.bold(res.worker_id)}:\n`);
      if (res.files.length) out.write(`  files:  ${res.files.join(", ")}\n`);
      if (res.diffs.length) out.write(`  diffs:  ${res.diffs.length} diff(s)\n`);
      if (res.patches.length) out.write(`  patches: ${res.patches.length} patch(es)\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── /test-drive ─────────────────────────────────

async function testDriveSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!requireOrchestrator(ctx, out)) return;

  const target = arg.trim().replace(/^["']|["']$/g, "");
  if (!target) {
    out.write('usage: /test-drive "<route|function>"\n');
    out.write('  /test-drive "POST /api/users"\n');
    out.write('  /test-drive "src/utils/validate.ts:validateEmail"\n');
    return;
  }

  try {
    out.write(`${theme.cyan("🧪 test-drive")}  targeting: ${theme.bold(target)}\n`);
    out.write(theme.dim("  Generating test matrix, running, iterating until green...\n\n"));

    const r = await startTestDrive(ctx.api, ctx.flags.agent!, target, process.cwd());

    if (r.status === "passed") {
      out.write(`${theme.cyan("✓ all tests pass")}  after ${r.iterations} iteration(s)\n`);
      if (r.final_result) {
        out.write(`  ${r.final_result.passed} passed · ${r.final_result.failed} failed\n`);
      }
      if (r.patches.length > 0) {
        out.write(`  ${r.patches.length} source file(s) modified\n`);
        for (const p of r.patches) {
          out.write(`    ${theme.bold(p.file)}\n`);
        }
      }
    } else {
      out.write(`${theme.muted("✗ tests did not converge")} after ${r.iterations} iteration(s)\n`);
      if (r.final_result?.errors.length) {
        for (const e of r.final_result.errors.slice(0, 3)) {
          out.write(`  ${theme.muted(e.slice(0, 200))}\n`);
        }
      }
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── /bench ─────────────────────────────────────

async function benchSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!requireOrchestrator(ctx, out)) return;

  const target = arg.trim();
  if (!target) {
    out.write("usage: /bench <function|endpoint>\n");
    out.write("  /bench src/services/search.ts:fullTextSearch\n");
    out.write("  /bench GET /api/search\n");
    return;
  }

  try {
    out.write(`${theme.cyan("⚡ benchmarking")}  ${theme.bold(target)}...\n`);

    const r = await runBenchmark(ctx.api, ctx.flags.agent!, target);

    if (r.complexity) {
      out.write(`\n  complexity: ${theme.bold(r.complexity)}\n`);
    }
    if (r.bottlenecks.length > 0) {
      out.write(`\n  ${theme.muted("bottlenecks:")}\n`);
      for (const b of r.bottlenecks) {
        out.write(`    ${theme.muted("•")} ${b}\n`);
      }
    }
    if (r.optimizations.length > 0) {
      out.write(`\n  ${theme.cyan("optimizations:")}\n`);
      for (const o of r.optimizations) {
        out.write(`    ${theme.cyan("→")} ${o.description}  ${theme.dim(`(${o.improvement})`)}\n`);
      }
    }
    if (r.patches.length > 0) {
      out.write(`\n  ${r.patches.length} optimization(s) applied\n`);
      for (const p of r.patches) {
        out.write(`    ${theme.bold(p.file)}\n`);
      }
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
