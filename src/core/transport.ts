// ApiClient — the ONLY network surface. Talks to the Aether API (public front door).
// Aether's servers enforce usage and sign every request.
//
// Paths are constants so they change in one place.

import { HttpError, InsecureTransportError, StreamTimeoutError, StreamUnavailableError } from "./errors.js";
import type { TokenStore } from "./auth.js";

/**
 * Is `base` a transport we will attach the session token to? https is allowed to
 * any host; plain http is allowed ONLY to loopback (a local-dev backend), so the
 * long-lived `aek_` token never traverses cleartext to a remote host and an
 * attacker-set base URL cannot silently exfiltrate it. Unparseable → unsafe.
 */
export function isCredentialSafeUrl(base: string): boolean {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (u.protocol !== "http:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

// Aether API routes.
export const CHAT_STREAM_PATH = "/agent/chat/stream"; // standard chat SSE
export const CHAT_PATH = "/agent/chat"; // non-streaming fail-soft fallback
// Auth (session_token via username/password; Bearer on all authed calls).
export const LOGIN_PATH = "/auth/login";
export const LOGOUT_PATH = "/auth/logout";
export const REFRESH_PATH = "/auth/refresh";
// OAuth / account platform: `aether auth login` opens this to sign in and mint
// or copy a CLI API token. Override with AETHER_LOGIN_URL.
export const PLATFORM_URL =
  process.env["AETHER_LOGIN_URL"] ?? "https://aethersystems.net/platform";
// Device Authorization Grant (RFC 8628) — `aether auth login` default flow.
export const DEVICE_CODE_PATH = "/auth/device/code"; // CLI requests a user_code
export const DEVICE_TOKEN_PATH = "/auth/device/token"; // CLI polls until approved
// GitHub Connect (web-canonical GitHub App; Bearer-authed). connect returns an
// install_url the user approves in the browser; status is polled until linked.
// Backend mounts these at root (api_server include_router, no prefix).
export const GITHUB_CONNECT_PATH = "/account/github/connect";
export const GITHUB_STATUS_PATH = "/account/github/status";
export const GITHUB_DISCONNECT_PATH = "/account/github/disconnect";
// request audit (chain of custody) (integrity id = commitment_hash).
export const AUDIT_TRAIL_PATH = "/audit/trail/live"; // entries carry commitment_hash
export const EXPORT_PROOF_PATH = "/audit/export-proof"; // {entry_ids} -> proof package
// Note — no REST model registry route exists yet on the Aether API.
export const MODELS_PATH = "/models";
export const AGENTS_PATH = "/agents";
export const AGENT_DELEGATE_PATH = "/agents/delegate";
export const AGENT_TREE_PATH = "/agents/tree";
export const AGENT_BROADCAST_PATH = "/agents/broadcast";
export const AGENT_GATHER_PATH = "/agents/gather";
export const AGENT_TEST_DRIVE_PATH = "/agents/test-drive";
export const AGENT_BENCH_PATH = "/agents/bench";
// ── Vault (cloud file storage) ─────────────────
export const VAULT_LIST_PATH = "/vault/list";
export const VAULT_BROWSE_PATH = "/vault/browse";
export const VAULT_SPACES_LIST_PATH = "/vault/spaces/list";
export const VAULT_SPACES_USAGE_PATH = "/vault/spaces/usage";
export const VAULT_SPACES_UPLOAD_PATH = "/vault/spaces/upload";
export const VAULT_SPACES_DOWNLOAD_PATH = "/vault/spaces/download";
export const VAULT_SPACES_CONTENT_PATH = "/vault/spaces/content";
export const VAULT_SPACES_DELETE_PATH = "/vault/spaces/delete";
export const VAULT_NOTES_SEARCH_PATH = "/vault/notes/search";
export const VAULT_NOTES_BY_TAG_PATH = "/vault/notes/by-tag";
export const VAULT_NOTES_BY_TYPE_PATH = "/vault/notes/by-type";
export const VAULT_NOTES_BACKLINKS_PATH = "/vault/notes/backlinks";
export const VAULT_NOTES_OUTLINKS_PATH = "/vault/notes/outlinks";
export const VAULT_NOTES_TREE_PATH = "/vault/notes/tree";
export const AGENT_VAULT_SNAPSHOT_PATH = "/agent/vault/snapshot";
export const AGENT_VAULT_SLASH_PATH = "/agent/vault/slash";
export const AGENT_VAULT_STAGING_PATH = "/agent/vault/staging";
export const AGENT_CONTEXT_PATH = "/agent/context";
// ── UVT Commands ────────────────────────────
export const UVT_SCAFFOLD_PATH = "/uvt/scaffold";
export const UVT_PORT_PATH = "/uvt/port";
// ── Project conversion (workflow → project) ─────
export const PROJECT_FROM_WORKFLOW_ASSESS_PATH = "/project/from-workflow/assess";
export const PROJECT_FROM_WORKFLOW_BRAINSTORM_PATH = "/project/from-workflow/brainstorm";
export const PROJECT_FROM_WORKFLOW_PLAN_PATH = "/project/from-workflow/plan";
export const PROJECT_FROM_WORKFLOW_FINALIZE_PATH = "/project/from-workflow/finalize";

export const DEFAULT_STREAM_TIMEOUT_MS = 120_000;

export interface StreamOptions {
  signal?: AbortSignal;
  /** Timeout for opening the stream and for each quiet interval between chunks. 0 disables it. */
  timeoutMs?: number;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: TokenStore,
  ) {}

  private url(path: string): string {
    return this.baseUrl.replace(/\/$/, "") + path;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const t = await this.tokens.get();
    if (!t) return {};
    // Fail closed: never put the bearer on an insecure transport. Unauthenticated
    // calls (no token) are unaffected — only credentialed requests are refused.
    if (!isCredentialSafeUrl(this.baseUrl)) throw new InsecureTransportError(this.baseUrl);
    return { Authorization: `Bearer ${t}` };
  }

  /** POST a coding envelope, return the raw SSE byte stream for decodeSse().
   *  `signal` aborts a Ctrl+C turn; `timeoutMs` (default 120s, override via
   *  AETHER_STREAM_TIMEOUT_MS or the options form, 0 disables) catches a quiet
   *  connection so a stalled SSE body cannot hang the terminal forever.
   *  Timeout and user-abort are raced as two independent promises (see
   *  raceAgainst) so a timeout can never be mistaken for the user's own
   *  Ctrl+C, or vice versa, no matter which fires first. */
  async stream(
    path: string,
    body: unknown,
    signalOrOptions?: AbortSignal | StreamOptions,
  ): Promise<AsyncIterable<Uint8Array>> {
    const { signal, timeoutMs } = normalizeStreamOptions(signalOrOptions);
    // `net` only tells fetch()/the body reader to release the socket on timeout
    // or abort — it is never inspected to pick the error the caller sees. That
    // classification comes solely from raceAgainst racing the caller's own
    // `signal` against an independent timer, so the two can't collide.
    const net = new AbortController();
    const releaseNet = (): void => net.abort();
    if (signal) {
      if (signal.aborted) releaseNet();
      else signal.addEventListener("abort", releaseNet, { once: true });
    }
    const cleanup = (): void => signal?.removeEventListener("abort", releaseNet);
    try {
      const res = await raceAgainst(
        fetch(this.url(path), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...(await this.authHeaders()),
          },
          body: JSON.stringify(body),
          signal: net.signal,
        }),
        signal,
        timeoutMs,
      );
      if (!res.ok) throw await toHttpError(res);
      // Fail-soft: server returns plain JSON `{"stream": false}` instead of an
      // SSE body when it can't/shouldn't stream -> caller falls back to /agent/chat.
      const ct = res.headers.get("content-type") ?? "";
      if (ct.startsWith("application/json")) {
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          body = undefined;
        }
        throw new StreamUnavailableError(body);
      }
      if (!res.body) throw new HttpError(res.status, "empty stream body");
      return withIdleTimeout(
        res.body as unknown as AsyncIterable<Uint8Array>,
        signal,
        timeoutMs,
        releaseNet,
        cleanup,
      );
    } catch (err) {
      releaseNet();
      cleanup();
      throw err;
    }
  }

  async postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>("POST", path, { body, signal });
  }

  async getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>("GET", path, { signal });
  }

  async deleteJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>("DELETE", path, { signal });
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const res = await fetch(this.url(path), {
      method,
      headers: {
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        Accept: "application/json",
        ...(await this.authHeaders()),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok) throw await toHttpError(res);
    return (await res.json()) as T;
  }
}

