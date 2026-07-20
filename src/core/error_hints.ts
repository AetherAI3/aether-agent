// src/core/error_hints.ts — map raw failures to one actionable next step.
// The REPL's printError appends this as a dim second line, so "✗ HTTP 401"
// becomes recoverable instead of a dead end.

import { HttpError, InsecureTransportError, StreamTimeoutError, httpStatusHint } from "./errors.js";

/** One-line recovery hint for a thrown error, or null when there's nothing
 *  actionable to add. */
export function hintFor(err: unknown): string | null {
  if (err instanceof HttpError) {
    if (err.status >= 500) return "server hiccup — retry, or /doctor to check connectivity";
    // Shared wording with errors.errorHint so the streamed-turn path and the
    // slash path never show two different hints for the same status.
    return httpStatusHint(err.status);
  }
  if (err instanceof StreamTimeoutError) {
    return "the stream went quiet - retry, or /doctor to check connectivity";
  }
  if (err instanceof InsecureTransportError) return "set AETHER_BASE_URL to an https endpoint";
  if (err instanceof Error) {
    if (err.name === "AbortError") return null; // user-initiated, already explained
    const m = err.message;
    if (
      m.includes("fetch failed") ||
      m.includes("ECONNREFUSED") ||
      m.includes("ENOTFOUND") ||
      m.includes("EAI_AGAIN") ||
      m.includes("ETIMEDOUT")
    ) {
      return "can't reach the Aether API — check your network, or /doctor";
    }
  }
  return null;
}

/** True when the error is a user-initiated turn abort (Ctrl+C). */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
