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
