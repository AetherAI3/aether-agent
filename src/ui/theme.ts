// Terminal theme — ANSI colors, TTY/NO_COLOR aware.
//
// Honors NO_COLOR (https://no-color.org) and non-TTY output (pipes), so styled
// strings degrade to plain text in CI, logs, and `--json` consumers.

const ENABLED = Boolean(process.stdout.isTTY) && !process.env["NO_COLOR"];

function wrap(code: string): (s: string) => string {
  return (s: string): string => (ENABLED ? `\x1b[${code}m${s}\x1b[0m` : s);
}

export const theme = {
  enabled: ENABLED,
  bold: wrap("1"),
  cyan: wrap("38;5;44"), // Aether cyan ≈ #1aa6b7
  iceBlue: wrap("38;5;117"),
  dim: wrap("90"), // dim grey
  muted: wrap("38;5;240"), // muted grey (the prompt underline)
  green: wrap("38;5;78"), // diff added (+)
  red: wrap("38;5;203"), // diff removed (−)
  yellow: wrap("38;5;221"), // diff meta / truncation notes
};

/** Strip ANSI escapes — for width math + tests. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
