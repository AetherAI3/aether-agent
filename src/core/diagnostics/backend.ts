import { MODELS_PATH } from "../transport.js";
import { bounded } from "../mcp_diagnostics.js";
import type { CheckSpec } from "./registry.js";

export function backendChecks(): CheckSpec[] {
  return [
    {
      id: "backend.catalog",
      category: "backend",
      mode: "network",
      severity: "warning",
      run: async (deps) => {
        try {
          await bounded(deps.ctx.api.getJson(MODELS_PATH), deps.timeoutMs);
          return { status: "pass" as const, detail: "bounded catalog request succeeded", reachable: true };
        } catch {
          return { status: "warn" as const, detail: "backend catalog unavailable — next: check network or aether auth status" };
        }
      },
    },
    {
      id: "backend.capabilities",
      category: "backend",
      mode: "network",
      severity: "info",
      run: async (deps) => {
        if (!deps.apiProbe) {
          return { status: "skip" as const, detail: "no capability probe configured" };
        }
        try {
          const contract = await bounded(deps.apiProbe(), deps.timeoutMs);
          deps.capability.value = { version: contract.version, digest: contract.digest };
          return {
            status: "pass" as const,
            detail: "capability contract v" + contract.version,
            reachable: true,
          };
        } catch {
          return { status: "warn" as const, detail: "capability manifest unavailable" };
        }
      },
    },
  ];
}
