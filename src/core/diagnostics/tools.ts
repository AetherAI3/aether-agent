import { gateActionFor } from "../autonomy.js";
import { validateToolDefinitionCoverage } from "../tool_registry.js";
import type { CheckSpec } from "./registry.js";

export function toolsChecks(): CheckSpec[] {
  return [
    {
      id: "tools.schemas",
      category: "tools",
      mode: "fast",
      severity: "critical",
      run: () => {
        const errors = validateToolDefinitionCoverage();
        return {
          status: errors.length ? ("fail" as const) : ("pass" as const),
          detail: errors.length ? "tool schema coverage incomplete" : "all protocol tools have schemas",
        };
      },
    },
    {
      id: "tools.gates",
      category: "tools",
      mode: "fast",
      severity: "critical",
      run: () => {
        const valid =
          gateActionFor("write_file") === "write" &&
          gateActionFor("run_shell") === "shell" &&
          gateActionFor("run_tests") === "shell" &&
          gateActionFor("git_commit") === "shell" &&
          gateActionFor("web_search") === "network" &&
          gateActionFor("web_fetch") === "network" &&
          gateActionFor("read_file") === null;
        return {
          status: valid ? ("pass" as const) : ("fail" as const),
          detail: valid ? "side-effect gates are fail-closed" : "tool gate mapping drifted",
        };
      },
    },
  ];
}
