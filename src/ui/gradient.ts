// src/ui/gradient.ts — truecolor horizontal gradient renderer.
//
// Interpolates an RGB start→end color across the visible characters of each
// line, wrapping each character in an SGR 38;2;r;g;b truecolor sequence.
// Falls back to plain text when color is disabled (NO_COLOR / non-TTY) so
// the output is always safe for pipes and CI logs.

/** An [R, G, B] triple in 0-255 range. */
export type Rgb = [number, number, number];

/**
 * Apply a left→right truecolor gradient across a single string.
 * Space characters are left uncolored (no ANSI sequences) so block-art
 * padding doesn't produce invisible colored spaces in terminals that
 * render background-color highlighting.
 *
 * @param line    The text to colorize.
 * @param from    Starting RGB color (left edge).
 * @param to      Ending RGB color (right edge).
 * @param enabled Whether to emit ANSI sequences.
 */
export function gradientLine(
  line: string,
  from: Rgb,
  to: Rgb,
  enabled: boolean
): string {
  if (!enabled) return line;
  const len = line.length;
  let out = "";
  for (let i = 0; i < len; i++) {
    const ch = line[i]!;
    if (ch === " ") {
      out += ch;
      continue;
    }
    const t = len <= 1 ? 0 : i / (len - 1);
    const r = Math.round(from[0] + (to[0] - from[0]) * t);
    const g = Math.round(from[1] + (to[1] - from[1]) * t);
    const b = Math.round(from[2] + (to[2] - from[2]) * t);
    out += `\x1b[38;2;${r};${g};${b}m${ch}\x1b[0m`;
  }
  return out;
}

/**
 * Apply a left→right truecolor gradient across each line in `lines`.
 *
 * @param lines   The text rows to colorize (need not be equal length).
 * @param from    The starting RGB color (left edge).
 * @param to      The ending RGB color (right edge).
 * @param enabled Whether to emit ANSI sequences (false → plain text passthrough).
 * @returns       One colored string per input line.
 */
export function gradientBlock(
  lines: readonly string[],
  from: Rgb,
  to: Rgb,
  enabled: boolean
): string[] {
  if (!enabled) return lines.map((l) => l);

  // Find the longest visible line to calibrate the gradient steps.
  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 1);

  return lines.map((line) => {
    let out = "";
    for (let i = 0; i < line.length; i++) {
      const t = maxLen <= 1 ? 0 : i / (maxLen - 1);
      const r = Math.round(from[0] + (to[0] - from[0]) * t);
      const g = Math.round(from[1] + (to[1] - from[1]) * t);
      const b = Math.round(from[2] + (to[2] - from[2]) * t);
      out += `\x1b[38;2;${r};${g};${b}m${line[i]}\x1b[0m`;
    }
    return out;
  });
}
