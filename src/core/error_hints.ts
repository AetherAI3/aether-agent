// src/core/error_hints.ts — map raw failures to one actionable next step.
// The REPL's printError appends this as a dim second line, so "✗ HTTP 401"
// becomes recoverable instead of a dead end.

import {
  HttpError,
  InsecureTransportError,
  MalformedResponseError,
  RequestTimeoutError,
  StreamTimeoutError,
  httpStatusHint,
  isAbortError as coreIsAbortError,
} from "./errors.js";

/** One-line recovery hint for a thrown error, or null when there's nothing
 *  actionable to add.
 *
 *  Only 401/402/403/429 wording is actually shared with errors.errorHint (via
 *  httpStatusHint — see its own doc comment). The 5xx and network-failure
 *  branches below are intentionally separate per-surface: errorHint (REPL)
 *  knows the configured baseUrl and names it; hintFor (one-shot CLI /
 *  embedders, via the public `hintFor` export in index.ts) has no baseUrl to
 *  hand it and stays generic instead. Don't "fix" that divergence by trying
 *  to merge the wording without also plumbing a baseUrl through hintFor's
 *  public signature. */
export function hintFor(err: unknown): string | null {
  // Checked before the generic HttpError branch (MalformedResponseError
  // extends it) — same reasoning as errors.errorHint.
  if (err instanceof MalformedResponseError) return "retry, or /doctor to check connectivity";
  if (err instanceof HttpError) {
    // Deliberately worded differently from errorHint's >=500 branch (no
    // baseUrl available here) — see the module-level note above.
    if (err.status >= 500) return "server hiccup — retry, or /doctor to check connectivity";
    // Shared wording with errors.errorHint so the streamed-turn path and the
    // slash path never show two different hints for the same status.
    return httpStatusHint(err.status);
  }
  if (err instanceof StreamTimeoutError) {
    return "the stream went quiet - retry, or /doctor to check connectivity";
  }
  if (err instanceof RequestTimeoutError) {
    return "the request went quiet - retry, or /doctor to check connectivity";
  }
  if (err instanceof InsecureTransportError) return "set AETHER_BASE_URL to an https endpoint";
  if (err instanceof Error) {
    if (err.name === "AbortError") return null; // user-initiated, already explained
    const m = err.message;
    // Deliberately worded differently from errorHint's network branch (no
    // baseUrl to name here) — see the module-level note above.
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

/** True when the error is a user-initiated turn abort (Ctrl+C). Re-exports
 *  errors.isAbortError (rather than maintaining a second, narrower check)
 *  so there is exactly one abort-detection implementation to keep correct —
 *  this used to be a separate, narrower copy that only checked `err.name`,
 *  missing the cause-wrapped/regex shapes below. */
export const isAbortError = coreIsAbortError;
