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

function requireList<T>(value: unknown, path: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} returned an invalid list payload`);
  }
  return value as T[];
}

export interface PollOpts {
  intervalSec?: number;
  timeoutSec?: number;
}

export class McpClient {
  constructor(private readonly api: ApiClient) {}

  async listProviders(): Promise<McpProvider[]> {
    return requireList(
      await this.api.getJson<unknown>(MCP_PROVIDERS_PATH),
      MCP_PROVIDERS_PATH,
    );
  }

  async listConnections(): Promise<McpConnection[]> {
    return requireList(
      await this.api.getJson<unknown>(MCP_CONNECTIONS_PATH),
      MCP_CONNECTIONS_PATH,
    );
  }

  startOAuth(providerId: string): Promise<StartOAuthResponse> {
    return this.api.postJson<StartOAuthResponse>(MCP_OAUTH_START_PATH, {
      provider_id: providerId,
    });
  }

  patStore(providerId: string, pat: string): Promise<PatStoreResult> {
    return this.api.postJson<PatStoreResult>(MCP_PAT_STORE_PATH, {
      provider_id: providerId,
      pat,
      metadata: {},
    });
  }

  disconnect(providerId: string): Promise<{ ok: boolean }> {
    return this.api.postJson<{ ok: boolean }>(MCP_DISCONNECT_PATH, {
      provider_id: providerId,
    });
  }

  async listTools(providerId: string): Promise<ToolDescriptor[]> {
    const path = `${MCP_TOOLS_PATH}/${encodeURIComponent(providerId)}`;
    return requireList(
      await this.api.getJson<unknown>(path),
      path,
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
    while (Date.now() < deadline) {
      await sleep(intervalMs);
      let conns: McpConnection[];
      try {
        conns = await this.listConnections();
      } catch {
        continue; // transient — retry until deadline
      }
      const hit = conns.find((c) => c.provider_id === providerId);
      if (hit) return hit;
    }
    throw new Error(`timed out waiting for ${providerId} authorization`);
  }
}
