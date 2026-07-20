// AetherClient — the universal LLM route. ONE chat path every surface shares:
// the terminal CLI, the desktop app (in-process embed), and Aether AI on the
// web all drive this. It owns auth (Bearer session_token), the universal SSE
// stream contract, fail-soft fallback, and the unified /models catalog.
//
// Embed: `import { createClient } from "@aether/cli"`. A host injects the user's
// session via opts.token / AETHER_TOKEN and the base URL via opts.baseUrl /
// AETHER_BASE_URL, so the desktop routes its chat through this without owning
// any transport logic.

import { ApiClient, CHAT_STREAM_PATH, CHAT_PATH, MODELS_PATH, defaultStreamTimeoutMs } from "./transport.js";
import { decodeSse, type StreamFrame } from "./stream.js";
import { buildChatRequest } from "./envelope.js";
import { StreamUnavailableError } from "./errors.js";
import {
  defaultTokenStore,
  StaticTokenStore,
  loginWithPassword,
  type LoginResult,
  type TokenStore,
} from "./auth.js";
import { loadConfig } from "./config.js";
import type { CatalogResponse } from "../types.js";

export interface ClientOptions {
  /** the Aether API base URL. Falls back to AETHER_BASE_URL, then config. */
  baseUrl?: string;
  /** Session token to inject (embedded use). Falls back to AETHER_TOKEN. */
  token?: string;
  /** Custom token store; overrides token/env when provided. */
  tokenStore?: TokenStore;
}

export interface ChatOptions {
  /** Forced model id; omit to let the server smart-router pick. */
  model?: string;
  /** Orchestrator id (Neo/Kronus); omit for a plain model chat. */
  agent?: string;
  /** Did the user explicitly pick the model? Defaults to (model != null). */
  manualModel?: boolean;
}

export class AetherClient {
  readonly baseUrl: string;
  private readonly tokens: TokenStore;
  private readonly api: ApiClient;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env["AETHER_BASE_URL"] ?? loadConfig().baseUrl;
    const envToken = process.env["AETHER_TOKEN"];
    const injected = opts.token ?? envToken;
    this.tokens =
      opts.tokenStore ?? (injected ? new StaticTokenStore(injected) : defaultTokenStore());
    this.api = new ApiClient(this.baseUrl, this.tokens);
  }

  /**
   * The universal chat route. Yields typed SSE frames (delta/usage/done/...).
   * Fail-soft: if the server can't stream, falls back to the non-streaming
   * endpoint and yields a synthetic delta + done so consumers stay uniform.
   *
   * Can throw (not fail-soft): HttpError, InsecureTransportError, or
   * StreamTimeoutError when the connection goes quiet. Import StreamTimeoutError
   * and hintFor from "@aether/cli" to detect it and get the same recovery hint
   * the terminal CLI shows.
   */
  async *chatStream(prompt: string, opts: ChatOptions = {}): AsyncGenerator<StreamFrame> {
    const req = buildChatRequest({
      prompt,
      model: opts.model,
      agent: opts.agent,
      manualModel: opts.manualModel ?? opts.model != null,
    });
    try {
      const stream = await this.api.stream(CHAT_STREAM_PATH, req);
      for await (const frame of decodeSse(stream)) yield frame;
    } catch (err) {
      if (err instanceof StreamUnavailableError) {
        // A full LLM turn can legitimately run long, so this opts into
        // stream()'s own generous bound rather than request()'s 30s
        // metadata-call default (LOOP-01/LOOP-06 round-1).
        const r = await this.api.postJson<{ response?: string }>(CHAT_PATH, req, undefined, defaultStreamTimeoutMs());
        yield { type: "delta", text: r.response ?? "" };
        yield { type: "done", uvt: 0, cents: 0 };
        return;
      }
      throw err;
    }
  }

  /** Unified models + orchestrators catalog, tier-scoped (drives every picker). */
  async catalog(): Promise<CatalogResponse> {
    return this.api.getJson<CatalogResponse>(MODELS_PATH);
  }

  /** Authenticate; stores the session token in the active token store. */
  async login(username: string, password: string, licenseKey?: string): Promise<LoginResult> {
    const creds = licenseKey ? { username, password, licenseKey } : { username, password };
    return loginWithPassword(this.baseUrl, this.tokens, creds);
  }

  /** Escape hatch for surfaces needing raw authed HTTP on the same route. */
  get http(): ApiClient {
    return this.api;
  }
}

export function createClient(opts?: ClientOptions): AetherClient {
  return new AetherClient(opts);
}
