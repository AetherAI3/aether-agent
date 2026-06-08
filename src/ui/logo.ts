// src/ui/logo.ts — the AETHER wordmark + cloud, fused into one brand banner.
// A static 5-row block "AETHER" with an ice→cyan truecolor gradient, set beside
// the existing cloud glyph so the two read as a single logo. oh-my-logo's figlet
// renderer is ported down to this static banner: no runtime font load, instant
// cold start, dependency-free OSS tree. Narrow terminals collapse to a one-line
// wordmark so the header never wraps into garbage.

import { theme } from "./theme.js";
import { gradientBlock, type Rgb } from "./gradient.js";

const ICE: Rgb = [135, 215, 255]; // #87d7ff — matches theme.iceBlue (256-color 117)
const CYAN: Rgb = [26, 166, 183]; // #1aa6b7 — Aether cyan

// The cloud glyph (kept here so brand + splash share one source).
export const CLOUD = [
  "   ▄▄███▄▄   ",
  "  ▄█████████▄ ",
  "  ███▄███▄███ ",
  "  ▀████▄████▀ ",
  "    ▀ ▀ ▀ ▀   ",
];

// 5-row block "AETHER" (ANSI-Shadow style). Each row is a literal string.
const WORDMARK = [
  " █████  ███████ ████████ ██   ██ ███████ ██████  ",
  "██   ██ ██         ██    ██   ██ ██      ██   ██ ",
  "███████ █████      ██    ███████ █████   ██████  ",
  "██   ██ ██         ██    ██   ██ ██      ██   ██ ",
  "██   ██ ███████    ██    ██   ██ ███████ ██   ██ ",
];

const GAP = "  ";
export const BRAND_WIDTH = CLOUD[1]!.length + GAP.length + WORDMARK[0]!.length;
const NARROW_FALLBACK_COLS = BRAND_WIDTH + 2;

/** The gradient AETHER wordmark rows (5). */
export function aetherWordmark(enabled = theme.enabled): string[] {
  return gradientBlock(WORDMARK, ICE, CYAN, enabled);
}

export interface BrandOpts {
  enabled?: boolean;
  cols?: number;
}

/** The full brand: cloud (ice-blue) beside the gradient AETHER, 5 rows.
 * Collapses to a single compact line when the terminal is too narrow. */
export function composeBrand(opts: BrandOpts = {}): string[] {
  const enabled = opts.enabled ?? theme.enabled;
  const cols = opts.cols ?? (process.stdout.columns || 100);
  if (cols < NARROW_FALLBACK_COLS) {
    const mark = gradientBlock(["AETHER"], ICE, CYAN, enabled)[0]!;
    return [`${theme.iceBlue("☁")} ${mark} ${theme.dim("code")}`];
  }
  const word = aetherWordmark(enabled);
  const out: string[] = [];
  for (let i = 0; i < CLOUD.length; i++) {
    out.push(`${theme.iceBlue(CLOUD[i] ?? "")}${GAP}${word[i] ?? ""}`);
  }
  return out;
}
