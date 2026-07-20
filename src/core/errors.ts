// Error taxonomy for the CLI.

/** Unwrap any thrown value to a display message. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Standard command-handler failure path: print `✗ <message>` (with an
 * optional parenthesized hint line, e.g. "are you logged in? run: ...")
 * and return the conventional non-zero exit code.
 */
export function fail(err: unknown, hint?: string): number {
  const msg = errorMessage(err);
  process.stderr.write(`✗ ${msg}\n${hint ? `  (${hint})\n` : ""}`);
  return 1;
}

/** Thrown by seams that are scaffolded but not yet wired to the the Aether API. */
export class NotWiredError extends Error {
  constructor(what: string) {
    super(`${what} is not wired yet (not implemented yet).`);
    this.name = "NotWiredError";
  }
}

/**
 * Server signalled fail-soft: it returned `{"stream": false}` as plain JSON
 * instead of an SSE body (AETHER_DISABLE_STREAMING, no adapter iter_stream,
 * etc.). The caller MUST fall back to the non-streaming request/response path.
 */
export class StreamUnavailableError extends Error {
  constructor(public body?: unknown) {
    super("streaming unavailable — fall back to request/response");
    this.name = "StreamUnavailableError";
  }
}

/** Streaming response started or continued too slowly for an interactive turn. */
export class StreamTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`stream timed out after ${Math.round(timeoutMs / 1000)}s with no data`);
    this.name = "StreamTimeoutError";
  }
}

/**
 * Refused to send the session token because the base URL is not a secure
 * transport (non-https to a non-loopback host). Prevents a cleartext credential
 * leak / token exfiltration to an arbitrary host.
 */
export class InsecureTransportError extends Error {
  constructor(public baseUrl: string) {
    super(
      `refusing to send credentials over insecure transport: ${baseUrl} ` +
        `(use https, or http only to localhost)`,
    );
    this.name = "InsecureTransportError";
  }
}

/** Non-2xx HTTP response from the Aether API. Carries status + parsed body when present. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Network-cause codes that mean "the server never answered" (undici surfaces
// these on err.cause.code for fetch failures).
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNRESET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * True when `err` is the client-side cancellation of an in-flight turn
 * (AbortController fired). Undici surfaces this two ways depending on where
 * the stream was when it died: a DOMException named AbortError, or a
 * TypeError whose `cause` is the AbortError. Pure — unit-testable.
 */
export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  const causeName = (err.cause as { name?: string } | undefined)?.name;
  if (causeName === "AbortError") return true;
  return /operation was aborted/i.test(err.message);
}

/**
 * The ONE wording per auth/plan-shaped HTTP status, shared by errorHint (REPL)
 * and error_hints.hintFor (embedders/one-shot CLI) so a 401 can't read two
 * different ways in the same session. `/tier` only exists in the REPL, so the
 * standalone-CLI alternative is always named too.
 */
export function httpStatusHint(status: number): string | null {
  if (status === 401) return "session expired or invalid — run `aether auth login` to sign in again";
  if (status === 402) return "out of UVT balance — top up or check your plan: /tier or `aether models`";
  if (status === 403) return "your plan/tier may not include this — check: /tier or `aether models`";
  if (status === 429) return "rate limited — give it a moment, or check your plan: /tier or `aether models`";
  return null;
}

/**
 * One actionable next step for a failed turn, or null when there is nothing
 * better to say than the error itself. Pure — safe to unit test without a
 * network or a TTY. Consumed under the ✗ line as a dim hint.
 */
export function errorHint(err: unknown, baseUrl: string): string | null {
  if (err instanceof HttpError) {
    if (err.status >= 500) return `the server at ${baseUrl} had a problem — try again shortly`;
    return httpStatusHint(err.status);
  }
  if (err instanceof Error) {
    const code = (err.cause as { code?: string } | undefined)?.code ?? "";
    if (NETWORK_CODES.has(code) || /fetch failed/i.test(err.message)) {
      return `can't reach ${baseUrl} — offline? check with /doctor (or aether auth status)`;
    }
  }
  return null;
}