async function toHttpError(res: Response): Promise<HttpError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const msg =
    body && typeof body === "object" && "message" in body
      ? String((body as Record<string, unknown>)["message"])
      : `HTTP ${res.status}`;
  return new HttpError(res.status, msg, body);
}
function normalizeStreamOptions(signalOrOptions?: AbortSignal | StreamOptions): {
  signal?: AbortSignal;
  timeoutMs: number;
} {
  const isSignal =
    !!signalOrOptions && "aborted" in signalOrOptions && "addEventListener" in signalOrOptions;
  const opts: StreamOptions = isSignal
    ? { signal: signalOrOptions as AbortSignal }
    : ((signalOrOptions as StreamOptions | undefined) ?? {});
  return { signal: opts.signal, timeoutMs: normalizeTimeoutMs(opts.timeoutMs ?? defaultStreamTimeoutMs()) };
}

/** Exported so tests can pin AETHER_STREAM_TIMEOUT_MS parsing without a live stream. */
export function defaultStreamTimeoutMs(): number {
  const raw = process.env["AETHER_STREAM_TIMEOUT_MS"];
  if (raw == null || raw.trim() === "") return DEFAULT_STREAM_TIMEOUT_MS;
  const parsed = Number(raw);
  // 0 is a valid "disabled" value (see normalizeTimeoutMs) — only fall back to
  // the default when the env var is missing or genuinely invalid, never
  // silently discard an explicit 0.
  if (parsed === 0) return 0;
  return normalizeTimeoutMs(parsed) || DEFAULT_STREAM_TIMEOUT_MS;
}

