// Startup splash — the AETHER brand (cloud + gradient wordmark) above a compact
// system-status column. The brand is the single source of truth in logo.ts.

import { theme } from "./theme.js";
import { composeBrand } from "./logo.js";

export interface SplashInfo {
  version: string;
  model: string; // current model id, or "auto"
  effort: string; // effort level
}

/** Plain status lines (no art) — exposed for testing the content. */
export function statusLines(info: SplashInfo): string[] {
  return [
    theme.dim(`v${info.version}`),
    `[ ${theme.cyan("/model")} ${info.model} ]  [ ${theme.cyan("/effort")} ${info.effort} ]`,
    theme.dim("/help for commands · /doctor if something's off"),
  ];
}

/** The full splash: the brand banner, then the status column beneath it. */
export function renderSplash(info: SplashInfo): string {
  return [...composeBrand(), "", ...statusLines(info)].join("\n");
}
