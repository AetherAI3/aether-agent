// aether doctor — structured diagnostics plus safe repair.
//
// `--json` stays v1-shaped by default for existing consumers; pass
// `--schema v2` for the native report. `--deep` remains an alias of
// `--network`. `--fix` prints a dry-run plan; `--fix --yes` applies it.

import { writeFileSync } from "node:fs";
import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import {
  doctorReportV2,
  toV1Report,
  renderDoctorJUnit,
  renderDoctorReport,
  type DiagnosticDependencies,
  type DoctorReportV2,
} from "../core/diagnostics.js";
import { executeRepairs, planRepairs, repairReceiptsPath } from "../core/diagnostics/repair.js";

export interface DoctorCommandOptions {
  out?: Writable;
  dependencies?: DiagnosticDependencies;
  deep?: boolean;
  network?: boolean;
  live?: boolean;
  failed?: boolean;
  fix?: boolean;
  yes?: boolean;
  schema?: string;
  category?: string;
  junit?: string;
}

const USAGE =
  "usage: aether doctor [--network|--deep] [--live] [--category a,b] [--failed]\n" +
  "                     [--junit <path>] [--schema v1|v2] [--fix [--yes]] [--json]\n" +
  "  --json emits the v1 report shape unless --schema v2 is passed\n" +
  "  --live drives one synthetic dev session end to end (no model call, zero UVT)\n";

/** Parse slash/CLI tokens on top of pre-parsed options; null = usage error. */
function parseDoctorArgv(argv: string[], base: DoctorCommandOptions): DoctorCommandOptions | null {
  const opts = { ...base };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const valueOf = (flag: string): string | undefined =>
      arg.startsWith(flag + "=") ? arg.slice(flag.length + 1) : argv[++index];
    if (arg === "deep" || arg === "--deep" || arg === "network" || arg === "--network") opts.network = true;
    else if (arg === "--live" || arg === "live") opts.live = true;
    else if (arg === "--failed" || arg === "failed") opts.failed = true;
    else if (arg === "--fix" || arg === "fix") opts.fix = true;
    else if (arg === "--yes" || arg === "-y") opts.yes = true;
    else if (arg === "--schema" || arg.startsWith("--schema=")) opts.schema = valueOf("--schema");
    else if (arg === "--category" || arg.startsWith("--category=")) opts.category = valueOf("--category");
    else if (arg === "--junit" || arg.startsWith("--junit=")) opts.junit = valueOf("--junit");
    else return null;
  }
  return opts;
}

function runFix(ctx: AppContext, out: Writable, opts: DoctorCommandOptions): number {
  const now = opts.dependencies?.now ?? new Date().toISOString();
  const plans = planRepairs(now);
  if (plans.length === 0) {
    out.write("nothing to repair.\n");
    return 0;
  }
  out.write("repair plan (" + plans.length + " target(s)):\n");
  for (const plan of plans) {
    out.write(
      "  " + plan.repairId + " [" + plan.targetClass + "]: " + plan.detail + "\n" +
      "    target: " + plan.target + "\n" +
      (plan.backupPath ? "    backup: " + plan.backupPath + "\n" : ""),
    );
  }
  const apply = opts.yes === true || ctx.flags.yes;
  if (!apply) {
    out.write("dry run — re-run with --fix --yes to apply.\n");
    return 0;
  }
  const outcomes = executeRepairs(plans, now);
  let failed = 0;
  for (const outcome of outcomes) {
    if (outcome.verified) {
      out.write("  ✓ " + outcome.plan.repairId + ": " + outcome.plan.target + " repaired\n");
    } else {
      failed += 1;
      out.write(
        "  ✗ " + outcome.plan.repairId + ": " + outcome.plan.target +
        (outcome.rolledBack ? " — verify failed, rolled back" : " — repair failed") + "\n",
      );
    }
  }
  out.write("receipts: " + repairReceiptsPath() + "\n");
  return failed > 0 ? 1 : 0;
}

export async function cmdDoctor(
  ctx: AppContext,
  argv: string[] = [],
  options: DoctorCommandOptions = {},
): Promise<number> {
  const out = options.out ?? process.stdout;
  const opts = parseDoctorArgv(argv, options);
  if (!opts) {
    out.write(USAGE);
    return 2;
  }
  const schema = (opts.schema ?? "v1").toLowerCase();
  if (schema !== "v1" && schema !== "1" && schema !== "v2" && schema !== "2") {
    out.write(USAGE);
    return 2;
  }

  if (opts.fix) return runFix(ctx, out, opts);

  if (opts.live) {
    const { runLiveProbe } = await import("../core/diagnostics/dev_session_live.js");
    out.write("Aether Doctor v2 · live (synthetic — no model call, zero UVT)\n\n");
    const probe = await runLiveProbe(ctx.api);
    for (const stepResult of probe.steps) {
      out.write("  " + (stepResult.ok ? "✓" : "✗") + " " + stepResult.id.padEnd(20) + stepResult.detail + "\n");
    }
    out.write("\n" + (probe.ok ? "live probe verified" : "live probe FAILED") + "\n");
    if (ctx.flags.json) out.write(JSON.stringify({ schema_version: 2, mode: "live", ...probe }) + "\n");
    return probe.ok ? 0 : 1;
  }

  const mode = opts.network === true || opts.deep === true ? "network" : "fast";
  const categories = (opts.category ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  const report = await doctorReportV2(
    ctx,
    { mode, ...(categories.length ? { categories } : {}) },
    opts.dependencies,
  );

  if (opts.junit) writeFileSync(opts.junit, renderDoctorJUnit(report), "utf8");

  // --failed narrows the emitted checks; the summary (and exit code) still
  // reflect the full run so a filtered view never hides a failure count.
  const emitted: DoctorReportV2 = opts.failed
    ? { ...report, checks: report.checks.filter((check) => check.status === "warn" || check.status === "fail") }
    : report;

  if (ctx.flags.json) {
    const payload = schema === "v2" || schema === "2" ? emitted : toV1Report(emitted);
    out.write(JSON.stringify(payload) + "\n");
  } else {
    out.write(renderDoctorReport(emitted));
  }
  return report.summary.fail > 0 ? 1 : 0;
}
