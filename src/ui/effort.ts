// Effort tiers — the depth dial for aether code, shared with the AetherCloud
// backend: the picked tier persists in the Aether config and rides the
// existing TaskCommand.effort field to the cloud brain (no wire change).
// Rendered as a slider in the REPL; CODEPRO gets the full banner.

import { theme } from "./theme.js";
import { KAOMOJI } from "./kaomoji.js";

export const EFFORT_TIERS = ["LOW", "MED", "MAX", "ULTRA", "CODEPRO"] as const;
export type EffortTier = (typeof EFFORT_TIERS)[number];

/** Accepts a tier name (any case) or a 1-based index; null if unrecognized. */
export function normalizeEffort(input: string): EffortTier | null {
  const t = input.trim().toUpperCase();
  if (!t) return null;
  const byName = EFFORT_TIERS.find((x) => x === t);
  if (byName) return byName;
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= EFFORT_TIERS.length) return EFFORT_TIERS[n - 1] ?? null;
  return null;
}

const SEG = 8; // track cells between stops
const TRACK_LEN = SEG * (EFFORT_TIERS.length - 1) + 1; // 33

/**
 * The effort slider — three lines for the transcript:
 *
 *   effort ▸ MAX
 *   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓●░░░░░░░░░░░░░░░░
 *   LOW     MED     MAX     ULTRA   CODEPRO
 *
 * Unset/unknown current renders the knob parked at LOW with a "default" tag.
 * CODEPRO fills the whole track and swaps the knob for ⚡.
 */
export function renderEffortSlider(current: string): string[] {
  const tier = normalizeEffort(current);
  const idx = tier ? EFFORT_TIERS.indexOf(tier) : 0;
  const pos = idx * SEG;
  const pro = tier === "CODEPRO";

  const title = `  effort ${theme.cyan("▸")} ${theme.bold(theme.cyan(tier ?? "default"))}`;

  let track = "  ";
  for (let i = 0; i < TRACK_LEN; i++) {
    if (i === pos) track += pro ? theme.yellow("⚡") : theme.bold(theme.cyan("●"));
    else if (i < pos) track += theme.cyan("▓");
    else track += theme.muted("░");
  }

  let labels = "  ";
  EFFORT_TIERS.forEach((name, i) => {
    const seg = i < EFFORT_TIERS.length - 1 ? name.padEnd(SEG) : name;
    labels += i === idx && tier ? theme.bold(theme.cyan(seg)) : theme.dim(seg);
  });

  return [title, track, labels];
}

// Block-letter CODEPRO — kept ≤ 80 cols, no combining chars (width-safe).
const CODEPRO_ART = [
  " ▄████▄  ▄████▄  ██████▄  ██████  ██████▄  ██████▄   ▄████▄",
  "██    ▀ ██    ██ ██    ██ ██      ██    ██ ██    ██ ██    ██",
  "██      ██    ██ ██    ██ █████   ██████▀  ██████▀  ██    ██",
  "██    ▄ ██    ██ ██    ██ ██      ██       ██   ██  ██    ██",
  " ▀████▀  ▀████▀  ██████▀  ██████  ██       ██   ▀█▄  ▀████▀",
];

/** The CODEPRO moment: full banner, rendered when the dial hits the top. */
export function renderCodeProArt(): string[] {
  const rule = theme.yellow("⚡") + theme.dim(" " + "━".repeat(58) + " ") + theme.yellow("⚡");
  const art = CODEPRO_ART.map((row) => theme.iceBlue(row));
  const tag = `   ${theme.cyan(KAOMOJI.active)}  ${theme.bold("CODEPRO engaged")}${theme.dim(" — maximum depth · every pass, every gate")}`;
  return ["", rule, ...art, rule, tag, ""];
}
