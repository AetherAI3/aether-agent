// Local custom MCP server registry — Claude Code-style mcp.json under the
// aether config dir. These entries become the `mcp_servers` param for
// /agent/mcp-chat; the SERVER-SIDE allowlist (backend mcp_registry) is the
// final authority. Client checks here are UX-only fast feedback.

import { mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir } from "./config.js";

export interface LocalMcpServer {
  name: string;
  url: string;
  transport: "http";
  authToken?: string;
}

interface McpFile {
  servers: LocalMcpServer[];
}

/** UX-side mirror of the server allowlist's URL shape rules (https-only —
 * loopback http allowed for local dev; no embedded credentials). Returns an
 * error message or null when OK. */
export function sanityCheckUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "invalid URL";
  }
  if (u.username || u.password) return "URL must not embed credentials";
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:") {
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return null;
    return "remote servers must use https";
  }
  return "URL must use https";
}

export class LocalMcpStore {
  constructor(private readonly file: string = join(configDir(), "mcp.json")) {}

  private read(): McpFile {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch {
      return { servers: [] };
    }
    try {
      const parsed = JSON.parse(raw) as McpFile;
      if (!Array.isArray(parsed.servers)) throw new Error("bad shape");
      return parsed;
    } catch {
      // Corrupt config: preserve evidence, start clean.
      try {
        renameSync(this.file, this.file + ".bak");
      } catch {
        /* best effort */
      }
      return { servers: [] };
    }
  }

  private write(data: McpFile): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    try {
      chmodSync(tmp, 0o600);
    } catch {
      /* windows */
    }
    renameSync(tmp, this.file);
  }

  list(): LocalMcpServer[] {
    return this.read().servers;
  }

  add(server: LocalMcpServer): void {
    const err = sanityCheckUrl(server.url);
    if (err) throw new Error(err);
    const data = this.read();
    if (data.servers.some((s) => s.name === server.name)) {
      throw new Error(`server "${server.name}" already exists`);
    }
    this.write({ servers: [...data.servers, server] });
  }

  update(name: string, patch: Partial<Omit<LocalMcpServer, "name">>): void {
    if (patch.url) {
      const err = sanityCheckUrl(patch.url);
      if (err) throw new Error(err);
    }
    const data = this.read();
    const idx = data.servers.findIndex((s) => s.name === name);
    if (idx < 0) throw new Error(`no such server "${name}"`);
    const next = data.servers.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    this.write({ servers: next });
  }

  remove(name: string): boolean {
    const data = this.read();
    const next = data.servers.filter((s) => s.name !== name);
    if (next.length === data.servers.length) return false;
    this.write({ servers: next });
    return true;
  }
}

/** Shape local entries for the /agent/mcp-chat `mcp_servers` param. */
export function mcpServersForChat(
  store: LocalMcpStore,
): Array<{ name: string; url: string; authorization_token?: string }> {
  return store.list().map((s) => ({
    name: s.name,
    url: s.url,
    ...(s.authToken ? { authorization_token: s.authToken } : {}),
  }));
}
