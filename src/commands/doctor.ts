// `aether doctor`         — fast, read-only inspection (no network, no writes)
// `aether doctor --live`  — prove the paths actually work right now
// `aether doctor --fix`   — allowlisted local repair, after showing the plan
//
// `--deep` keeps its original read-only meaning. Repointing it at a mutating
// mode would change what an existing habit does, so it stays an alias for the
// fast report and only prints where the new behaviour lives.

import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import { diagnosticReport, type DiagnosticDependencies } from "../core/diagnostics.js";
import { liveReport, type LiveOptions } from "../core/doctor_live.js";
import { renderHealthReport, type HealthReport } from "../core/health.js";
import {
  applyRepair,
  planRepairs,
  renderRepairPlan,
  repairIds,
  type RepairContext,
} from "../core/doctor_repair.js";

export interface DoctorCommandOptions {
  out?: Writable;
  dependencies?: DiagnosticDependencies;
  repairContext?: RepairContext;
  liveOptions?: LiveOptions;
  deep?: boolean;
}

export interface DoctorFlags {
  live: boolean;
  fix: boolean;
  dryRun: boolean;
  yes: boolean;
  deep: boolean;
  noUi: boolean;
  only: string[];
  unknown: string[];
}

const USAGE =
  "usage: aether doctor [--live | --fix] [--dry-run] [--yes] [--no-ui] " +
  "[--only <check-or-repair>] [--json]\n";

export function parseDoctorArgs(argv: readonly string[]): DoctorFlags {
  const flags: DoctorFlags = {
    live: false,
    fix: false,
    dryRun: false,
    yes: false,
    deep: false,
    noUi: false,
    only: [],
    unknown: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--live":
      case "live":
        flags.live = true;
        break;
      case "--fix":
      case "fix":
        flags.fix = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--yes":
      case "-y":
        flags.yes = true;
        break;
      case "--deep":
      case "deep":
        flags.deep = true;
        break;
      case "--no-ui":
        flags.noUi = true;
        break;
      case "--only": {
        const value = argv[i + 1];
        if (value && !value.startsWith("-")) {
          flags.only.push(value);
          i += 1;
        } else {
          flags.unknown.push("--only (missing value)");
        }
        break;
      }
      default:
        flags.unknown.push(arg);
    }
  }
  return flags;
}

function exitCode(report: HealthReport): number {
  return report.summary.error > 0 ? 1 : 0;
}

export async function cmdDoctor(
  ctx: AppContext,
  argv: string[] = [],
  options: DoctorCommandOptions = {},
): Promise<number> {
  const out = options.out ?? process.stdout;
  const flags = parseDoctorArgs(argv);
  if (options.deep === true) flags.deep = true;

  if (flags.unknown.length) {
    out.write(USAGE);
    return 2;
  }
  if (flags.live && flags.fix) {
    out.write("aether doctor: --live and --fix are separate modes; run one at a time\n");
    return 2;
  }

  // --live replaces the report entirely rather than annotating the fast one:
  // mixing "configured" rows into a live run is how a false green happens.
  if (flags.live) {
    const live = await liveReport(ctx, {
      ...(options.liveOptions ?? {}),
      ...(flags.noUi ? { headless: true } : {}),
    });
    const filtered = flags.only.length
      ? { ...live, checks: live.checks.filter((check) => flags.only.includes(check.id)) }
      : live;
    out.write(
      ctx.flags.json ? JSON.stringify(filtered) + "\n" : renderHealthReport(filtered),
    );
    return exitCode(filtered);
  }

  // Fast inspection is the input to every other mode, including --fix.
  const report = await diagnosticReport(ctx, { dependencies: options.dependencies });

  if (flags.fix) return runFix(report, flags, out, options);

  if (ctx.flags.json) {
    out.write(JSON.stringify(report) + "\n");
    return exitCode(report);
  }

  out.write(renderHealthReport(report));
  if (flags.deep) {
    out.write(
      "\nNote: --deep is the read-only report (unchanged). " +
        "The live end-to-end proof is: aether doctor --live\n",
    );
  }
  return exitCode(report);
}

function runFix(
  report: HealthReport,
  flags: DoctorFlags,
  out: Writable,
  options: DoctorCommandOptions,
): number {
  const only = flags.only.length ? flags.only : undefined;
  if (only) {
    const known = new Set(repairIds());
    const bad = only.filter((id) => !known.has(id));
    if (bad.length) {
      out.write(`aether doctor --fix: unknown repair ${bad.join(", ")}\n`);
      out.write(`available: ${repairIds().join(", ")}\n`);
      return 2;
    }
  }

  const plan = planRepairs(report, options.repairContext ?? {}, only);
  out.write(renderRepairPlan(plan));
  if (!plan.length) return exitCode(report);

  if (flags.dryRun) {
    out.write("\n--dry-run: no change was made.\n");
    return 0;
  }
  if (!flags.yes) {
    // Non-interactive by construction: this command never prompts, so an
    // explicit --yes is the only way a mutation happens.
    out.write("\nRe-run with --yes to apply the plan above.\n");
    return 0;
  }

  let skipped = 0;
  out.write("\n");
  for (const item of plan) {
    const result = applyRepair(item.id, options.repairContext ?? {});
    out.write(`  ${result.applied ? "applied" : "skipped"}  ${result.id}  ${result.detail}\n`);
    if (result.preserved) out.write(`            evidence kept at ${result.preserved}\n`);
    if (!result.applied) skipped += 1;
  }
  return skipped === plan.length ? 1 : 0;
}
