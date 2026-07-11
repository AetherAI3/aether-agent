import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

export type McpStoreStatus = "missing" | "ok" | "corrupt" | "unreadable";

export interface McpStoreInspection {
  status: McpStoreStatus;
  servers: LocalMcpServer[];
  detail?: string;
}

export interface McpRepairResult {
  repaired: boolean;
  backup: string | null;
}

export function sanityCheckUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "invalid URL";
  }
  if (parsed.username || parsed.password) return "URL must not embed credentials";
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol === "http:") {
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return null;
    return "remote servers must use https";
  }
  return "URL must use https";
}

function isServer(value: unknown): value is LocalMcpServer {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const server = value as Record<string, unknown>;
  return (
    typeof server["name"] === "string" &&
    server["name"].length > 0 &&
    typeof server["url"] === "string" &&
    server["transport"] === "http" &&
    (server["authToken"] == null || typeof server["authToken"] === "string")
  );
}

export class LocalMcpStore {
  constructor(private readonly file: string = join(configDir(), "mcp.json")) {}

  filePath(): string {
    return this.file;
  }

  inspect(): McpStoreInspection {
    if (!existsSync(this.file)) return { status: "missing", servers: [] };
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch {
      return { status: "unreadable", servers: [], detail: "registry cannot be read" };
    }
    try {
      if (!raw.trim()) throw new Error("empty registry");
      const parsed = JSON.parse(raw) as Partial<McpFile>;
      if (!Array.isArray(parsed.servers) || !parsed.servers.every(isServer)) {
        throw new Error("invalid registry shape");
      }
      return { status: "ok", servers: parsed.servers.map((server) => ({ ...server })) };
    } catch {
      return { status: "corrupt", servers: [], detail: "registry JSON is corrupt" };
    }
  }

  permissions(): { status: "pass" | "warn" | "fail" | "skip"; detail: string } {
    if (!existsSync(this.file)) return { status: "pass", detail: "registry not created" };
    try {
      const mode = statSync(this.file).mode & 0o777;
      if (process.platform === "win32") {
        return { status: "skip", detail: "permission bits not checked on Windows (ACLs not verified)" };
      }
      return mode & 0o077
        ? { status: "warn", detail: "registry permissions are broader than 0600" }
        : { status: "pass", detail: "registry permissions are owner-only" };
    } catch {
      return { status: "fail", detail: "registry metadata cannot be read" };
    }
  }

  private mutable(): McpFile {
    const state = this.inspect();
    if (state.status === "corrupt" || state.status === "unreadable") {
      throw new Error("MCP registry is " + state.status + "; run aether mcp repair");
    }
    return { servers: state.servers };
  }

  private write(data: McpFile): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // Windows ACLs remain authoritative.
    }
    renameSync(tmp, this.file);
  }

  list(): LocalMcpServer[] {
    return this.inspect().servers;
  }

  add(server: LocalMcpServer): void {
    const error = sanityCheckUrl(server.url);
    if (error) throw new Error(error);
    const data = this.mutable();
    if (data.servers.some((entry) => entry.name === server.name)) {
      throw new Error('server "' + server.name + '" already exists');
    }
    this.write({ servers: [...data.servers, { ...server }] });
  }

  update(name: string, patch: Partial<Omit<LocalMcpServer, "name">>): void {
    if (patch.url) {
      const error = sanityCheckUrl(patch.url);
      if (error) throw new Error(error);
    }
    const data = this.mutable();
    const index = data.servers.findIndex((server) => server.name === name);
    if (index < 0) throw new Error('no such server "' + name + '"');
    this.write({
      servers: data.servers.map((server, current) =>
        current === index ? { ...server, ...patch } : server,
      ),
    });
  }

  remove(name: string): boolean {
    const data = this.mutable();
    const servers = data.servers.filter((server) => server.name !== name);
    if (servers.length === data.servers.length) return false;
    this.write({ servers });
    return true;
  }

  repair(
    now = new Date().toISOString(),
    beforeReset: () => void = () => {},
  ): McpRepairResult {
    const state = this.inspect();
    if (state.status === "ok" || state.status === "missing") {
      return { repaired: false, backup: null };
    }
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const suffix = now.replace(/[:.]/g, "-");
    const backup = this.file + ".bak-" + suffix;
    copyFileSync(this.file, backup);
    try {
      chmodSync(backup, 0o600);
    } catch {
      // Windows ACLs remain authoritative.
    }
    beforeReset();
    this.write({ servers: [] });
    return { repaired: true, backup };
  }
}

export function mcpServersForChat(
  store: LocalMcpStore,
): Array<{ name: string; url: string; authorization_token?: string }> {
  return store.list().map((server) => ({
    name: server.name,
    url: server.url,
    ...(server.authToken ? { authorization_token: server.authToken } : {}),
  }));
}
