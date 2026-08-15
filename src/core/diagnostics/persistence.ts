import { accessSync, constants, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { configDir } from "../config.js";
import type { CheckSpec } from "./registry.js";

function nearestExisting(path: string): string {
  let current = resolve(path);
  while (!existsSync(current) && dirname(current) !== current) current = dirname(current);
  return current;
}

export function persistenceChecks(): CheckSpec[] {
  return [
    {
      id: "persistence.local",
      category: "persistence",
      mode: "fast",
      severity: "critical",
      repairId: "repair.config_dir",
      run: () => {
        try {
          accessSync(nearestExisting(configDir()), constants.R_OK | constants.W_OK);
          return { status: "pass" as const, detail: "local persistence root is readable and writable" };
        } catch {
          return { status: "fail" as const, detail: "local persistence root is unavailable — next: aether doctor --fix" };
        }
      },
    },
  ];
}
