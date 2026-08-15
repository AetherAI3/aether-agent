import { isCredentialSafeUrl } from "../transport.js";
import type { CheckSpec } from "./registry.js";

export function transportChecks(): CheckSpec[] {
  return [
    {
      id: "configuration.transport",
      category: "configuration",
      mode: "fast",
      severity: "critical",
      run: (deps) => {
        const safe = isCredentialSafeUrl(deps.ctx.cfg.baseUrl);
        return {
          status: safe ? ("pass" as const) : ("fail" as const),
          detail: safe ? "backend URL transport is credential-safe" : "backend URL transport is unsafe",
        };
      },
    },
  ];
}
