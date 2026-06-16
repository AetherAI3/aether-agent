// Terminal theme — ANSI colors, enabled-flag aware.
//
// Honors NO_COLOR (https://no-color.org) and non-TTY output (pipes) via the
// `theme` singleton, so styled strings degrade to plain text in CI, logs, and
// `--json` consumers. Embedders (xterm.js) build their own theme with
// createTheme(true) regardless of process.stdout.

export interface Theme {
  readonly enabled: boolean;
  bold(s: string): string;
  cyan(s: string): string;
  iceBlue(s: string): string;
  dim(s: string): string;
  muted(s: string): string;
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
  };
}

/** Process-wide singleton for the CLI path. Unchanged behavior. */
export const theme: Theme = createTheme(
  Boolean(process.stdout.isTTY) && !process.env["NO_COLOR"],
);

// Width math + tests use the shared, full-coverage stripper (SGR + CSI + OSC).
export { stripAnsi } from "./text.js";
