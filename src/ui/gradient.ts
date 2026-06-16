// src/ui/gradient.ts — truecolor horizontal gradient renderer.
//
// Interpolates an RGB start→end color across the visible columns of each
// line. Iterates CODE POINTS (never UTF-16 units — a surrogate-pair emoji
// split in two and separated by SGR bytes renders as mojibake) and positions
// the gradient by display width so wide chars don't compress the ramp.
// Emits one SGR per colored char and a single trailing reset per line.
// Falls back to plain text when color is disabled (NO_COLOR / non-TTY) so
// the output is always safe for pipes and CI logs.

import { charWidth, visibleWidth } from "./text.js";

/** An [R, G, B] triple in 0-255 range. */
export type Rgb = [number, number, number];

function colorize(line: string, from: Rgb, to: Rgb, span: number): string {
  let out = "";
  let pos = 0;
  let colored = false;
  for (const ch of line) {
    const w = charWidth(ch.codePointAt(0)!);
    if (ch === " ") {
      // Padding stays plain — colored spaces highlight in some terminals.
      out += ch;
      pos += w;
      continue;
    }
    const t = span <= 1 ? 0 : Math.min(1, pos / (span - 1));
    const r = Math.round(from[0] + (to[0] - from[0]) * t);
    const g = Math.round(from[1] + (to[1] - from[1]) * t);
    const b = Math.round(from[2] + (to[2] - from[2]) * t);
    out += `\x1b[38;2;${r};${g};${b}m${ch}`;
    colored = true;
    pos += w;
  }
  return colored ? out + "\x1b[0m" : out;
}

/**
 * Apply a left→right truecolor gradient across a single string.
 *
 * @param line    The text to colorize.
 * @param from    Starting RGB color (left edge).
 * @param to      Ending RGB color (right edge).
 * @param enabled Whether to emit ANSI sequences.
 */
export function gradientLine(line: string, from: Rgb, to: Rgb, enabled: boolean): string {
  if (!enabled) return line;
  return colorize(line, from, to, visibleWidth(line));
}

/**
 * Apply a left→right truecolor gradient across each line in `lines`,
 * calibrated to the widest line so the ramp is uniform down the block.
 *
 * @param lines   The text rows to colorize (need not be equal length).
 * @param from    The starting RGB color (left edge).
 * @param to      The ending RGB color (right edge).
 * @param enabled Whether to emit ANSI sequences (false → plain passthrough).
 * @returns       One colored string per input line.
 */
export function gradientBlock(
  lines: readonly string[],
  from: Rgb,
  to: Rgb,
  enabled: boolean,
): string[] {
  if (!enabled) return lines.map((l) => l);
  const span = lines.reduce((m, l) => Math.max(m, visibleWidth(l)), 1);
  return lines.map((line) => colorize(line, from, to, span));
}
