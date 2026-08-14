import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AppContext } from "./context.js";
import { configDir } from "./config.js";
import { isCredentialSafeUrl, MODELS_PATH } from "./transport.js";
import { gateActionFor } from "./autonomy.js";
import { validateToolDefinitionCoverage } from "./tool_registry.js";
import { localMemoryReport, type MemoryRoots } from "./memory.js";
import { LocalMcpStore } from "./mcp_store.js";
import { McpClient } from "./mcp.js";
import { bounded, collectMcpDiagnostics } from "./mcp_diagnostics.js";

export const DIAGNOSTIC_CONCURRENCY = 8;

export type DiagnosticStatus = "pass" | "warn" | "fail" | "skip";

export interface DiagnosticCheck {
  id: string;
  category: string;
  status: DiagnosticStatus;
  detail: string;
  durationMs: number;
}

export interface DiagnosticReport {
  schemaVersion: 1;
  generatedAt: string;
  deep: boolean;
  checks: DiagnosticCheck[];
  summary: Record<DiagnosticStatus, number>;
}

export interface DiagnosticCheckSpec {
  id: string;
  category: string;
  run(): Promise<{ status: DiagnosticStatus; detail: string }> | { status: DiagnosticStatus; detail: string };
}

export interface DiagnosticDependencies {
  now?: string;
  mcpClient?: McpClient;
  mcpStore?: LocalMcpStore;
  memoryRoots?: MemoryRoots;
  timeoutMs?: number;
}

function monotonicMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

export async function executeDiagnosticChecks(
  specs: DiagnosticCheckSpec[],
  concurrency = DIAGNOSTIC_CONCURRENCY,
): Promise<DiagnosticCheck[]> {
  const width = Math.max(1, Math.min(Math.floor(concurrency), 32));
  const results: DiagnosticCheck[] = new Array(specs.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= specs.length) return;
      const spec = specs[index]!;
      const started = monotonicMs();
      try {
        const result = await spec.run();
        results[index] = {
          id: spec.id,
          category: spec.category,
          status: result.status,
          detail: result.detail,
          durationMs: Math.max(0, monotonicMs() - started),
        };
      } catch {
        results[index] = {
          id: spec.id,
          category: spec.category,
          status: "fail",
          detail: "check failed safely",
          durationMs: Math.max(0, monotonicMs() - started),
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, specs.length) }, () => worker()));
  return results;
}

function nearestExisting(path: string): string {
  let current = resolve(path);
  while (!existsSync(current) && dirname(current) !== current) current = dirname(current);
  return current;
}

