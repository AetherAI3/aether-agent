// Startup splash — the AETHER brand (cloud + gradient wordmark) above a compact
// system-status column. The brand is the single source of truth in logo.ts.

import { theme } from "./theme.js";
import { composeBrand } from "./logo.js";

export interface SplashInfo {
  version: string;
  model: string; // current model id, or "auto"
  effort: string; // effort level
}

/** Rotating power-feature tips — one shows per launch. Exported for tests. */
export const TIPS: readonly string[] = [
  "Tab completes /commands",
  "/steer redirects the agent mid-turn",
  "/queue lines up the next task while one runs",
  "Ctrl+→/← jumps words · Ctrl+L clears the screen",
  "↑ recalls history across sessions",
  "Ctrl+C once aborts the turn — twice quits",
];

/** The tip line for slot `i` (wraps). Deterministic — caller picks the slot. */
export function tipLine(i: number): string {
  const tip = TIPS[((i % TIPS.length) + TIPS.length) % TIPS.length]!;
  return theme.dim(`tip: ${tip}`);
}

/** Plain status lines (no art) — exposed for testing the content. */
export function statusLines(info: SplashInfo, tipSlot?: number): string[] {
  return [
    theme.dim(`v${info.version}`),
    `[ ${theme.cyan("/model")} ${info.model} ]  [ ${theme.cyan("/effort")} ${info.effort} ]`,
    theme.dim("/help for commands · /doctor if something's off"),
    tipLine(tipSlot ?? Math.floor(Math.random() * TIPS.length)),
  ];
}

/** The full splash: the brand banner, then the status column beneath it. */
export function renderSplash(info: SplashInfo, tipSlot?: number): string {
  return [...composeBrand(), "", ...statusLines(info, tipSlot)].join("\n");
}
