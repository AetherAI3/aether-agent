// src/core/error_hints.ts — map raw failures to one actionable next step.
// The REPL's printError appends this as a dim second line, so "✗ HTTP 401"
// becomes recoverable instead of a dead end.

import {
  HttpError,
  InsecureTransportError,
  MalformedResponseError,
  NETWORK_CODES,
  RequestTimeoutError,
  StreamIncompleteError,
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
  // Same wording as errors.errorHint's StreamIncompleteError branch — see
  // that module's note on why 401/402/403/429 are the only wording actually
  // shared; this one has no baseUrl-dependent text so it's identical here too.
  if (err instanceof StreamIncompleteError) {
    return "retry, or /doctor to check connectivity";
  }
  if (err instanceof RequestTimeoutError) {
    return "the request went quiet - retry, or /doctor to check connectivity";
  }
  if (err instanceof InsecureTransportError) return "set AETHER_BASE_URL to an https endpoint";
  if (err instanceof Error) {
    if (err.name === "AbortError") return null; // user-initiated, already explained
    const m = err.message;
    // undici puts the failure code on err.cause.code (not in the message
    // text) for most real fetch failures — e.g. `new Error("request to host
    // failed", { cause: { code: "ECONNREFUSED" } })`. The message-substring
    // checks below only catch errors that happen to embed the code in their
    // text, which errors.errorHint's own test suite shows is not the shape
    // undici actually throws. Check cause.code first so this class of error
    // isn't silently missed (LOOP-06 round 3) — mirrors errors.errorHint.
    const code = (err.cause as { code?: string } | undefined)?.code ?? "";
    // Deliberately worded differently from errorHint's network branch (no
    // baseUrl to name here) — see the module-level note above.
    if (
      NETWORK_CODES.has(code) ||
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
