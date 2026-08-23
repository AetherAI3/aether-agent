// src/core/logs_root.ts — where session records live.
//
// Its own module for one reason: session_log.ts writes the index and
// session_index.ts reads the root, so leaving this function on either of them
// makes the two import each other. One leaf module both can depend on is the
// smaller fix. session_log.ts re-exports `logsRoot`, so every existing importer
// keeps working unchanged.

import { homedir } from "node:os";
import { join } from "node:path";

/** Root directory of the session library. `AETHER_LOG_DIR` overrides it — the
 *  tests rely on that, and so does anyone keeping logs off the home volume. */
export function logsRoot(): string {
  return process.env["AETHER_LOG_DIR"] ?? join(homedir(), ".aether-agent", "logs");
}
