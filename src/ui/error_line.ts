// src/ui/error_line.ts — the ONE way a "✗ <msg>" error line is written to a
// terminal, shared by chat.ts's printError (client-caught errors: network,
// timeouts, malformed responses) and render.ts's Renderer.error (a
// server-streamed `error` SSE frame mid-turn). Before this, the same
// "session expired" moment read differently depending on which path caught
// it: printError added a dim "  ⤷ hint" line plus the trailing blank-line
// separator PR #47 added specifically to stop the hint fusing with the next
// prompt; Renderer.error had neither. LOOP-06.
import { errTheme } from "./theme.js";
import { sanitizeTerm } from "./text.js";

export interface ErrorLineOptions {
  /** Dim actionable next step, printed on its own indented line. */
  hint?: string | null;
  /** Machine-readable error code (server-streamed errors only, e.g. `f.errorCode`). */
  errorCode?: string;
  /** Server-assigned correlation id for support/logs (`f.refId`). */
  refId?: string;
}

/**
 * Compose one "✗ <msg> [code] (ref id)" line, an optional dim hint line, and
 * a trailing blank-line separator — ready to `write()` verbatim to stderr.
 * Every piece of text is sanitized: mandatory for server-streamed fields
 * (msg/errorCode/refId can carry attacker-controlled OSC/CSI), and a safe
 * no-op for locally-generated client error messages/hints — so both call
 * sites get identical defenses instead of only the one that used to bother.
 */
export function formatErrorLine(msg: string, opts: ErrorLineOptions = {}): string {
  let head = `${errTheme.red("✗")} ${sanitizeTerm(msg)}`;
  if (opts.errorCode) head += ` [${sanitizeTerm(opts.errorCode)}]`;
  if (opts.refId) head += ` (ref ${sanitizeTerm(opts.refId)})`;
  let out = `\n${head}\n`;
  if (opts.hint) out += errTheme.dim(`  ⤷ ${sanitizeTerm(opts.hint)}`) + "\n";
  // Trailing separator: without it, a REPL that reprints its prompt right
  // after this line fuses onto the hint/message (the exact "⤷ run `aether
  // auth login` … [user]_:" mess PR #47 fixed for printError alone).
  out += "\n";
  return out;
}
