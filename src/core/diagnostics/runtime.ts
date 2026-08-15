import type { CheckSpec } from "./registry.js";

export function runtimeChecks(): CheckSpec[] {
  return [
    {
      id: "runtime.node",
      category: "runtime",
      mode: "fast",
      severity: "critical",
      run: () => {
        // Must track package.json's engines.node — this project's own test
        // script needs Node 24 (`--test --test-isolation` support).
        const MIN_SUPPORTED_NODE_MAJOR = 24;
        const major = Number(process.versions.node.split(".")[0]);
        return {
          status: major >= MIN_SUPPORTED_NODE_MAJOR ? ("pass" as const) : ("fail" as const),
          detail:
            major >= MIN_SUPPORTED_NODE_MAJOR
              ? "Node runtime supported"
              : `Node ${MIN_SUPPORTED_NODE_MAJOR} or newer required`,
        };
      },
    },
  ];
}
