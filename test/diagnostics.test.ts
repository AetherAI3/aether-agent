import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { cmdDoctor } from "../src/commands/doctor.js";
import type { AppContext } from "../src/core/context.js";
import {
  diagnosticReport,
  executeDiagnosticChecks,
  type DiagnosticCheckSpec,
} from "../src/core/diagnostics.js";
import type { McpClient } from "../src/core/mcp.js";
import { LocalMcpStore } from "../src/core/mcp_store.js";
import type { MemoryRoots } from "../src/core/memory.js";

const SECRET = "SENTINEL-doctor-never-exposes-this";

function setup(): {
  ctx: AppContext;
  roots: MemoryRoots;
  store: LocalMcpStore;
  client: McpClient;
  counters: { backend: number; broker: number };
} {
  const root = mkdtempSync(join(tmpdir(), "aether-doctor-"));
  const cwd = join(root, "workspace");
  mkdirSync(cwd);
  mkdirSync(join(cwd, ".git"));
  const logs = join(root, "logs");
  const snapshots = join(root, "snapshots");
  mkdirSync(logs);
  mkdirSync(snapshots);
  const goals = join(root, "goals.json");
  writeFileSync(
    goals,
    JSON.stringify([
      {
        id: "legacy",
        title: SECRET,
        phases: [],
        status: "idle",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]),
  );
  const roots: MemoryRoots = {
    logs,
    snapshots,
    goals,
    history: join(root, "history"),
    legacyHistory: join(root, "legacy-history"),
  };
  writeFileSync(roots.legacyHistory, SECRET);
  const store = new LocalMcpStore(join(root, "mcp.json"));
  store.add({
    name: "docs",
    url: "https://mcp.example.test/sse?token=" + SECRET,
    transport: "http",
    authToken: SECRET,
  });
  const counters = { backend: 0, broker: 0 };
  const ctx = {
    cfg: { baseUrl: "https://api.example.test" },
    flags: { cwd, json: false, audit: false, yes: false },
    tokens: { get: async () => SECRET },
    api: {
      async getJson() {
        counters.backend += 1;
        return { models: [] };
      },
    },
    confirm: async () => false,
  } as unknown as AppContext;
  const client = {
    async listProviders() {
      counters.broker += 1;
      return [{ provider_id: "docs", display_name: "Docs", flow: "pat_paste" }];
    },
    async listConnections() {
      counters.broker += 1;
      return [{ provider_id: "docs", created_at: "t", updated_at: "t" }];
    },
    async listTools() {
      counters.broker += 1;
      return [{ name: "search" }];
    },
  } as unknown as McpClient;
  return { ctx, roots, store, client, counters };
}

function sink(): { out: Writable; text(): string } {
  const chunks: string[] = [];
  return {
    out: { write: (value: string) => (chunks.push(value), true) } as unknown as Writable,
    text: () => chunks.join(""),
  };
}

test("diagnostic executor preserves declaration order under concurrency", async () => {
  const spec = (id: string, delay: number): DiagnosticCheckSpec => ({
    id,
    category: "test",
    run: async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return { status: "pass", detail: id };
    },
  });
  const checks = await executeDiagnosticChecks(
    [spec("first", 30), spec("second", 2), spec("third", 10)],
    3,
  );
  assert.deepEqual(checks.map((check) => check.id), ["first", "second", "third"]);
  assert.deepEqual(checks.map((check) => check.status), ["pass", "pass", "pass"]);
});

test("default doctor is fast/local, ordered, fail-soft, and content-redacted", async () => {
  const { ctx, roots, store, client, counters } = setup();
  const report = await diagnosticReport(ctx, false, {
    now: "2026-07-10T00:00:00.000Z",
    memoryRoots: roots,
    mcpStore: store,
    mcpClient: client,
    timeoutMs: 50,
  });
  assert.deepEqual(report.checks.map((check) => check.id), [
    "runtime.node",
    "workspace.directory",
    "workspace.git",
    "configuration.transport",
    "authentication",
    "backend.catalog",
    "tools.schemas",
    "tools.gates",
    "memory.health",
    "mcp.registry",
    "mcp.broker",
    "persistence.local",
  ]);
  assert.equal(report.checks.find((check) => check.id === "backend.catalog")?.status, "skip");
  assert.equal(report.checks.find((check) => check.id === "mcp.broker")?.status, "skip");
  assert.deepEqual(counters, { backend: 0, broker: 0 });
  assert.equal(JSON.stringify(report).includes(SECRET), false);
  assert.match(
    report.checks.find((check) => check.id === "memory.health")?.detail ?? "",
    /never auto-injected/,
  );
});

test("deep doctor performs bounded backend and broker/catalog checks", async () => {
  const { ctx, roots, store, client, counters } = setup();
  const report = await diagnosticReport(ctx, true, {
    memoryRoots: roots,
    mcpStore: store,
    mcpClient: client,
    timeoutMs: 100,
  });
  assert.equal(report.deep, true);
  assert.equal(report.checks.find((check) => check.id === "backend.catalog")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "mcp.broker")?.status, "pass");
  assert.equal(counters.backend, 1);
  assert.equal(counters.broker, 3);
  assert.equal(JSON.stringify(report).includes(SECRET), false);
});

test("deep doctor bounds unavailable API and broker timeouts", async () => {
  const { ctx, roots, store } = setup();
  ctx.api = { getJson: async () => new Promise(() => {}) } as unknown as AppContext["api"];
  const hanging = {
    listProviders: async () => new Promise(() => {}),
    listConnections: async () => new Promise(() => {}),
    listTools: async () => new Promise(() => {}),
  } as unknown as McpClient;
  const started = Date.now();
  const report = await diagnosticReport(ctx, true, {
    memoryRoots: roots,
    mcpStore: store,
    mcpClient: hanging,
    timeoutMs: 50,
  });
  assert.ok(Date.now() - started < 500);
  assert.equal(report.checks.find((check) => check.id === "backend.catalog")?.status, "warn");
  assert.equal(report.checks.find((check) => check.id === "mcp.broker")?.status, "warn");
});

test("doctor command supports JSON and rejects unknown arguments", async () => {
  const { ctx, roots, store, client } = setup();
  ctx.flags.json = true;
  const captured = sink();
  const code = await cmdDoctor(ctx, [], {
    out: captured.out,
    dependencies: {
      memoryRoots: roots,
      mcpStore: store,
      mcpClient: client,
      now: "2026-07-10T00:00:00.000Z",
    },
  });
  assert.equal(code, 0);
  const parsed = JSON.parse(captured.text());
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(captured.text().includes(SECRET), false);

  const bad = sink();
  assert.equal(await cmdDoctor(ctx, ["surprise"], { out: bad.out }), 2);
  assert.match(bad.text(), /usage/);
});
