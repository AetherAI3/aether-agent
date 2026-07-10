import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import { chooseBackend } from "../core/backend.js";
import {
  forgetCloudMemoryItem,
  forgetMemory,
  localMemoryReport,
  memoryReport,
  pruneMemory,
  tierReport,
  type MemoryReport,
  type MemoryTier,
  type MemoryTierReport,
} from "../core/memory.js";

export interface MemoryCommandOptions {
  out?: Writable;
  apply?: boolean;
}

const TIERS = new Set<MemoryTier>(["working", "episodic", "semantic", "procedural"]);

function parseTier(value: string | undefined): MemoryTier {
  if (!value || !TIERS.has(value as MemoryTier)) {
    throw new Error("tier must be working, episodic, semantic, or procedural");
  }
  return value as MemoryTier;
}

export async function cloudMemoryEnabled(ctx: AppContext): Promise<boolean> {
  if (ctx.flags.local === true) return false;
  const preference = (process.env["AETHER_BACKEND"] || ctx.cfg.backend || "auto").trim();
  const authenticated = Boolean(await ctx.tokens.get());
  return chooseBackend(preference, authenticated) === "cloud";
}

async function reportForContext(ctx: AppContext): Promise<MemoryReport> {
  return (await cloudMemoryEnabled(ctx))
    ? memoryReport(ctx.api, ctx.flags.cwd)
    : localMemoryReport(ctx.flags.cwd);
}

function renderTier(tier: MemoryTierReport): string {
  const lines = [`${tier.tier} memory`];
  for (const source of tier.sources) {
    lines.push(
      `  ${source.source}: ${source.status} | ${source.count} total | ${source.current} current | ${source.other} other | ${source.unscoped} unscoped | ${source.account} account`,
    );
    if (source.detail) lines.push(`    ${source.detail}`);
  }
  for (const item of tier.items) {
    lines.push(`  ${item.id} | ${item.source} | ${item.scope}${item.createdAt ? " | " + item.createdAt : ""}`);
  }
  if (!tier.items.length) lines.push("  (no item metadata available)");
  return lines.join("\n") + "\n";
}

function renderStatus(report: MemoryReport): string {
  const lines = [
    `Memory report v${report.schemaVersion} | workspace ${report.workspaceId} | agentic ${report.agenticBackend}`,
  ];
  for (const tier of report.tiers) {
    const count = tier.sources.reduce((sum, source) => sum + source.count, 0);
    const cloudOnly = tier.tier !== "working" && report.agenticBackend === "cloud-only";
    const degraded = tier.sources.some((source) => source.status !== "available");
    const label = cloudOnly ? "| cloud-only" : degraded ? "| degraded" : "| healthy";
    lines.push(`  ${tier.tier.padEnd(10)} ${String(count).padStart(4)} item(s) ${label}`);
  }
  lines.push("Use aether memory inspect <tier> for metadata-only inventory.");
  return lines.join("\n") + "\n";
}

export async function cmdMemory(
  ctx: AppContext,
  argv: string[],
  options: MemoryCommandOptions = {},
): Promise<number> {
  const out = options.out ?? process.stdout;
  const sub = (argv[0] ?? "status").toLowerCase();
  try {
    if (sub === "status") {
      const report = await reportForContext(ctx);
      out.write(ctx.flags.json ? JSON.stringify(report) + "\n" : renderStatus(report));
      return 0;
    }
    if (sub === "inspect") {
      const tier = parseTier(argv[1]);
      const selected = tierReport(await reportForContext(ctx), tier);
      out.write(ctx.flags.json ? JSON.stringify(selected) + "\n" : renderTier(selected));
      return 0;
    }
    if (sub === "forget") {
      const tier = parseTier(argv[1]);
      const id = argv[2];
      if (!id) throw new Error("usage: aether memory forget <tier> <id>");
      const qopc = id.startsWith("qopc-");
      if (qopc && !(await cloudMemoryEnabled(ctx))) {
        throw new Error("QOPC agentic memory is cloud-only; local mode never queries it");
      }
      const confirmed =
        ctx.flags.yes || (await ctx.confirm(`Forget ${id} from ${tier} memory? [y/N] `));
      if (!confirmed) {
        out.write("kept.\n");
        return 0;
      }
      if (qopc) await forgetCloudMemoryItem(ctx.api, tier, id);
      else forgetMemory(tier, id, ctx.flags.cwd);
      out.write(ctx.flags.json ? JSON.stringify({ ok: true, tier, id }) + "\n" : `forgot ${id}\n`);
      return 0;
    }
    if (sub === "prune") {
      const days = Number(argv[1]);
      const apply = options.apply === true || argv.includes("--apply");
      if (!Number.isInteger(days) || days < 1 || days > 36500) {
        throw new Error("usage: aether memory prune <days> [--apply]");
      }
      if (apply) {
        const confirmed =
          ctx.flags.yes || (await ctx.confirm(`Prune local snapshots older than ${days} day(s)? [y/N] `));
        if (!confirmed) {
          out.write("kept.\n");
          return 0;
        }
      }
      const result = pruneMemory(days, apply, ctx.flags.cwd);
      if (ctx.flags.json) out.write(JSON.stringify(result) + "\n");
      else {
        out.write(
          `${result.dryRun ? "dry run" : "prune"}: ${result.candidates.length} local snapshot candidate(s), ${result.removed.length} removed\n`,
        );
        for (const item of result.candidates) {
          out.write(`  ${item.id} | ${item.tier} | ${item.source}\n`);
        }
        if (result.dryRun) out.write("Re-run with --apply to delete after confirmation.\n");
        out.write("QOPC account memory is never automatically pruned by the terminal.\n");
      }
      return result.failures.length ? 1 : 0;
    }
    throw new Error(
      "usage: aether memory [status|inspect <tier>|forget <tier> <id>|prune <days> [--apply]]",
    );
  } catch (error) {
    out.write(`memory: ${error instanceof Error ? error.message : "operation failed"}\n`);
    return 2;
  }
}
