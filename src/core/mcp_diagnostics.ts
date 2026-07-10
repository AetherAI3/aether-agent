import type { McpClient, McpConnection, McpProvider } from "./mcp.js";
import { LocalMcpStore, sanityCheckUrl } from "./mcp_store.js";

export type McpCheckStatus = "pass" | "warn" | "fail" | "skip";

export interface McpDiagnosticCheck {
  id: string;
  status: McpCheckStatus;
  detail: string;
}

export interface RedactedLocalMcpServer {
  name: string;
  url: string;
  transport: "http";
  authConfigured: boolean;
}

export interface McpProviderDiagnostic {
  id: string;
  displayName: string;
  connected: boolean;
  toolCount: number | null;
  status: McpCheckStatus;
}

export interface McpDiagnosticReport {
  schemaVersion: 1;
  generatedAt: string;
  registryStatus: string;
  localServers: RedactedLocalMcpServer[];
  brokerStatus: "available" | "unavailable";
  providers: McpProviderDiagnostic[];
  checks: McpDiagnosticCheck[];
}

export interface McpDiagnosticOptions {
  timeoutMs?: number;
  includeToolCounts?: boolean;
  now?: string;
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function collectMcpDiagnostics(
  client: McpClient,
  store: LocalMcpStore,
  options: McpDiagnosticOptions = {},
): Promise<McpDiagnosticReport> {
  const timeoutMs = Math.max(50, Math.min(options.timeoutMs ?? 2000, 10000));
  const inspected = store.inspect();
  const localServers = inspected.servers.map((server) => ({
    name: server.name,
    url: redactUrl(server.url),
    transport: server.transport,
    authConfigured: Boolean(server.authToken),
  }));
  const checks: McpDiagnosticCheck[] = [
    {
      id: "registry-read",
      status:
        inspected.status === "corrupt" || inspected.status === "unreadable"
          ? "fail"
          : inspected.status === "missing"
            ? "warn"
            : "pass",
      detail:
        inspected.status === "ok"
          ? inspected.servers.length + " local server(s)"
          : "registry " + inspected.status,
    },
  ];
  const permission = store.permissions();
  checks.push({ id: "registry-permissions", ...permission });
  for (const server of inspected.servers) {
    const error = sanityCheckUrl(server.url);
    checks.push({
      id: "local-url:" + server.name,
      status: error ? "fail" : "pass",
      detail: error ?? "URL shape valid; no direct probe performed",
    });
  }

  let providers: McpProvider[] = [];
  let connections: McpConnection[] = [];
  try {
    [providers, connections] = await bounded(
      Promise.all([client.listProviders(), client.listConnections()]),
      timeoutMs,
    );
    checks.push({
      id: "broker",
      status: "pass",
      detail: providers.length + " provider(s), " + connections.length + " connected",
    });
  } catch {
    checks.push({ id: "broker", status: "warn", detail: "broker unavailable" });
    return {
      schemaVersion: 1,
      generatedAt: options.now ?? new Date().toISOString(),
      registryStatus: inspected.status,
      localServers,
      brokerStatus: "unavailable",
      providers: [],
      checks,
    };
  }

  const includeTools = options.includeToolCounts !== false;
  const providerReports = await Promise.all(
    providers.map(async (provider): Promise<McpProviderDiagnostic> => {
      const connected = connections.some((connection) => connection.provider_id === provider.provider_id);
      if (!connected || !includeTools) {
        return {
          id: provider.provider_id,
          displayName: provider.display_name,
          connected,
          toolCount: null,
          status: connected ? "skip" : "warn",
        };
      }
      try {
        const tools = await bounded(client.listTools(provider.provider_id), timeoutMs);
        return {
          id: provider.provider_id,
          displayName: provider.display_name,
          connected: true,
          toolCount: tools.length,
          status: "pass",
        };
      } catch {
        return {
          id: provider.provider_id,
          displayName: provider.display_name,
          connected: true,
          toolCount: null,
          status: "fail",
        };
      }
    }),
  );
  for (const provider of providerReports) {
    checks.push({
      id: "provider:" + provider.id,
      status: provider.status,
      detail: provider.connected
        ? provider.toolCount == null
          ? "connected; tool catalog unavailable"
          : "connected; " + provider.toolCount + " tool(s)"
        : "not connected",
    });
  }
  return {
    schemaVersion: 1,
    generatedAt: options.now ?? new Date().toISOString(),
    registryStatus: inspected.status,
    localServers,
    brokerStatus: "available",
    providers: providerReports,
    checks,
  };
}

export function renderMcpDiagnostics(report: McpDiagnosticReport): string {
  const lines = [
    "MCP diagnostics v" + report.schemaVersion,
    "  registry: " + report.registryStatus,
    "  broker: " + report.brokerStatus,
  ];
  for (const server of report.localServers) {
    lines.push(
      "  local " + server.name + ": " + server.url + " (auth " + (server.authConfigured ? "configured" : "none") + ")",
    );
  }
  for (const provider of report.providers) {
    lines.push(
      "  provider " +
        provider.id +
        ": " +
        (provider.connected ? "connected" : "not connected") +
        (provider.toolCount == null ? "" : ", " + provider.toolCount + " tool(s)"),
    );
  }
  for (const check of report.checks) {
    lines.push("  [" + check.status + "] " + check.id + ": " + check.detail);
  }
  return lines.join("\n") + "\n";
}
