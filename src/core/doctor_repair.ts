// src/core/doctor_repair.ts — `aether doctor --fix`: allowlisted local repair.
//
// This is deliberately not a "repair my project" agent. Every repair is a named
// entry in REPAIRS with a fixed scope, and the planner can only ever return
// entries from that list. Nothing here rotates a credential, spends anything,
// touches tracked source, or mutates a git ref — see FORBIDDEN, which exists so
// those exclusions are testable rather than merely documented.

import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { configDir } from "./config.js";
import { custodyLogPath } from "./custody.js";
import { isLockStale, preserveCorrupt, readJsonFile, type LockOwner } from "./durable_store.js";
import { historyPaths, loadHistory } from "./media_history.js";
import { repersist } from "./media_history_store.js";
import type { HealthReport } from "./health.js";

export interface RepairContext {
  outputDir?: string;
  configRoot?: string;
  custodyPath?: string;
  cwd?: string;
  now?: string;
  platform?: NodeJS.Platform;
  /** Files older than this may be treated as abandoned. */
  staleMs?: number;
}

type ResolvedContext = RepairContext &
  Required<Pick<RepairContext, "outputDir" | "configRoot" | "custodyPath" | "cwd">>;

export interface RepairPlanItem {
  id: string;
  title: string;
  /** The exact paths or refs this repair will touch. */
  scope: string[];
  action: string;
  risk: "low" | "medium";
  reversible: boolean;
  backup: string;
}

export interface RepairResult {
  id: string;
  applied: boolean;
  detail: string;
  preserved?: string;
}

/**
 * Operations `--fix` must never perform. Kept as data so each one has a
 * negative test instead of living only in a comment.
 */
export const FORBIDDEN: readonly string[] = [
  "credential rotation or deletion",
  "login, OAuth consent, or permission escalation",
  "UVT reservation, spend, or settlement",
  "model invocation",
  "source edits, formatting, or dependency updates",
  "git commit, reset, clean, checkout, merge, rebase, push, pull, or branch deletion",
  "remote ref mutation",
  "GitHub Actions dispatch",
  "Predator runs",
  "MCP write-tool invocation",
];

const DEFAULT_STALE_MS = 60 * 60 * 1000;

interface Repair {
  id: string;
  title: string;
  action: string;
  risk: "low" | "medium";
  reversible: boolean;
  backup: string;
  /** Paths this repair would touch, or [] when there is nothing to do. */
  scope(ctx: ResolvedContext): string[];
  apply(ctx: ResolvedContext): RepairResult;
}

function resolveContext(ctx: RepairContext): ResolvedContext {
  return {
    ...ctx,
    outputDir: ctx.outputDir ?? "./aether-output",
    configRoot: ctx.configRoot ?? configDir(),
    custodyPath: ctx.custodyPath ?? custodyLogPath(),
    cwd: ctx.cwd ?? process.cwd(),
  };
}

function ageMs(path: string, now: number): number {
  try {
    return Math.max(0, now - statSync(path).mtimeMs);
  } catch {
    return 0;
  }
}

function clockOf(ctx: RepairContext): number {
  return ctx.now ? Date.parse(ctx.now) : Date.now();
}

function staleLockPaths(ctx: ResolvedContext): string[] {
  const lock = historyPaths(ctx.outputDir).lock;
  if (!existsSync(lock)) return [];
  const owner = readJsonFile<LockOwner>(lock);
  const stale = isLockStale(
    owner.ok ? owner.value : null,
    ageMs(lock, clockOf(ctx)),
    ctx.staleMs ?? DEFAULT_STALE_MS,
  );
  return stale ? [lock] : [];
}

function staleTemps(ctx: ResolvedContext): string[] {
  if (!existsSync(ctx.outputDir)) return [];
  const threshold = ctx.staleMs ?? DEFAULT_STALE_MS;
  const clock = clockOf(ctx);
  let names: string[];
  try {
    names = readdirSync(ctx.outputDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith(".") && name.endsWith(".tmp"))
    .map((name) => join(ctx.outputDir, name))
    .filter((path) => ageMs(path, clock) >= threshold);
}

function prunableWorktrees(cwd: string): string[] {
  let raw: string;
  try {
    raw = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
    });
  } catch {
    return [];
  }
  const missing: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("worktree ")) continue;
    const path = line.slice("worktree ".length);
    if (path && !existsSync(path)) missing.push(path);
  }
  return missing;
}