function normalizeTimeoutMs(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
}

/** Races `promise` against the caller's own abort and an independent timeout
 *  timer. Each loses its race with its own error (the caller's real
 *  AbortError, or a fresh StreamTimeoutError) — there's no shared mutable
 *  "reason" field for the two to race over, so neither can be mistaken for
 *  the other regardless of which fires first. */
function raceAgainst<T>(promise: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  const racers: Promise<T>[] = [promise];
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    racers.push(
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new StreamTimeoutError(timeoutMs)), timeoutMs);
        timer.unref?.();
      }),
    );
  }
  let onAbort: (() => void) | undefined;
  if (signal) {
    racers.push(
      new Promise<T>((_, reject) => {
        onAbort = () => reject(abortError(signal));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    );
  }
  return Promise.race(racers).finally(() => {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  });
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

async function* withIdleTimeout(
  stream: AsyncIterable<Uint8Array>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  releaseNet: () => void,
  cleanup: () => void,
): AsyncIterable<Uint8Array> {
  const iterator = stream[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await raceAgainst(iterator.next(), signal, timeoutMs);
      if (next.done) return;
      yield next.value;
    }
  } finally {
    releaseNet();
    cleanup();
    // iterator.return() can reject (e.g. the body was already aborted) — always
    // attach a handler so a rejecting cleanup can never surface as an unhandled
    // promise rejection (which the REPL's global handler turns into a crash).
    iterator.return?.()?.catch(() => {});
  }
}
