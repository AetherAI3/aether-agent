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
    title: id,
    run: async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return { configured: { state: "yes" as const, evidence: id }, severity: "info" as const };
    },
  });
  const checks = await executeDiagnosticChecks(
    [spec("first", 30), spec("second", 2), spec("third", 10)],
    3,
  );
  assert.deepEqual(checks.map((check) => check.id), ["first", "second", "third"]);
  assert.deepEqual(checks.map((check) => check.configured.state), ["yes", "yes", "yes"]);
  // An axis a check does not speak to defaults to not-checked, never to a pass.
  assert.deepEqual(checks.map((check) => check.verified.state), [
    "not-checked",
    "not-checked",
    "not-checked",
  ]);
});

test("fast doctor is local, ordered, fail-soft, and content-redacted", async () => {
  const { ctx, roots, store, client, counters } = setup();
  const report = await diagnosticReport(ctx, {
    dependencies: {
      now: "2026-07-10T00:00:00.000Z",
      memoryRoots: roots,
      mcpStore: store,
      mcpClient: client,
      outputDir: mkdtempSync(join(tmpdir(), "aether-doctor-media-")),
      timeoutMs: 50,
    },
  });
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.mode, "fast");
  assert.deepEqual(report.checks.map((check) => check.id), [
    "runtime.node",
    "workspace.directory",
    "workspace.git",
    "agent.transport",
    "auth.credential",
    "agent.catalog",
    "tools.schemas",
    "tools.gates",
    "memory.health",
    "mcp.registry",
    "mcp.broker",
    "persistence.local",
    "media.history",
    "opener.local",
    "github.connection",
    "custody.receipts",
    "actions.dispatch",
    "predator.readiness",
  ]);
  // The whole point of fast mode: nothing remote was contacted, and the report
  // says so instead of implying otherwise.
  assert.deepEqual(counters, { backend: 0, broker: 0 });
  assert.equal(
    report.checks.find((check) => check.id === "agent.transport")?.reachable.state,
    "not-checked",
  );
  assert.equal(
    report.checks.find((check) => check.id === "agent.catalog")?.verified.state,
    "not-checked",
  );
  assert.equal(JSON.stringify(report).includes(SECRET), false);
  assert.match(
    report.checks.find((check) => check.id === "memory.health")?.configured.evidence ?? "",
    /never auto-injected/,
  );
});

test("a surface this build does not have reports n/a, not a pass", async () => {
  const { ctx, roots, store, client } = setup();
  const report = await diagnosticReport(ctx, {
    dependencies: { memoryRoots: roots, mcpStore: store, mcpClient: client },
  });
  for (const id of ["actions.dispatch", "predator.readiness"]) {
    const check = report.checks.find((entry) => entry.id === id);
    assert.equal(check?.verified.state, "na", `${id} must not claim a pass`);
    assert.match(String(check?.verified.evidence), /this build has no/);
  }
});

test("fast doctor contacts nothing even when --deep is passed", async () => {
  const { ctx, roots, store, client, counters } = setup();
  const captured = sink();
  const code = await cmdDoctor(ctx, ["--deep"], {
    out: captured.out,
    dependencies: { memoryRoots: roots, mcpStore: store, mcpClient: client },
  });
  assert.equal(code, 0);
  assert.deepEqual(counters, { backend: 0, broker: 0 }, "--deep stayed read-only");
  // --deep must keep meaning what it meant, and point at the new mode.
  assert.match(captured.text(), /--deep is the read-only report \(unchanged\)/);
  assert.match(captured.text(), /aether doctor --live/);
});

test("a hanging backend cannot stall the fast report", async () => {
  const { ctx, roots, store } = setup();
  ctx.api = { getJson: async () => new Promise(() => {}) } as unknown as AppContext["api"];
  const hanging = {
    listProviders: async () => new Promise(() => {}),
    listConnections: async () => new Promise(() => {}),
    listTools: async () => new Promise(() => {}),
  } as unknown as McpClient;
  const started = Date.now();
  const report = await diagnosticReport(ctx, {
    dependencies: { memoryRoots: roots, mcpStore: store, mcpClient: hanging, timeoutMs: 50 },
  });
  assert.ok(Date.now() - started < 500);
  assert.equal(report.mode, "fast");
});

test("--live refuses rather than reporting fast-mode results as verified", async () => {
  const { ctx, roots, store, client } = setup();
  const captured = sink();
  const code = await cmdDoctor(ctx, ["--live"], {
    out: captured.out,
    dependencies: { memoryRoots: roots, mcpStore: store, mcpClient: client },
  });
  assert.equal(code, 2);
  assert.match(captured.text(), /--live is not available in this build/);
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
      outputDir: mkdtempSync(join(tmpdir(), "aether-doctor-json-")),
    },
  });
  assert.equal(code, 0);
  const parsed = JSON.parse(captured.text());
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.mode, "fast");
  assert.equal(parsed.generatedAt, "2026-07-10T00:00:00.000Z");
  assert.equal(captured.text().includes(SECRET), false);

  const bad = sink();
  assert.equal(await cmdDoctor(ctx, ["surprise"], { out: bad.out }), 2);
  assert.match(bad.text(), /usage/);
});