function missingStateDirs(ctx: ResolvedContext): string[] {
  return [ctx.configRoot, dirname(ctx.custodyPath), ctx.outputDir].filter(
    (dir) => !existsSync(dir),
  );
}

function looseStateDirs(ctx: ResolvedContext): string[] {
  if ((ctx.platform ?? process.platform) === "win32") return [];
  // Only the Aether-owned roots. Never a recursive chmod over a workspace.
  return [ctx.configRoot, dirname(ctx.custodyPath)].filter((dir) => {
    if (!existsSync(dir)) return false;
    try {
      return (statSync(dir).mode & 0o077) !== 0;
    } catch {
      return false;
    }
  });
}

export const REPAIRS: readonly Repair[] = [
  {
    id: "state.directories",
    title: "Create missing Aether state directories",
    action: "mkdir with owner-only permissions",
    risk: "low",
    reversible: true,
    backup: "not needed — creates only, never replaces",
    scope: missingStateDirs,
    apply: (ctx): RepairResult => {
      const missing = missingStateDirs(ctx);
      for (const dir of missing) mkdirSync(dir, { recursive: true, mode: 0o700 });
      return {
        id: "state.directories",
        applied: missing.length > 0,
        detail: missing.length ? `created ${missing.join(", ")}` : "nothing missing",
      };
    },
  },
  {
    id: "state.permissions",
    title: "Tighten permissions on Aether-owned state",
    action: "chmod 0700 on the Aether state roots only",
    risk: "low",
    reversible: true,
    backup: "not needed — mode change only",
    scope: looseStateDirs,
    apply: (ctx): RepairResult => {
      if ((ctx.platform ?? process.platform) === "win32") {
        return {
          id: "state.permissions",
          applied: false,
          detail: "Windows ACLs remain authoritative; no mode change attempted",
        };
      }
      const targets = looseStateDirs(ctx);
      for (const dir of targets) chmodSync(dir, 0o700);
      return {
        id: "state.permissions",
        applied: targets.length > 0,
        detail: targets.length ? `tightened ${targets.join(", ")}` : "nothing to tighten",
      };
    },
  },
  {
    id: "state.stale-locks",
    title: "Remove provably abandoned state locks",
    action: "unlink a lock whose owner process is gone",
    risk: "low",
    reversible: false,
    backup: "not needed — a lock holds no data",
    scope: staleLockPaths,
    apply: (ctx): RepairResult => {
      const targets = staleLockPaths(ctx);
      if (!targets.length) {
        return { id: "state.stale-locks", applied: false, detail: "no abandoned lock found" };
      }
      for (const lock of targets) rmSync(lock, { force: true });
      return { id: "state.stale-locks", applied: true, detail: `removed ${targets.join(", ")}` };
    },
  },
  {
    id: "state.temp",
    title: "Remove abandoned transaction temp files",
    action: "unlink .tmp files older than the stale threshold",
    risk: "low",
    reversible: false,
    backup: "not needed — a temp is an incomplete write",
    scope: staleTemps,
    apply: (ctx): RepairResult => {
      const targets = staleTemps(ctx);
      for (const path of targets) rmSync(path, { force: true });
      return {
        id: "state.temp",
        applied: targets.length > 0,
        detail: targets.length ? `removed ${targets.length} abandoned temp file(s)` : "none found",
      };
    },
  },
  {
    id: "media.rebuild",
    title: "Rebuild the media output index",
    action: "recover from backup or from files on disk, preserving the corrupt original",
    risk: "medium",
    reversible: true,
    backup: "the unreadable primary is kept as .corrupt.<timestamp>",
    scope: (ctx): string[] => {
      const paths = historyPaths(ctx.outputDir);
      if (!existsSync(paths.primary)) return [];
      return loadHistory(paths, ctx.now).state === "ok" ? [] : [paths.primary];
    },
    apply: (ctx): RepairResult => {
      const paths = historyPaths(ctx.outputDir);
      if (!existsSync(paths.primary) || loadHistory(paths, ctx.now).state === "ok") {
        return { id: "media.rebuild", applied: false, detail: "media history is already healthy" };
      }
      // Preserve first, then rewrite. preserveCorrupt copies, so the evidence
      // survives even if the rewrite then fails.
      const preserved = preserveCorrupt(paths.primary, ctx.now) ?? undefined;
      const recovered = repersist(paths, ctx.now ? { now: ctx.now } : {});
      return {
        id: "media.rebuild",
        applied: true,
        detail: `rebuilt from ${recovered.state}; ${recovered.doc.entries.length} entr(ies) recovered`,
        ...(preserved ? { preserved } : {}),
      };
    },
  },
  {
    id: "git.worktrees",
    title: "Prune git worktree metadata for directories that no longer exist",
    action: "git worktree prune — metadata only, never a checkout",
    risk: "low",
    reversible: false,
    backup: "not needed — prunes only entries git itself reports as gone",
    scope: (ctx): string[] => prunableWorktrees(ctx.cwd),
    apply: (ctx): RepairResult => {
      const prunable = prunableWorktrees(ctx.cwd);
      if (!prunable.length) {
        return { id: "git.worktrees", applied: false, detail: "no abandoned worktree metadata" };
      }
      // `git worktree prune` removes administrative records for worktrees whose
      // directory is already gone. It never touches a present worktree, a dirty
      // tree, the current worktree, or any branch.
      try {
        execFileSync("git", ["worktree", "prune"], {
          cwd: ctx.cwd,
          encoding: "utf8",
          timeout: 10_000,
        });
      } catch {
        return { id: "git.worktrees", applied: false, detail: "git worktree prune failed" };
      }
      return {
        id: "git.worktrees",
        applied: true,
        detail: `pruned metadata for ${prunable.length} missing worktree(s)`,
      };
    },
  },
];

