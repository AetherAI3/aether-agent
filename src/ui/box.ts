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
  if (!theme.enabled) return label ?? url;
  return `\x1b]8;;${url}\x1b\\${label ?? url}\x1b]8;;\x1b\\`;
}

// ── Box drawing ──

import { visibleWidth } from "./text.js";

/** ANSI-aware, wide-char-aware visible width (shared util). */
function plainLen(s: string): number {
  return visibleWidth(s);
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

  // Box-drawing glyphs — always Unicode (every modern terminal supports them).
  // Colors are gated by theme.enabled; glyphs are not.
  const tl = "\u250c"; // ┌
  const tr = "\u2510"; // ┐
  const bl = "\u2514"; // └
  const br = "\u2518"; // ┘
  const h  = "\u2500"; // ─
  const v  = "\u2502"; // │

  const top = tl + h.repeat(w - 2) + tr;
  const bot = bl + h.repeat(w - 2) + br;

  let out = theme.cyan(top) + "\n";
  for (const line of lines) {
    const pad = inner - plainLen(line);
    const content = line + " ".repeat(Math.max(0, pad));
    out += theme.cyan(v + "  " + content + "  " + v) + "\n";
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

  const tl = "\u250c";
  const tr = "\u2510";
  const bl = "\u2514";
  const br = "\u2518";
  const h  = "\u2500";
  const v  = "\u2502";

  const border = (s: string): string => theme.cyan(s);

  const top = tl + h.repeat(w - 2) + tr;
  const bot = bl + h.repeat(w - 2) + br;

  let out = border(top) + "\n";

  // Title row
  const titlePad = inner - plainLen(title);
  out += border(v + "  " + theme.bold(title) + " ".repeat(Math.max(0, titlePad)) + "  " + v) + "\n";

  // Separator below title
  out += border(v + " ".repeat(w - 2) + v) + "\n";

  // Content
  for (const line of lines) {
    const pad = inner - plainLen(line);
    const content = line + " ".repeat(Math.max(0, pad));
    out += border(v + "  " + content + "  " + v) + "\n";
  }

  out += border(bot);
  return out;
}
