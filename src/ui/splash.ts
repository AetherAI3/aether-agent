// Startup splash — the Aether cloud (left) + system status column (right),
// status vertically centered against the art.

import { theme } from "./theme.js";

const CLOUD = [
  "   ▄▄███▄▄   ",
  "  ▄█████████▄ ",
  "  ███▄███▄███ ",
  "  ▀████▄████▀ ",
  "    ▀ ▀ ▀ ▀   ",
];

export interface SplashInfo {
  version: string;
  model: string; // current model id, or "auto"
  effort: string; // effort level
}

/** Plain status lines (no art) — exposed for testing the content. Every
 * slash token shown here must exist in the command registry (pinned by test):
 * the splash advertises only commands that actually run. */
export function statusLines(info: SplashInfo): string[] {
  return [
    theme.bold(theme.cyan("AETHER CODE")),
    theme.dim(`v${info.version}`),
    `[ ${theme.cyan("/model")} - ${info.model} ]  [ effort · ${info.effort} ]`,
    theme.dim("/help for commands · need to fix aether code? run /doctor"),
  ];
}

/** The full splash: cloud art beside the status column. */
export function renderSplash(info: SplashInfo): string {
  const status = statusLines(info);
  const offset = Math.max(0, Math.floor((CLOUD.length - status.length) / 2));
  const gap = "  ";
  const out: string[] = [];
  for (let i = 0; i < CLOUD.length; i++) {
    const art = theme.iceBlue(CLOUD[i] ?? "");
    const si = i - offset;
    const right = si >= 0 && si < status.length ? status[si] : "";
    out.push(`${art}${gap}${right ?? ""}`.replace(/\s+$/, ""));
  }
  return out.join("\n");
}
