// Error taxonomy for the CLI.

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
 * One actionable next step for a failed turn, or null when there is nothing
 * better to say than the error itself. Pure — safe to unit test without a
 * network or a TTY. Consumed under the ✗ line as a dim hint.
 */
export function errorHint(err: unknown, baseUrl: string): string | null {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) return "not authorized — run: aether auth login";
    if (err.status === 429) return "rate/UVT limit hit — check your plan: /tier (or aether models)";
    if (err.status >= 500) return `the server at ${baseUrl} had a problem — try again shortly`;
    return null;
  }
  if (err instanceof Error) {
    const code = (err.cause as { code?: string } | undefined)?.code ?? "";
    if (NETWORK_CODES.has(code) || /fetch failed/i.test(err.message)) {
      return `can't reach ${baseUrl} — offline? check with /doctor (or aether auth status)`;
    }
  }
  return null;
}
