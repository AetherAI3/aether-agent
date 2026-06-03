// `aether config [show]`            — print current config
// `aether config get <key>`         — print one value
// `aether config set <key> <value>` — set + persist one value

import type { AppContext } from "../core/context.js";
import type { AetherConfig, PermissionMode } from "../types.js";
import { saveConfig } from "../core/config.js";

const BOOL_KEYS = new Set<keyof AetherConfig>(["autoApply", "telemetry"]);
const PERMISSION_MODES: PermissionMode[] = ["ask", "auto", "skip"];

export async function cmdConfig(ctx: AppContext, argv: string[]): Promise<number> {
  const sub = argv[0] ?? "show";

  if (sub === "show") {
    process.stdout.write(JSON.stringify(ctx.cfg, null, 2) + "\n");
    return 0;
  }

  if (sub === "get") {
    const key = argv[1] as keyof AetherConfig | undefined;
    if (!key || !(key in ctx.cfg)) {
      process.stderr.write("usage: aether config get <key>\n");
      return 2;
    }
    process.stdout.write(String(ctx.cfg[key]) + "\n");
    return 0;
  }

  if (sub === "set") {
    const key = argv[1] as keyof AetherConfig | undefined;
    const value = argv[2];
    if (!key || value === undefined || !(key in ctx.cfg)) {
      process.stderr.write("usage: aether config set <key> <value>\n");
      return 2;
    }
    if (key === "permissionMode") {
      if (!PERMISSION_MODES.includes(value as PermissionMode)) {
        process.stderr.write(`permissionMode must be one of: ${PERMISSION_MODES.join(", ")}\n`);
        return 2;
      }
      ctx.cfg.permissionMode = value as PermissionMode;
    } else if (BOOL_KEYS.has(key)) {
      (ctx.cfg[key] as boolean) = value === "true" || value === "1";
    } else {
      (ctx.cfg[key] as string) = value;
    }
    saveConfig(ctx.cfg);
    process.stdout.write(`${key} → ${String(ctx.cfg[key])}\n`);
    return 0;
  }

  process.stderr.write("usage: aether config [show|get <key>|set <key> <value>]\n");
  return 2;
}
