import { localMemoryReport } from "../memory.js";
import type { CheckSpec } from "./registry.js";

export function memoryChecks(): CheckSpec[] {
  return [
    {
      id: "memory.health",
      category: "memory",
      mode: "fast",
      severity: "warning",
      run: (deps) => {
        const report = localMemoryReport(deps.ctx.flags.cwd, undefined, deps.memoryRoots, deps.now);
        const sources = report.tiers.flatMap((tier) => tier.sources);
        const failed = sources.some((source) => source.status === "degraded");
        const unscoped = sources.reduce((sum, source) => sum + source.unscoped, 0);
        return {
          status: failed ? ("warn" as const) : ("pass" as const),
          detail:
            (failed ? "one or more stores are degraded; " : "") +
            unscoped +
            " legacy unscoped record(s), never auto-injected",
        };
      },
    },
  ];
}
