import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextRegistry, type SnapshotData } from "../src/core/context_registry.js";
import type { ApiClient } from "../src/core/transport.js";
import {
  forgetCloudMemoryItem,
  forgetMemory,
  localMemoryReport,
  memoryReport,
  pruneMemory,
  type MemoryRoots,
} from "../src/core/memory.js";
import { normalizeWorkspace } from "../src/core/workspace_scope.js";

const SECRET = "SENTINEL-memory-content-must-never-leak";

function fixture(): { root: string; cwd: string; other: string; roots: MemoryRoots } {
  const root = mkdtempSync(join(tmpdir(), "aether-memory-"));
  const cwd = join(root, "current");
  const other = join(root, "other");
  mkdirSync(cwd);
  mkdirSync(other);
  const roots: MemoryRoots = {
    logs: join(root, "logs"),
    snapshots: join(root, "snapshots"),
    goals: join(root, "goals.json"),
    history: join(root, "current.history"),
    legacyHistory: join(root, "legacy.history"),
  };
  mkdirSync(roots.snapshots);
  return { root, cwd, other, roots };
}

function snapshot(cwd: string | undefined, createdAt: string): SnapshotData {
  return {
    createdAt,
    sessionLabel: SECRET,
    pins: [],
    drops: [],
    uvtCap: null,
    uvtSpent: 0,
    planPath: null,
    ...(cwd ? { cwd: normalizeWorkspace(cwd) } : {}),
    hudElements: [],
    hudTimer: { userMs: 0, agentMs: 0, phaseStart: 0, clock: "stopped" },
  };
}

function writeSnapshot(
  roots: MemoryRoots,
  id: string,
  cwd: string | undefined,
  createdAt: string,
): void {
  writeFileSync(join(roots.snapshots, `${id}.json`), JSON.stringify(snapshot(cwd, createdAt)));
}

test("local mode exposes working context only and marks agentic tiers cloud-only", () => {
  const { cwd, other, roots } = fixture();
  const registry = new ContextRegistry();
  registry.pin(join(cwd, "secret-file.txt"), SECRET, SECRET);
  writeSnapshot(roots, "current", cwd, "2020-01-01T00:00:00.000Z");
  writeSnapshot(roots, "other", other, "2020-01-01T00:00:00.000Z");
  writeSnapshot(roots, "legacy", undefined, "2020-01-01T00:00:00.000Z");
  writeFileSync(roots.goals, SECRET);
  writeFileSync(roots.history, SECRET);

  const report = localMemoryReport(cwd, registry, roots, "2026-07-10T00:00:00.000Z");
  assert.equal(report.agenticBackend, "cloud-only");
  assert.deepEqual(report.tiers.map((tier) => tier.tier), [
    "working",
    "episodic",
    "semantic",
    "procedural",
  ]);
  assert.equal(JSON.stringify(report).includes(SECRET), false);
  assert.equal(JSON.stringify(report).includes(normalizeWorkspace(cwd)), false);

  const snapshots = report.tiers[0]!.sources.find((source) => source.source === "snapshots")!;
  assert.deepEqual(
    [snapshots.current, snapshots.other, snapshots.unscoped, snapshots.account],
    [1, 1, 1, 0],
  );
  for (const tier of report.tiers.slice(1)) {
    assert.deepEqual(tier.items, []);
    assert.match(tier.sources[0]!.detail ?? "", /cloud-only QOPC/);
  }
});

test("prune is dry-run by default and only touches current-workspace local snapshots", () => {
  const { cwd, other, roots } = fixture();
  writeSnapshot(roots, "old-current", cwd, "2020-01-01T00:00:00.000Z");
  writeSnapshot(roots, "old-other", other, "2020-01-01T00:00:00.000Z");
  writeSnapshot(roots, "old-legacy", undefined, "2020-01-01T00:00:00.000Z");
  writeSnapshot(roots, "recent-current", cwd, "2026-07-09T00:00:00.000Z");
  const now = Date.parse("2026-07-10T00:00:00.000Z");

  const dry = pruneMemory(30, false, cwd, new ContextRegistry(), roots, now);
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.candidates.map((item) => item.id), ["snapshot:old-current.json"]);
  assert.equal(existsSync(join(roots.snapshots, "old-current.json")), true);

  const applied = pruneMemory(30, true, cwd, new ContextRegistry(), roots, now);
  assert.deepEqual(applied.removed, ["snapshot:old-current.json"]);
  assert.equal(existsSync(join(roots.snapshots, "old-current.json")), false);
  assert.equal(existsSync(join(roots.snapshots, "old-other.json")), true);
  assert.equal(existsSync(join(roots.snapshots, "old-legacy.json")), true);
});

