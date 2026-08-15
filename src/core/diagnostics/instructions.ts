// Instruction-graph checks — fast-mode, filesystem-only, metadata-only.

import type { CheckSpec } from "./registry.js";

export function instructionsChecks(): CheckSpec[] {
  return [
    {
      id: "instructions.graph",
      category: "instructions",
      mode: "fast",
      severity: "warning",
      run: (deps) => {
        const graph = deps.instructionGraph();
        const parseWarnings =
          graph.sources.reduce(
            (sum, source) => sum + source.warnings.length + (source.parseStatus === "ok" ? 0 : 1),
            0,
          ) + graph.skipped.length;
        return {
          status: parseWarnings ? ("warn" as const) : ("pass" as const),
          detail:
            graph.sources.length +
            " instruction source(s), " +
            parseWarnings +
            " parse warning(s)" +
            (parseWarnings ? " — next: review flagged instruction files" : ""),
        };
      },
    },
    {
      id: "instructions.conflicts",
      category: "instructions",
      mode: "fast",
      severity: "warning",
      run: (deps) => {
        const graph = deps.instructionGraph();
        if (graph.conflicts.length === 0) {
          return { status: "pass" as const, detail: "no instruction conflicts detected" };
        }
        const topics = graph.conflicts.map((conflict) => conflict.topic).join(", ");
        return {
          status: "warn" as const,
          detail:
            graph.conflicts.length +
            " conflict(s): " +
            topics +
            " — next: align the higher-precedence source",
        };
      },
    },
  ];
}
