// ApiClient — the ONLY network surface. Talks to the Aether API (public front door).
// Aether's servers enforce usage and sign every request.
//
// Paths are constants so they change in one place.

import { HttpError, InsecureTransportError, StreamUnavailableError } from "./errors.js";
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
export const PROJECT_STREAM_PATH = "/project/stream"; // orchestrator; + "/{id}"
export const MCP_CHAT_PATH = "/agent/mcp-chat"; // custom/MCP agent (Accept: SSE)
export const CHAT_PATH = "/agent/chat"; // non-streaming fail-soft fallback
// Auth (session_token via username/password; Bearer on all authed calls).
export const LOGIN_PATH = "/auth/login";
export const LOGOUT_PATH = "/auth/logout";
export const VERIFY_PATH = "/auth/verify";
export const REFRESH_PATH = "/auth/refresh";
// OAuth / account platform: `aether auth login` opens this to sign in and mint
// or copy a CLI API token. Override with AETHER_LOGIN_URL.
export const PLATFORM_URL =
  process.env["AETHER_LOGIN_URL"] ?? "https://aethersystems.net/platform";
// Device Authorization Grant (RFC 8628) — `aether auth login` default flow.
export const DEVICE_CODE_PATH = "/auth/device/code"; // CLI requests a user_code
export const DEVICE_TOKEN_PATH = "/auth/device/token"; // CLI polls until approved
// API-key management (locked contract): GET/POST/DELETE.
export const API_KEYS_PATH = "/account/api-keys";
// GitHub Connect (web-canonical GitHub App; Bearer-authed). connect returns an
// install_url the user approves in the browser; status is polled until linked.
// Backend mounts these at root (api_server include_router, no prefix).
export const GITHUB_CONNECT_PATH = "/account/github/connect";
export const GITHUB_STATUS_PATH = "/account/github/status";
export const GITHUB_DISCONNECT_PATH = "/account/github/disconnect";
// request audit (chain of custody) (integrity id = commitment_hash).
export const AUDIT_TRAIL_PATH = "/audit/trail/live"; // entries carry commitment_hash
export const EXPORT_PROOF_PATH = "/audit/export-proof"; // {entry_ids} -> proof package
// Note — no REST model registry route exists yet on the the Aether API.
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
   *  `signal` aborts both the connection and the in-flight body (Ctrl+C on a
   *  turn) — without it a stalled stream is unkillable short of exiting. */
  async stream(path: string, body: unknown, signal?: AbortSignal): Promise<AsyncIterable<Uint8Array>> {
    const res = await fetch(this.url(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(await this.authHeaders()),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw await toHttpError(res);
    // Fail-soft: server returns plain JSON `{"stream": false}` instead of an
    // SSE body when it can't/shouldn't stream → caller falls back to /agent/chat.
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
    return res.body as unknown as AsyncIterable<Uint8Array>;
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(await this.authHeaders()),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await toHttpError(res);
    return (await res.json()) as T;
  }

  async getJson<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path), {
      headers: { Accept: "application/json", ...(await this.authHeaders()) },
    });
    if (!res.ok) throw await toHttpError(res);
    return (await res.json()) as T;
  }

  async putJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(await this.authHeaders()),
      },
      body: JSON.stringify(body),
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
