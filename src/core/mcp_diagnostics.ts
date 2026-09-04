import type { McpClient, McpConnection, McpProvider } from "./mcp.js";
import { LocalMcpStore, sanityCheckUrl } from "./mcp_store.js";
import {
  McpOperationSupervisor,
  McpOperationTimeoutError,
  probeLocalMcpServer,
  type LocalMcpReachability,
} from "./mcp_lifecycle.js";
import { sanitizeTerm } from "../ui/text.js";

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
  /** Null means no network probe was requested. Reachable is not verified. */
  reachable: boolean | null;
  verified: false;
  lastFailure?: string;
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
  includeLocalReachability?: boolean;
  localProbe?: (url: string, signal: AbortSignal) => Promise<LocalMcpReachability>;
  now?: string;
}

export function redactMcpUrl(value: string): string {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin === "null") {
      return "[invalid URL]";
    }
    return `${url.origin}/[path redacted]`;
  } catch {
    return "[invalid URL]";
  }
}

export async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
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
  const supervisor = new McpOperationSupervisor();
  const inspected = store.inspect();
  const localServers: RedactedLocalMcpServer[] = inspected.servers.map((server) => ({
    name: server.name,
    url: redactMcpUrl(server.url),
    transport: server.transport,
    authConfigured: Boolean(server.authToken),
    reachable: null,
    verified: false as const,
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

  if (options.includeLocalReachability) {
    const probe = options.localProbe ?? probeLocalMcpServer;
    const localChecks = await Promise.all(inspected.servers.map(async (server, index) => {
      const local = localServers[index];
      if (!local || sanityCheckUrl(server.url)) return null;
      try {
        const result = await supervisor.run(
          `local reachability test for ${server.name}`,
          (signal) => probe(server.url, signal),
          { timeoutMs },
        );
        local.reachable = true;
        if (!result.serviceHealthy) local.lastFailure = `service returned HTTP ${result.httpStatus}`;
        return {
          id: "local-reachability:" + server.name,
          status: result.serviceHealthy ? "pass" as const : "fail" as const,
          detail: result.detail,
        };
      } catch (error) {
        local.reachable = false;
        local.lastFailure = error instanceof McpOperationTimeoutError
          ? "reachability test timed out"
          : "reachability test failed";
        return {
          id: "local-reachability:" + server.name,
          status: "fail" as const,
          detail: error instanceof McpOperationTimeoutError
            ? error.message
            : "reachability probe failed; stored credentials were not sent; run `aether mcp doctor`",
        };
      }
    }));
    for (const check of localChecks) {
      if (check) checks.push(check);
    }
  }

  let providers: McpProvider[] = [];
  let connections: McpConnection[] = [];
  try {
    [providers, connections] = await supervisor.run(
      "broker discovery",
      (signal) => Promise.all([
        client.listProviders({ signal, timeoutMs }),
        client.listConnections({ signal, timeoutMs }),
      ]),
      { timeoutMs },
    );
    checks.push({
      id: "broker",
      status: "pass",
      detail: providers.length + " provider(s), " + connections.length + " connected",
    });
  } catch {
    checks.push({ id: "broker", status: "warn", detail: "broker unavailable" });
    const report: McpDiagnosticReport = {
      schemaVersion: 1,
      generatedAt: options.now ?? new Date().toISOString(),
      registryStatus: inspected.status,
      localServers,
      brokerStatus: "unavailable",
      providers: [],
      checks,
    };
    supervisor.dispose();
    return report;
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
        const tools = await supervisor.run(
          `tool catalog for ${provider.provider_id}`,
          (signal) => client.listTools(provider.provider_id, { signal, timeoutMs }),
          { timeoutMs },
        );
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
  const report: McpDiagnosticReport = {
    schemaVersion: 1,
    generatedAt: options.now ?? new Date().toISOString(),
    registryStatus: inspected.status,
    localServers,
    brokerStatus: "available",
    providers: providerReports,
    checks,
  };
  supervisor.dispose();
  return report;
}

function diagnosticLine(value: string): string {
  return sanitizeTerm(value).replace(/[\r\n]/g, " ");
}

export function renderMcpDiagnostics(report: McpDiagnosticReport): string {
  const lines = [
    "MCP diagnostics v" + report.schemaVersion,
    "  registry: " + report.registryStatus,
    "  broker: " + report.brokerStatus,
  ];
  for (const server of report.localServers) {
    lines.push(
      "  local " + diagnosticLine(server.name) + ": " + diagnosticLine(server.url) +
        " (auth " + (server.authConfigured ? "configured" : "none") + ")",
    );
  }
  for (const provider of report.providers) {
    lines.push(
      "  provider " +
        diagnosticLine(provider.id) +
        ": " +
        (provider.connected ? "connected" : "not connected") +
        (provider.toolCount == null ? "" : ", " + provider.toolCount + " tool(s)"),
    );
  }
  for (const check of report.checks) {
    lines.push(
      "  [" + check.status + "] " + diagnosticLine(check.id) + ": " + diagnosticLine(check.detail),
    );
  }
  return lines.join("\n") + "\n";
}
