// src/ui/box.ts — ANSI box-drawing utility.
//
// Draws bordered panels for terminal UI. Zero dependencies, respects
// NO_COLOR (https://no-color.org), non-TTY (pipes), and narrow terminals.
//
// Coexists with src/ui/theme.ts: the box border uses the theme color;
// additional accent colors (orange, green, etc.) are defined here for
// use by commands that need per-model or per-brand coloring.

// ── Re-export common theme helpers ──
export { theme, stripAnsi, createTheme } from "./theme.js";
import { theme } from "./theme.js";

// ── Accent colors (not part of the core theme, used by commands) ──

const wrapper = (code: string): ((s: string) => string) => {
  return theme.enabled
    ? (s: string): string => `\x1b[${code}m${s}\x1b[0m`
    : (s: string): string => s;
};

/** Orange — for Claude brand. ANSI 256-color 208. */
export const orange = wrapper("38;5;208");

/** Green — for GPT brand. ANSI 256-color 46. */
export const green = wrapper("38;5;46");

/** Dark blue — for DeepSeek brand. ANSI 256-color 27. */
export const darkBlue = wrapper("38;5;27");

/** Bright white — for Kimi brand. ANSI 256-color 15. */
export const brightWhite = wrapper("38;5;15");

/** Light blue — for Gemma brand. ANSI 256-color 81. */
export const lightBlue = wrapper("38;5;81");

// ── OSC 8 hyperlink ──

/**
 * Emit a terminal hyperlink via OSC 8.
 * Modern terminals (iTerm2, Windows Terminal, Kitty, WezTerm, VS Code,
 * Warp, Ghostty) render this as a clickable link.
 * Falls back to visible URL text in non-supporting terminals.
 *
 * @param url      The target URL (https://...).
 * @param label    Optional visible label. Defaults to the URL itself.
 */
export function hyperlink(url: string, label?: string): string {
  const safeUrl = sanitizeTerm(url);
  const safeLabel = sanitizeTerm(label ?? url);
  if (!theme.enabled) return safeLabel;
  return `\x1b]8;;${safeUrl}\x1b\\${safeLabel}\x1b]8;;\x1b\\`;
}

// ── Box drawing ──

import { sanitizeTerm, visibleWidth } from "./text.js";

/** ANSI-aware, wide-char-aware visible width (shared util). */
function plainLen(s: string): number {
  return visibleWidth(s);
}

// Box-drawing glyphs — always Unicode (every modern terminal supports them).
// Colors are gated by theme.enabled; glyphs are not. Shared by box() and
// titledBox() so the glyph set and frame construction aren't duplicated.
const BOX_TL = "┌"; // ┌
const BOX_TR = "┐"; // ┐
const BOX_BL = "└"; // └
const BOX_BR = "┘"; // ┘
const BOX_H  = "─"; // ─
const BOX_V  = "│"; // │

/** Build a horizontal border row (top or bottom) of width `w`. */
function boxBorderRow(left: string, right: string, w: number): string {
  return left + BOX_H.repeat(w - 2) + right;
}

/** Build a single "│  content  │" row, padded to `inner` width. */
function boxContentRow(content: string, inner: number): string {
  const pad = inner - plainLen(content);
  return BOX_V + "  " + content + " ".repeat(Math.max(0, pad)) + "  " + BOX_V;
}

/**
 * Draw a bordered box around `lines` (no title).
 *
 * @param lines  Content lines, each rendered as-is between "│  " and "  │".
 *               ANSI escapes are accounted for in width math.
 * @param width  Desired box width. Default: 64. Content will be right-padded.
 *               If `width` is wider than all lines, the box is uniform.
 *               If a line exceeds `width - 4`, it may wrap visually
 *               (caller's responsibility to keep lines short enough).
 * @returns      The box as a single string (newline-terminated lines).
 */
export function box(
  lines: string[],
  opts?: { width?: number },
): string {
  const w = opts?.width ?? 64;
  // inner content width: total width (w) minus 6 chars of framing
  // (border + 2-space left pad + 2-space right pad + border = 6)
  const inner = w - 6;

  const top = boxBorderRow(BOX_TL, BOX_TR, w);
  const bot = boxBorderRow(BOX_BL, BOX_BR, w);

  let out = theme.cyan(top) + "\n";
  for (const line of lines) {
    out += theme.cyan(boxContentRow(line, inner)) + "\n";
  }
  out += theme.cyan(bot);
  return out;
}

/**
 * Draw a titled box — a decorated header row above the standard box.
 *
 * @param lines  Content lines (same as `box()`).
 * @param title  Title text, rendered bold between "│  " and "  │".
 * @param width  Desired box width. Default: 64.
 */
export function titledBox(
  lines: string[],
  title: string,
  opts?: { width?: number },
): string {
  const w = opts?.width ?? 64;
  const inner = w - 6;

  const border = (s: string): string => theme.cyan(s);

  const top = boxBorderRow(BOX_TL, BOX_TR, w);

  let out = border(top) + "\n";

  // Title row
  out += border(
    BOX_V + "  " + theme.bold(title) + " ".repeat(Math.max(0, inner - plainLen(title))) + "  " + BOX_V,
  ) + "\n";

  // Separator below title
  out += border(BOX_V + " ".repeat(w - 2) + BOX_V) + "\n";

  // Content + bottom border, delegated to box() to avoid duplicating the
  // frame/content rendering.
  out += box(lines, { width: w }).split("\n").slice(1).join("\n");

  return out;
}
