// Terminal theme — ANSI colors, TTY/NO_COLOR aware.
//
// Honors NO_COLOR (https://no-color.org) and non-TTY output (pipes), so styled
// strings degrade to plain text in CI, logs, and `--json` consumers.
//
// Two variants: `theme` keys off STDOUT's TTY-ness, `errTheme` off STDERR's.
// Styling a stderr write with the stdout-keyed theme sprays ANSI into
// `2>err.log` whenever stdout is a terminal — stderr writes use errTheme.

function enabledFor(stream: NodeJS.WriteStream): boolean {
  return Boolean(stream.isTTY) && !process.env["NO_COLOR"];
}

const ENABLED = enabledFor(process.stdout);
const ERR_ENABLED = enabledFor(process.stderr);

function wrap(enabled: boolean, code: string): (s: string) => string {
  return (s: string): string => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
}

export interface Palette {
  enabled: boolean;
  bold: (s: string) => string;
  cyan: (s: string) => string;
  iceBlue: (s: string) => string;
  dim: (s: string) => string;
  muted: (s: string) => string;
  green: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
}

function palette(enabled: boolean): Palette {
  return {
    enabled,
    bold: wrap(enabled, "1"),
    cyan: wrap(enabled, "38;5;44"), // Aether cyan ≈ #1aa6b7
    iceBlue: wrap(enabled, "38;5;117"),
    dim: wrap(enabled, "90"), // dim grey
    muted: wrap(enabled, "38;5;240"), // muted grey (the prompt underline)
    green: wrap(enabled, "38;5;78"), // diff added (+)
    red: wrap(enabled, "38;5;203"), // diff removed (−)
    yellow: wrap(enabled, "38;5;221"), // diff meta / truncation notes
  };
}

/** Styling for stdout writes. */
export const theme = palette(ENABLED);

/** Styling for stderr writes (status bars, errors, thinking indicators). */
export const errTheme = palette(ERR_ENABLED);

/** Strip ANSI escapes — for width math + tests. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
