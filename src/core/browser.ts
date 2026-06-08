// Open a URL in the system default browser, cross-platform. Best-effort and
// non-fatal: headless boxes have no browser, so callers always print the URL
// too. Shared by `auth login` and `github connect` (same web-canonical flow).

import { spawn } from "node:child_process";

/** Open `url` in the default browser. Never throws. */
export function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Headless / no browser — the caller already printed the URL.
  }
}
