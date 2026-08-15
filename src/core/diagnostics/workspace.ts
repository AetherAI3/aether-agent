import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CheckSpec } from "./registry.js";

export function workspaceChecks(): CheckSpec[] {
  return [
    {
      id: "workspace.directory",
      category: "workspace",
      mode: "fast",
      severity: "critical",
      run: (deps) => {
        const target = resolve(deps.ctx.flags.cwd);
        const valid = existsSync(target) && statSync(target).isDirectory();
        return {
          status: valid ? ("pass" as const) : ("fail" as const),
          detail: valid ? "workspace directory available" : "workspace directory unavailable",
        };
      },
    },
    {
      id: "workspace.git",
      category: "workspace",
      mode: "fast",
      severity: "info",
      run: (deps) => {
        const isGit = existsSync(join(deps.ctx.flags.cwd, ".git"));
        return {
          status: isGit ? ("pass" as const) : ("warn" as const),
          detail: isGit ? "git metadata detected" : "workspace is not a git checkout",
        };
      },
    },
  ];
}
