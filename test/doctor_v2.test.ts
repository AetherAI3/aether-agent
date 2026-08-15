import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { cmdDoctor } from "../src/commands/doctor.js";
import type { AppContext } from "../src/core/context.js";
import { doctorReportV2, type DoctorReportV2 } from "../src/core/diagnostics.js";
import type { McpClient } from "../src/core/mcp.js";
import { LocalMcpStore } from "../src/core/mcp_store.js";
import type { MemoryRoots } from "../src/core/memory.js";

interface Fixture {
  ctx: AppContext;
  cwd: string;
  roots: MemoryRoots;
  store: LocalMcpStore;
  client: McpClient;
  counters: { backend: number; broker: number; probe: number };
  restore(): void;
}

function setup(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "aether-doctor2-"));
  const cwd = join(root, "workspace");
  mkdirSync(cwd);
  mkdirSync(join(cwd, ".git"));
  const configDir = join(root, "config");
  mkdirSync(configDir, { recursive: true });
  const previousConfig = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = configDir;
  const logs = join(root, "logs");
  const snapshots = join(root, "snapshots");
  mkdirSync(logs);
  mkdirSync(snapshots);
  const goals = join(root, "goals.json");
  writeFileSync(goals, "[]");
  const roots: MemoryRoots = {
    logs,
    snapshots,
    goals,
    history: join(root, "history"),
    legacyHistory: join(root, "legacy-history"),
  };
  const store = new LocalMcpStore(join(root, "mcp.json"));
  const counters = { backend: 0, broker: 0, probe: 0 };
  const ctx = {
    cfg: { baseUrl: "https://api.example.test" },
    flags: { cwd, json: false, audit: false, yes: false },
    tokens: { get: async () => "credential" },
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
      return [];
    },
    async listConnections() {
      counters.broker += 1;
      return [];
    },
    async listTools() {
      counters.broker += 1;
      return [];
    },
  } as unknown as McpClient;
  return {
    ctx,
    cwd,
    roots,
    store,
    client,
    counters,
    restore: () => {
      if (previousConfig == null) delete process.env["AETHER_CONFIG_DIR"];
      else process.env["AETHER_CONFIG_DIR"] = previousConfig;
    },
  };
}

