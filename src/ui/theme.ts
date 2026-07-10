// Terminal theme — ANSI colors, enabled-flag aware.
//
// Honors NO_COLOR (https://no-color.org) and non-TTY output (pipes), so styled
// strings degrade to plain text in CI, logs, and `--json` consumers.
//
// createTheme(enabled) is the factory (embedders like xterm.js call it
// directly, e.g. createTheme(true), independent of process.stdout).
// `theme` / `errTheme` are process-wide singletons built from it: `theme`
// keyed off STDOUT's TTY-ness, `errTheme` off STDERR's — two variants because
// styling a stderr write with the stdout-keyed theme sprays raw ANSI into
// `2>err.log` whenever stdout happens to be a terminal.

export interface Theme {
  readonly enabled: boolean;
  bold(s: string): string;
  cyan(s: string): string;
  iceBlue(s: string): string;
  dim(s: string): string;
  muted(s: string): string;
  green(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
}

function wrapper(enabled: boolean, code: string): (s: string) => string {
  return (s: string): string => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
}

/** Build a theme whose color output is gated by `enabled`. */
export function createTheme(enabled: boolean): Theme {
  return {
    enabled,
    bold: wrapper(enabled, "1"),
    cyan: wrapper(enabled, "38;5;44"), // Aether cyan ≈ #1aa6b7
    iceBlue: wrapper(enabled, "38;5;117"),
    dim: wrapper(enabled, "90"), // dim grey
    muted: wrapper(enabled, "38;5;240"), // muted grey (the prompt underline)
    green: wrapper(enabled, "38;5;78"), // diff added (+)
    red: wrapper(enabled, "38;5;203"), // diff removed (−)
    yellow: wrapper(enabled, "38;5;221"), // diff meta / truncation notes
  };
}

function enabledFor(stream: NodeJS.WriteStream): boolean {
  return Boolean(stream.isTTY) && !process.env["NO_COLOR"];
}

/** Process-wide singleton for stdout writes. Unchanged behavior. */
export const theme: Theme = createTheme(enabledFor(process.stdout));

/** Process-wide singleton for stderr writes (status bars, errors, thinking
 * indicators) — see file header for why this can't just reuse `theme`. */
export const errTheme: Theme = createTheme(enabledFor(process.stderr));

// Width math + tests use the shared, full-coverage stripper (SGR + CSI + OSC).
export { stripAnsi } from "./text.js";

/** Clip a PLAIN (unstyled) string to `n` chars, marking truncation with `…`.
 * Splits on code points (`[...s]`), not UTF-16 code units — a plain `.slice`
 * can cut a surrogate pair in half (an emoji at the boundary) and print a
 * lone unpaired surrogate as `�`. */
export function clipCodePoints(s: string, n: number): string {
  const chars = [...s];
  if (chars.length <= n) return s;
  if (n <= 1) return chars.slice(0, Math.max(0, n)).join("");
  return chars.slice(0, n - 1).join("") + "…";
}