export async function diagnosticReport(
  ctx: AppContext,
  deep: boolean,
  dependencies: DiagnosticDependencies = {},
): Promise<DiagnosticReport> {
  const timeoutMs = Math.max(100, Math.min(dependencies.timeoutMs ?? 2000, 10000));
  const mcpStore = dependencies.mcpStore ?? new LocalMcpStore();
  const mcpClient = dependencies.mcpClient ?? new McpClient(ctx.api);
  const specs: DiagnosticCheckSpec[] = [
    {
      id: "runtime.node",
      category: "runtime",
      run: () => {
        // Must track package.json's engines.node — this project's own test
        // script needs Node 24 (`--test --test-isolation` support).
        const MIN_SUPPORTED_NODE_MAJOR = 24;
        const major = Number(process.versions.node.split(".")[0]);
        return {
          status: major >= MIN_SUPPORTED_NODE_MAJOR ? "pass" : "fail",
          detail:
            major >= MIN_SUPPORTED_NODE_MAJOR
              ? "Node runtime supported"
              : `Node ${MIN_SUPPORTED_NODE_MAJOR} or newer required`,
        };
      },
    },
    {
      id: "workspace.directory",
      category: "workspace",
      run: () => {
        const target = resolve(ctx.flags.cwd);
        const valid = existsSync(target) && statSync(target).isDirectory();
        return {
          status: valid ? "pass" : "fail",
          detail: valid ? "workspace directory available" : "workspace directory unavailable",
        };
      },
    },
    {
      id: "workspace.git",
      category: "workspace",
      run: () => ({
        status: existsSync(join(ctx.flags.cwd, ".git")) ? "pass" : "warn",
        detail: existsSync(join(ctx.flags.cwd, ".git"))
          ? "git metadata detected"
          : "workspace is not a git checkout",
      }),
    },
    {
      id: "configuration.transport",
      category: "configuration",
      run: () => ({
        status: isCredentialSafeUrl(ctx.cfg.baseUrl) ? "pass" : "fail",
        detail: isCredentialSafeUrl(ctx.cfg.baseUrl)
          ? "backend URL transport is credential-safe"
          : "backend URL transport is unsafe",
      }),
    },
    {
      id: "authentication",
      category: "auth",
      run: async () => {
        const configured = Boolean(await ctx.tokens.get());
        return {
          status: configured ? "pass" : "warn",
          detail: configured ? "credential configured" : "signed out",
        };
      },
    },
    {
      id: "backend.catalog",
      category: "backend",
      run: async () => {
        if (!deep) return { status: "skip", detail: "deep check not requested" };
        try {
          await bounded(ctx.api.getJson(MODELS_PATH), timeoutMs);
          return { status: "pass", detail: "bounded catalog request succeeded" };
        } catch {
          return { status: "warn", detail: "backend catalog unavailable" };
        }
      },
    },
    {
      id: "tools.schemas",
      category: "tools",
      run: () => {
        const errors = validateToolDefinitionCoverage();
        return {
          status: errors.length ? "fail" : "pass",
          detail: errors.length ? "tool schema coverage incomplete" : "all protocol tools have schemas",
        };
      },
    },
    {
      id: "tools.gates",
      category: "tools",
      run: () => {
        const valid =
          gateActionFor("write_file") === "write" &&
          gateActionFor("run_shell") === "shell" &&
          gateActionFor("run_tests") === "shell" &&
          gateActionFor("git_commit") === "shell" &&
          gateActionFor("web_search") === "network" &&
          gateActionFor("web_fetch") === "network" &&
          gateActionFor("read_file") === null;
        return {
          status: valid ? "pass" : "fail",
          detail: valid ? "side-effect gates are fail-closed" : "tool gate mapping drifted",
        };
      },
    },
    {
      id: "memory.health",
      category: "memory",
      run: () => {
        const report = localMemoryReport(
          ctx.flags.cwd,
          undefined,
          dependencies.memoryRoots,
          dependencies.now,
        );
        const sources = report.tiers.flatMap((tier) => tier.sources);
        const failed = sources.some((source) => source.status === "degraded");
        const unscoped = sources.reduce((sum, source) => sum + source.unscoped, 0);
        return {
          status: failed ? "warn" : "pass",
          detail:
            (failed ? "one or more stores are degraded; " : "") +
            unscoped +
            " legacy unscoped record(s), never auto-injected",
        };
      },
    },
    {
      id: "mcp.registry",
      category: "mcp",
      run: () => {
        const state = mcpStore.inspect();
        return {
          status:
            state.status === "corrupt" || state.status === "unreadable"
              ? "fail"
              : state.status === "missing"
                ? "warn"
                : "pass",
          detail: "local MCP registry " + state.status,
        };
      },
    },
    {
      id: "mcp.broker",
      category: "mcp",
      run: async () => {
        if (!deep) return { status: "skip", detail: "deep check not requested" };
        const report = await collectMcpDiagnostics(mcpClient, mcpStore, {
          timeoutMs,
          includeToolCounts: true,
          now: dependencies.now,
        });
        return {
          status: report.brokerStatus === "available" ? "pass" : "warn",
          detail:
            report.brokerStatus === "available"
              ? report.providers.length + " provider(s) diagnosed"
              : "broker unavailable",
        };
      },
    },
    {
      id: "persistence.local",
      category: "persistence",
      run: () => {
        try {
          accessSync(nearestExisting(configDir()), constants.R_OK | constants.W_OK);
          return { status: "pass", detail: "local persistence root is readable and writable" };
        } catch {
          return { status: "fail", detail: "local persistence root is unavailable" };
        }
      },
    },
  ];

  const checks = await executeDiagnosticChecks(specs);
  const summary: Record<DiagnosticStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of checks) summary[check.status] += 1;
  return {
    schemaVersion: 1,
    generatedAt: dependencies.now ?? new Date().toISOString(),
    deep,
    checks,
    summary,
  };
}

export function renderDiagnosticReport(report: DiagnosticReport): string {
  const lines = [
    "Aether doctor v" + report.schemaVersion + (report.deep ? " (deep)" : ""),
  ];
  for (const check of report.checks) {
    lines.push("  [" + check.status + "] " + check.id + ": " + check.detail);
  }
  lines.push(
    "Summary: " +
      report.summary.pass +
      " pass, " +
      report.summary.warn +
      " warn, " +
      report.summary.fail +
      " fail, " +
      report.summary.skip +
      " skip",
  );
  return lines.join("\n") + "\n";
}