function projectSkill(cwd: string, name: string): void {
  const dir = join(cwd, ".aether", "skills", "project", name);
  mkdirSync(dir, { recursive: true });
  const manifest = {
    schema_version: 1,
    id: "project/" + name,
    version: "0.1.0",
    name,
    description: "Fixture skill for doctor tests.",
    entrypoint: "SKILL.md",
    triggers: { commands: [], phrases: [], automatic: false },
    tools: { allowed: [], required: [], denied: [] },
    permissions: { requires: [], may_request: [], forbids: [] },
    context: { max_tokens: 2000, resources: [] },
    outputs: { kinds: [], verification: [] },
    dependencies: { skills: [] },
    compatibility: { min_agent_version: "0.1.0", capability_contract: 1 },
    health: { eval_manifest: null },
  };
  writeFileSync(join(dir, "skill.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  writeFileSync(join(dir, "SKILL.md"), "# " + name + "\n", "utf8");
}

function sink(): { out: Writable; text(): string } {
  const chunks: string[] = [];
  return {
    out: { write: (value: string) => (chunks.push(value), true) } as unknown as Writable,
    text: () => chunks.join(""),
  };
}

function byId(report: DoctorReportV2, id: string) {
  return report.checks.find((check) => check.id === id);
}

test("v2 fast report has the schema shape and never touches the network", async () => {
  const fixture = setup();
  try {
    const report = await doctorReportV2(
      fixture.ctx,
      { mode: "fast" },
      {
        now: "2026-08-14T00:00:00.000Z",
        memoryRoots: fixture.roots,
        mcpStore: fixture.store,
        mcpClient: fixture.client,
        apiProbe: async () => {
          fixture.counters.probe += 1;
          throw new Error("fast mode must never call the probe");
        },
      },
    );
    assert.equal(report.schema_version, 2);
    assert.equal(report.mode, "fast");
    assert.equal(report.generated_at, "2026-08-14T00:00:00.000Z");
    assert.equal(report.capability_contract, null);
    for (const check of report.checks) {
      assert.deepEqual(check.evidence, { metadata_only: true });
      assert.ok(check.duration_ms >= 0);
      assert.ok(["info", "warning", "critical"].includes(check.severity));
      assert.equal(typeof check.configured, "boolean");
      assert.equal(typeof check.reachable, "boolean");
      assert.equal(typeof check.verified, "boolean");
    }
    assert.equal(byId(report, "backend.catalog")?.status, "skip");
    assert.equal(byId(report, "backend.capabilities")?.status, "skip");
    assert.equal(byId(report, "mcp.broker")?.status, "skip");
    assert.deepEqual(fixture.counters, { backend: 0, broker: 0, probe: 0 });
    const total = report.checks.length;
    const summed = report.summary.pass + report.summary.warn + report.summary.fail + report.summary.skip;
    assert.equal(summed, total);
  } finally {
    fixture.restore();
  }
});

test("network mode calls the capability probe and records the contract", async () => {
  const fixture = setup();
  try {
    const report = await doctorReportV2(
      fixture.ctx,
      { mode: "network" },
      {
        memoryRoots: fixture.roots,
        mcpStore: fixture.store,
        mcpClient: fixture.client,
        timeoutMs: 200,
        apiProbe: async () => {
          fixture.counters.probe += 1;
          return { version: 3, digest: "abc123def456" };
        },
      },
    );
    assert.equal(fixture.counters.probe, 1);
    assert.deepEqual(report.capability_contract, { version: 3, digest: "abc123def456" });
    assert.equal(byId(report, "backend.capabilities")?.status, "pass");
    assert.equal(byId(report, "backend.catalog")?.status, "pass");
  } finally {
    fixture.restore();
  }
});

test("category filter narrows the executed checks", async () => {
  const fixture = setup();
  try {
    const report = await doctorReportV2(
      fixture.ctx,
      { mode: "fast", categories: ["runtime", "workspace"] },
      { memoryRoots: fixture.roots, mcpStore: fixture.store, mcpClient: fixture.client },
    );
    assert.deepEqual(
      report.checks.map((check) => check.id),
      ["runtime.node", "workspace.directory", "workspace.git"],
    );
  } finally {
    fixture.restore();
  }
});

test("--failed emits only warn/fail checks while keeping the full summary", async () => {
  const fixture = setup();
  try {
    projectSkill(fixture.cwd, "fixture"); // untrusted + unlocked → warns
    fixture.ctx.flags.json = true;
    const captured = sink();
    const code = await cmdDoctor(fixture.ctx, ["--schema", "v2", "--failed", "--category", "skills"], {
      out: captured.out,
      dependencies: { memoryRoots: fixture.roots, mcpStore: fixture.store, mcpClient: fixture.client },
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(captured.text()) as DoctorReportV2;
    assert.ok(parsed.checks.length > 0);
    for (const check of parsed.checks) {
      assert.ok(check.status === "warn" || check.status === "fail");
    }
    assert.ok(parsed.summary.pass + parsed.summary.warn + parsed.summary.fail + parsed.summary.skip > parsed.checks.length);
  } finally {
    fixture.ctx.flags.json = false;
    fixture.restore();
  }
});

test("--junit writes a JUnit XML report", async () => {
  const fixture = setup();
  try {
    const junitPath = join(fixture.cwd, "doctor.xml");
    const captured = sink();
    const code = await cmdDoctor(fixture.ctx, ["--junit", junitPath], {
      out: captured.out,
      dependencies: { memoryRoots: fixture.roots, mcpStore: fixture.store, mcpClient: fixture.client },
    });
    assert.equal(code, 0);
    const xml = readFileSync(junitPath, "utf8");
    assert.match(xml, /<testsuites tests="/);
    assert.match(xml, /name="runtime\.node"/);
    assert.match(xml, /<skipped\/>/); // network checks skip in fast mode
  } finally {
    fixture.restore();
  }
});

test("--json default stays v1-shaped for old consumers", async () => {
  const fixture = setup();
  try {
    fixture.ctx.flags.json = true;
    const captured = sink();
    const code = await cmdDoctor(fixture.ctx, [], {
      out: captured.out,
      dependencies: { memoryRoots: fixture.roots, mcpStore: fixture.store, mcpClient: fixture.client },
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(captured.text()) as Record<string, unknown>;
    assert.equal(parsed["schemaVersion"], 1);
    assert.equal(parsed["deep"], false);
    const checks = parsed["checks"] as Record<string, unknown>[];
    assert.ok(checks.length > 0);
    for (const check of checks) {
      assert.equal(typeof check["durationMs"], "number");
      assert.equal(check["severity"], undefined);
      assert.equal(check["evidence"], undefined);
    }
  } finally {
    fixture.ctx.flags.json = false;
    fixture.restore();
  }
});

test("skills checks flag index errors, lock drift, trust, and missing evals", async () => {
  const fixture = setup();
  try {
    projectSkill(fixture.cwd, "good");
    const broken = join(fixture.cwd, ".aether", "skills", "project", "broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "skill.json"), "{not json", "utf8");
    // Lock records the skill with a different digest → "changed" drift.
    writeFileSync(
      join(fixture.cwd, ".aether", "skills.lock.json"),
      JSON.stringify({
        schema_version: 1,
        skills: [
          { id: "project/good", version: "0.1.0", source: "x", sha256: "0".repeat(64), dependencies: [] },
        ],
      }),
      "utf8",
    );
    const report = await doctorReportV2(
      fixture.ctx,
      { mode: "fast", categories: ["skills"] },
      { mcpStore: fixture.store, mcpClient: fixture.client },
    );
    assert.equal(byId(report, "skills.index")?.status, "warn");
    assert.match(byId(report, "skills.index")?.detail ?? "", /1 index error/);
    assert.equal(byId(report, "skills.lock")?.status, "warn");
    assert.match(byId(report, "skills.lock")?.detail ?? "", /1 changed/);
    assert.match(byId(report, "skills.lock")?.detail ?? "", /aether skills lock/);
    assert.equal(byId(report, "skills.trust")?.status, "warn");
    assert.match(byId(report, "skills.trust")?.detail ?? "", /untrusted or changed/);
    assert.equal(byId(report, "skills.evals")?.status, "warn");
    assert.match(byId(report, "skills.evals")?.detail ?? "", /no eval manifest/);
    // Details are metadata-only: never file contents.
    for (const check of report.checks) assert.ok(!check.detail.includes("not json"));
  } finally {
    fixture.restore();
  }
});

test("instruction checks report sources and conflicts", async () => {
  const fixture = setup();
  try {
    writeFileSync(join(fixture.cwd, "AGENTS.md"), "Run `npm test` before pushing.\n", "utf8");
    writeFileSync(join(fixture.cwd, "CLAUDE.md"), "Always verify with `pnpm test`.\n", "utf8");
    const report = await doctorReportV2(
      fixture.ctx,
      { mode: "fast", categories: ["instructions"] },
      { mcpStore: fixture.store, mcpClient: fixture.client },
    );
    assert.equal(byId(report, "instructions.graph")?.status, "pass");
    assert.match(byId(report, "instructions.graph")?.detail ?? "", /2 instruction source/);
    assert.equal(byId(report, "instructions.conflicts")?.status, "warn");
    assert.match(byId(report, "instructions.conflicts")?.detail ?? "", /test command/);
  } finally {
    fixture.restore();
  }
});

test("clean workspace passes skills and instructions checks", async () => {
  const fixture = setup();
  try {
    const report = await doctorReportV2(
      fixture.ctx,
      { mode: "fast", categories: ["skills", "instructions"] },
      { mcpStore: fixture.store, mcpClient: fixture.client },
    );
    for (const check of report.checks) {
      assert.equal(check.status, "pass", check.id + ": " + check.detail);
    }
    assert.ok(existsSync(fixture.cwd));
  } finally {
    fixture.restore();
  }
});
