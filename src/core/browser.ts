// Open a URL in the system default browser, cross-platform. Best-effort and
// non-fatal: headless boxes have no browser, so callers always print the URL
// too. Shared by `auth login` and `github connect` (same web-canonical flow).
//
// The launch itself lives in opener.ts, which every URL and file open in this
// CLI now goes through — one argument-array implementation, no shell string,
// and the same code path `doctor --live` proves. This used to spawn
// `cmd /c start "" <url>` on Windows, which handed the URL to the command
// interpreter as a token.

import { openTarget, type OpenOutcome } from "./opener.js";

/** Open `url` in the default browser. Never throws. */
export function openBrowser(url: string): void {
  openTarget(url);
}

/** Same launch, but with the outcome so a caller can report a refusal. */
export function openBrowserChecked(url: string): OpenOutcome {
  return openTarget(url);
}