test("typed local forget rejects cross-workspace, legacy, and traversal-shaped ids", () => {
  const { cwd, other, roots } = fixture();
  writeSnapshot(roots, "current", cwd, "2020-01-01T00:00:00.000Z");
  writeSnapshot(roots, "other", other, "2020-01-01T00:00:00.000Z");
  writeSnapshot(roots, "legacy", undefined, "2020-01-01T00:00:00.000Z");
  const registry = new ContextRegistry();

  assert.throws(
    () => forgetMemory("working", "snapshot:other.json", cwd, registry, roots),
    /not deletable/,
  );
  assert.throws(
    () => forgetMemory("working", "snapshot:legacy.json", cwd, registry, roots),
    /not deletable/,
  );
  assert.throws(
    () => forgetMemory("working", "snapshot:..\\escape", cwd, registry, roots),
    /not found/,
  );
  forgetMemory("working", "snapshot:current.json", cwd, registry, roots);
  assert.equal(existsSync(join(roots.snapshots, "current.json")), false);
});

test("unavailable QOPC times out and degrades without blocking working metadata", async () => {
  const { cwd, roots } = fixture();
  writeSnapshot(roots, "current", cwd, "2026-07-01T00:00:00.000Z");
  const api = {
    getJson: async () => new Promise(() => {}),
  } as unknown as ApiClient;
  const started = Date.now();
  const report = await memoryReport(
    api,
    cwd,
    new ContextRegistry(),
    roots,
    "2026-07-10T00:00:00.000Z",
    50,
  );
  assert.ok(Date.now() - started < 500);
  assert.equal(report.agenticBackend, "qopc");
  assert.equal(report.tiers[0]!.items.length, 1);
  assert.equal(report.tiers[1]!.sources[0]!.status, "unavailable");
  assert.equal(report.tiers[3]!.sources[0]!.status, "unavailable");
});

test("cloud QOPC facts and skills populate only durable agentic tiers without exposing content", async () => {
  const { cwd, roots } = fixture();
  const fact = "11111111-1111-4111-8111-111111111111";
  const semantic = "22222222-2222-4222-8222-222222222222";
  const skill = "33333333-3333-4333-8333-333333333333";
  const api = {
    getJson: async (path: string) => {
      assert.equal(path, "/agent/memory/qopc?limit=100");
      return {
        memories: [
          { fact_id: fact, kind: "episodic", text: SECRET, created_at: "2026-07-01T00:00:00Z" },
          { fact_id: semantic, kind: "semantic", text: SECRET, created_at: "2026-07-02T00:00:00Z" },
        ],
        skills: [
          { id: skill, skill_name: SECRET, description: SECRET, last_seen_at: "2026-07-03T00:00:00Z" },
        ],
      };
    },
  } as unknown as ApiClient;

  const report = await memoryReport(
    api,
    cwd,
    new ContextRegistry(),
    roots,
    "2026-07-10T00:00:00.000Z",
    100,
  );
  assert.equal(report.agenticBackend, "qopc");
  assert.equal(JSON.stringify(report).includes(SECRET), false);
  assert.equal(report.tiers[1]!.items.some((item) => item.id === `qopc-episodic:${fact}`), true);
  assert.equal(report.tiers[2]!.items.some((item) => item.id === `qopc-semantic:${semantic}`), true);
  assert.equal(report.tiers[3]!.items.some((item) => item.id === `qopc-skill:${skill}`), true);
  assert.equal(report.tiers[1]!.sources[0]!.account, 1);
});

test("cloud forget preserves tier typing and delegates only an owner-scoped UUID", async () => {
  const fact = "11111111-1111-4111-8111-111111111111";
  const paths: string[] = [];
  const api = {
    deleteJson: async (path: string) => {
      paths.push(path);
      return { deleted: true };
    },
  } as unknown as ApiClient;

  await forgetCloudMemoryItem(api, "episodic", `qopc-episodic:${fact}`);
  assert.deepEqual(paths, [`/agent/memory/qopc/memory/${fact}`]);
  await assert.rejects(
    forgetCloudMemoryItem(api, "semantic", `qopc-episodic:${fact}`),
    /does not match this tier/,
  );
  assert.equal(paths.length, 1);
});
