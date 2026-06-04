// The user input line: `[{username}]_: ` (cyan prefix) + a muted-grey underline
// the user types over.

import { theme } from "./theme.js";

/** The readline prompt prefix — `[user]_: ` in cyan. */
export function promptPrefix(username: string): string {
  return theme.cyan(`[${username}]_: `);
}

/** Decorative full input line (prefix + muted underscores) for idle display. */
export function promptLine(username: string, width = 30): string {
  return promptPrefix(username) + theme.muted("_".repeat(Math.max(1, width)));
}
