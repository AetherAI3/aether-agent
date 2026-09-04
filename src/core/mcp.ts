// MCP broker client — connections, OAuth/PAT flows, tool catalog. The broker
// is mounted at /mcp-broker on the Aether API (flag-gated server-side); a 404
// on these paths means "backend broker not enabled yet" and callers degrade.

import type { ApiClient } from "./transport.js";

export const MCP_PROVIDERS_PATH = "/mcp-broker/oauth/providers";
export const MCP_CONNECTIONS_PATH = "/mcp-broker/oauth/connections";
export const MCP_OAUTH_START_PATH = "/mcp-broker/oauth/start";
export const MCP_PAT_STORE_PATH = "/mcp-broker/oauth/pat-store";
export const MCP_DISCONNECT_PATH = "/mcp-broker/oauth/disconnect";
export const MCP_TOOLS_PATH = "/mcp-broker/tools"; // + "/{provider_id}"

export interface McpProvider {
  provider_id: string;
  display_name: string;
  flow: "pat_paste" | "auth_code_pkce";
}

export interface McpConnection {
  provider_id: string;
  created_at: string;
  updated_at: string;
}

export interface StartOAuthResponse {
  flow: "pat_paste" | "auth_code_pkce";
  authorize_url?: string;
  validate_endpoint?: string;
}

export interface PatStoreResult {
  ok: boolean;
  reason?: string;
}

export interface ToolDescriptor {
  name: string;
  description?: string;
}

export interface PollOpts {
  intervalSec?: number;
  timeoutSec?: number;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
}

export interface McpRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class McpClient {
  constructor(private readonly api: ApiClient) {}

  listProviders(options: McpRequestOptions = {}): Promise<McpProvider[]> {
    return this.api.getJson<McpProvider[]>(MCP_PROVIDERS_PATH, options.signal, options.timeoutMs);
  }

  listConnections(options: McpRequestOptions = {}): Promise<McpConnection[]> {
    return this.api.getJson<McpConnection[]>(MCP_CONNECTIONS_PATH, options.signal, options.timeoutMs);
  }

  startOAuth(providerId: string, options: McpRequestOptions = {}): Promise<StartOAuthResponse> {
    return this.api.postJson<StartOAuthResponse>(MCP_OAUTH_START_PATH, {
      provider_id: providerId,
    }, options.signal, options.timeoutMs);
  }

  patStore(providerId: string, pat: string, options: McpRequestOptions = {}): Promise<PatStoreResult> {
    return this.api.postJson<PatStoreResult>(MCP_PAT_STORE_PATH, {
      provider_id: providerId,
      pat,
      metadata: {},
    }, options.signal, options.timeoutMs);
  }

  disconnect(providerId: string, options: McpRequestOptions = {}): Promise<{ ok: boolean }> {
    return this.api.postJson<{ ok: boolean }>(MCP_DISCONNECT_PATH, {
      provider_id: providerId,
    }, options.signal, options.timeoutMs);
  }

  listTools(providerId: string, options: McpRequestOptions = {}): Promise<ToolDescriptor[]> {
    return this.api.getJson<ToolDescriptor[]>(
      `${MCP_TOOLS_PATH}/${encodeURIComponent(providerId)}`,
      options.signal,
      options.timeoutMs,
    );
  }

  /** Poll connections until `providerId` appears (browser OAuth completing).
   * `sleep` injected for testability — mirrors core/github.ts. */
  async pollUntilConnected(
    providerId: string,
    sleep: (ms: number) => Promise<void>,
    opts: PollOpts = {},
  ): Promise<McpConnection> {
    const intervalMs = (opts.intervalSec ?? 2) * 1000;
    const deadline = Date.now() + (opts.timeoutSec ?? 180) * 1000;
    const signal = opts.signal;
    while (Date.now() < deadline) {
      await abortableSleep(sleep, Math.min(intervalMs, Math.max(0, deadline - Date.now())), signal);
      if (signal?.aborted) throw abortError();
      let conns: McpConnection[];
      try {
        conns = await this.listConnections({
          signal,
          timeoutMs: Math.max(
            1,
            Math.min(opts.requestTimeoutMs ?? 10_000, Math.max(1, deadline - Date.now())),
          ),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        continue; // transient — retry until deadline
      }
      const hit = conns.find((c) => c.provider_id === providerId);
      if (hit) return hit;
    }
    throw new Error(`timed out waiting for ${providerId} authorization`);
  }
}

function abortError(): Error {
  const error = new Error("MCP operation aborted");
  error.name = "AbortError";
  return error;
}

async function abortableSleep(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError();
  if (!signal) {
    await sleep(ms);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = (): void => finish(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(() => sleep(ms))
      .then(() => finish(), (error: unknown) => finish(error));
  });
}
