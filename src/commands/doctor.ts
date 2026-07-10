import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import {
  diagnosticReport,
  renderDiagnosticReport,
  type DiagnosticDependencies,
} from "../core/diagnostics.js";

export interface DoctorCommandOptions {
  out?: Writable;
  dependencies?: DiagnosticDependencies;
  deep?: boolean;
}

export async function cmdDoctor(
  ctx: AppContext,
  argv: string[] = [],
  options: DoctorCommandOptions = {},
): Promise<number> {
  const unknown = argv.filter((arg) => arg !== "deep" && arg !== "--deep");
  if (unknown.length) {
    (options.out ?? process.stdout).write("usage: aether doctor [--deep] [--json]\n");
    return 2;
  }
  const deep = options.deep === true || argv.includes("deep") || argv.includes("--deep");
  const report = await diagnosticReport(ctx, deep, options.dependencies);
  const out = options.out ?? process.stdout;
  out.write(ctx.flags.json ? JSON.stringify(report) + "\n" : renderDiagnosticReport(report));
  return report.summary.fail > 0 ? 1 : 0;
}
