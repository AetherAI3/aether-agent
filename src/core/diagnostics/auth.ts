import type { CheckSpec } from "./registry.js";

export function authChecks(): CheckSpec[] {
  return [
    {
      id: "authentication",
      category: "auth",
      mode: "fast",
      severity: "warning",
      run: async (deps) => {
        const configured = Boolean(await deps.ctx.tokens.get());
        return {
          status: configured ? ("pass" as const) : ("warn" as const),
          detail: configured ? "credential configured" : "signed out — next: aether auth login",
          configured,
        };
      },
    },
  ];
}
