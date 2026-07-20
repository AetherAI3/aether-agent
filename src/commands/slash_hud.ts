// In-REPL HUD slash commands: /add /hud. Split out of slash.ts (was 1807
// lines) to keep each command group under the repo's ~800-line file
// convention.

import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import { theme } from "../ui/theme.js";
import { getRegistry, type ContextRegistry } from "../core/context_registry.js";
import {
  HUD_ELEMENTS, resolveHudElement,
  renderHud, timerLive,
  type HudRenderState,
} from "../core/hud.js";

export async function addSlash(_ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const input = arg.trim().toLowerCase();

  if (!input || input === "list" || input === "ls") {
    const reg = getRegistry();
    const active = new Set(reg.hudElements);
    out.write(theme.iceBlue("Available HUD elements:\n"));
    out.write(theme.dim("──────────────────────────────────────────────────────\n"));
    const sorted = Object.values(HUD_ELEMENTS).sort((a, b) => a.priority - b.priority);
    for (const def of sorted) {
      const mark = active.has(def.id) ? theme.cyan("●") : "○";
      const aliases = def.aliases.length ? theme.dim("  aka: " + def.aliases.join(", ")) : "";
      out.write(`  ${mark} ${theme.bold(def.label)}${aliases}\n`);
      out.write(`    ${theme.dim(def.description)}\n`);
    }
    out.write("\n" + theme.dim("Usage: /add <element>     /hud remove <element>     /hud clear\n"));
    return;
  }

  const resolved = resolveHudElement(input);
  if (!resolved) {
    out.write(`unknown HUD element: "${arg.trim()}".  /add list to see available.\n`);
    return;
  }

  const reg = getRegistry();
  if (reg.hasHudElement(resolved)) {
    out.write(theme.dim(`HUD already active: ${HUD_ELEMENTS[resolved].label}.  /hud remove ${resolved} to remove.\n`));
    return;
  }

  const added = reg.addHudElement(resolved);
  if (!added) {
    out.write(theme.dim(`${HUD_ELEMENTS[resolved].label} is already active.\n`));
    return;
  }

  const def = HUD_ELEMENTS[resolved];
  out.write(theme.cyan("✓") + ` HUD: ${theme.bold(def.label)} added\n`);
  out.write(theme.dim(`  ${def.description}\n`));

  if (process.stdout.isTTY) {
    const cols = process.stdout.columns ?? 80;
    const state = buildHudState(reg);
    const preview = renderHud(reg.hudElements, state, cols);
    if (preview) out.write("\n" + preview + "\n");
  }
}

export async function hudSlash(_ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.trim().split(/\s+/);
  const sub = (parts[0] ?? "").toLowerCase();
  const target = parts.slice(1).join(" ").trim();
  const reg = getRegistry();

  switch (sub) {
    case "remove":
    case "rm":
    case "del":
    case "delete": {
      if (!target) {
        out.write("usage: /hud remove <element>\n");
        if (reg.hudElements.length > 0) {
          out.write(theme.dim("active: " + reg.hudElements.map((id) => HUD_ELEMENTS[id].label).join(", ") + "\n"));
        }
        return;
      }
      const resolved = resolveHudElement(target);
      if (!resolved) {
        out.write(`unknown HUD element: "${target}".  /hud list to see active.\n`);
        return;
      }
      if (!reg.hasHudElement(resolved)) {
        out.write(theme.dim(`${HUD_ELEMENTS[resolved].label} is not active.\n`));
        return;
      }
      reg.removeHudElement(resolved);
      out.write(theme.cyan("✓") + ` HUD: ${theme.bold(HUD_ELEMENTS[resolved].label)} removed\n`);
      break;
    }
    case "clear":
    case "reset": {
      const count = reg.hudElements.length;
      if (count === 0) {
        out.write(theme.dim("HUD is already clear.\n"));
        return;
      }
      reg.clearHud();
      out.write(theme.cyan("✓") + ` HUD cleared (${count} element${count !== 1 ? "s" : ""} removed)\n`);
      break;
    }
    case "list":
    case "ls":
    case "show":
    case "": {
      if (reg.hudElements.length === 0) {
        out.write(theme.dim("HUD is empty.  /add <element> to add one.  /add list to see available.\n"));
        return;
      }
      out.write(theme.iceBlue("Active HUD elements:\n"));
      out.write(theme.dim("──────────────────────────────────────────────────────\n"));
      for (const id of reg.hudElements) {
        const def = HUD_ELEMENTS[id];
        out.write(`  ${theme.cyan("●")} ${theme.bold(def.label)}  ${theme.dim("(" + def.aliases.join(", ") + ")")}\n`);
      }
      if (process.stdout.isTTY) {
        const cols = process.stdout.columns ?? 80;
        const state = buildHudState(reg);
        const preview = renderHud(reg.hudElements, state, cols);
        if (preview) out.write("\n" + preview + "\n");
      }
      break;
    }
    default:
      out.write("usage: /hud remove <element>  |  /hud list  |  /hud clear\n");
      break;
  }
}

function buildHudState(reg: ContextRegistry): HudRenderState {
  const live = timerLive(reg.hudTimer);
  return {
    tokensUsed: reg.uvtSpent,
    tokensCap: reg.uvtCap ?? 1_000_000_000,
    sessionMs: live.userMs + live.agentMs,
    timer: reg.hudTimer,
    streamedTokens: 0,
    uvtUsed: reg.uvtSpent,
    uvtCap: reg.uvtCap ?? 0,
  };
}
