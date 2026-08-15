import { collectMcpDiagnostics } from "../mcp_diagnostics.js";
import type { CheckSpec } from "./registry.js";

export function mcpChecks(): CheckSpec[] {
  return [
    {
      id: "mcp.registry",
      category: "mcp",
      mode: "fast",
      severity: "warning",
      run: (deps) => {
        const state = deps.mcpStore.inspect();
        const status =
          state.status === "corrupt" || state.status === "unreadable"
            ? ("fail" as const)
            : state.status === "missing"
              ? ("warn" as const)
              : ("pass" as const);
        return {
          status,
          detail:
            "local MCP registry " +
            state.status +
            (status === "fail" ? " — next: aether mcp repair" : ""),
        };
      },
    },
    {
      id: "mcp.broker",
      category: "mcp",
      mode: "network",
      severity: "warning",
      run: async (deps) => {
        const report = await collectMcpDiagnostics(deps.mcpClient, deps.mcpStore, {
          timeoutMs: deps.timeoutMs,
          includeToolCounts: true,
          ...(deps.now != null ? { now: deps.now } : {}),
        });
        const available = report.brokerStatus === "available";
        return {
          status: available ? ("pass" as const) : ("warn" as const),
          detail: available ? report.providers.length + " provider(s) diagnosed" : "broker unavailable",
          reachable: available,
        };
      },
    },
  ];
}