/** Housekeeping repairs are scoped by their own preconditions, not by a check. */
const ALWAYS_CONSIDERED = ["state.permissions", "state.stale-locks", "state.temp", "git.worktrees"];

/**
 * The repairs that apply right now. Only checks that named a `repairId` can
 * pull a targeted repair in, and every repair must independently agree it has
 * work to do — so a stale report can never authorise a mutation.
 */
export function planRepairs(
  report: HealthReport,
  context: RepairContext = {},
  only?: readonly string[],
): RepairPlanItem[] {
  const ctx = resolveContext(context);
  const requested = new Set<string>(ALWAYS_CONSIDERED);
  for (const check of report.checks) if (check.repairId) requested.add(check.repairId);

  return REPAIRS.filter((repair) => requested.has(repair.id))
    .filter((repair) => !only || only.includes(repair.id))
    .map((repair) => ({ repair, scope: repair.scope(ctx) }))
    .filter(({ scope }) => scope.length > 0)
    .map(({ repair, scope }) => ({
      id: repair.id,
      title: repair.title,
      scope,
      action: repair.action,
      risk: repair.risk,
      reversible: repair.reversible,
      backup: repair.backup,
    }));
}

/**
 * Apply one repair by id. Preconditions are re-checked inside `apply`, so a
 * plan built before an unrelated change cannot force a mutation that is no
 * longer warranted.
 */
export function applyRepair(id: string, context: RepairContext = {}): RepairResult {
  const repair = REPAIRS.find((entry) => entry.id === id);
  if (!repair) {
    return { id, applied: false, detail: `no such repair: ${id} is not in the allowlist` };
  }
  return repair.apply(resolveContext(context));
}

export function repairIds(): string[] {
  return REPAIRS.map((repair) => repair.id);
}

export function renderRepairPlan(plan: readonly RepairPlanItem[]): string {
  if (!plan.length) return "Nothing to repair.\n";
  const lines = ["Repair plan — nothing runs until you confirm:", ""];
  for (const item of plan) {
    lines.push(`  ${item.id}  ${item.title}`);
    lines.push(`    action      ${item.action}`);
    lines.push(`    scope       ${item.scope.join("\n                ")}`);
    lines.push(
      `    risk        ${item.risk}${item.reversible ? ", reversible" : ", not reversible"}`,
    );
    lines.push(`    backup      ${item.backup}`);
    lines.push("");
  }
  lines.push("Never performed by --fix:");
  for (const item of FORBIDDEN) lines.push(`  · ${item}`);
  return lines.join("\n") + "\n";
}
