// ApiClient — the ONLY network surface. Talks to the Aether API (public front door).
// Aether's servers enforce usage and sign every request.
//
// Paths are constants so they change in one place.

import { HttpError, StreamUnavailableError } from "./errors.js";
import type { TokenStore } from "./auth.js";

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
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  /** POST a coding envelope, return the raw SSE byte stream for decodeSse(). */
  async stream(path: string, body: unknown): Promise<AsyncIterable<Uint8Array>> {
    const res = await fetch(this.url(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(await this.authHeaders()),
      },
      body: JSON.stringify(body),
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
