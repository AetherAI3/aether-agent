import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { AppContext } from "../src/core/context.js";
import type { MemoryRoots } from "../src/core/memory.js";
import { LocalMcpStore } from "../src/core/mcp_store.js";
import { createSupportBundle, SUPPORT_BUNDLE_FILES } from "../src/core/support_bundle.js";
import { readTar } from "../src/core/tar.js";

const NOW = "2026-08-14T12:00:00.000Z";
const TOKEN_CANARY = "CANARY-TOKEN-1234567890";
const ENV_CANARY = "ENVCANARY-abcdef-0123456789";
const JWT_CANARY = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnkifQ.c2lnbmF0dXJl";
const BODY_CANARY = "SKILLBODYCANARY must never be exported";

interface Fixture {
  ctx: AppContext;
  cwd: string;
  outDir: string;
  dependencies: { memoryRoots: MemoryRoots; mcpStore: LocalMcpStore };
  restore(): void;
}

function setup(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "aether-bundle-"));
  const cwd = join(root, "workspace");
  const outDir = join(root, "out");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(cwd, ".git"));
  mkdirSync(outDir);
  const configDir = join(root, "config");
  mkdirSync(configDir);
  const logsDir = join(root, "logs");
  const session = join(logsDir, "session-1");
  mkdirSync(session, { recursive: true });
  writeFileSync(
    join(session, "events.jsonl"),
    JSON.stringify({ ts: NOW, type: "error", msg: "token=" + TOKEN_CANARY + " jwt " + JWT_CANARY }) + "\n" +
      JSON.stringify({ ts: NOW, type: "stage", name: "plan" }) + "\n",
    "utf8",
  );
  // Project skill whose body must never appear in an inventory.
  const skillDir = join(cwd, ".aether", "skills", "project", "canary");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "skill.json"),
    JSON.stringify({
      schema_version: 1,
      id: "project/canary",
      version: "0.1.0",
      name: "canary",
      description: "Fixture skill.",
      entrypoint: "SKILL.md",
      triggers: { commands: [], phrases: [], automatic: false },
      tools: { allowed: [], required: [], denied: [] },
      permissions: { requires: [], may_request: [], forbids: [] },
      context: { max_tokens: 2000, resources: [] },
      outputs: { kinds: [], verification: [] },
      dependencies: { skills: [] },
      compatibility: { min_agent_version: "0.1.0", capability_contract: 1 },
      health: { eval_manifest: null },
    }) + "\n",
    "utf8",
  );
  writeFileSync(join(skillDir, "SKILL.md"), "# canary\n\n" + BODY_CANARY + "\n", "utf8");

  const previousConfig = process.env["AETHER_CONFIG_DIR"];
  const previousLogs = process.env["AETHER_LOG_DIR"];
  const previousSecret = process.env["AETHER_TEST_SECRET"];
  process.env["AETHER_CONFIG_DIR"] = configDir;
  process.env["AETHER_LOG_DIR"] = logsDir;
  process.env["AETHER_TEST_SECRET"] = ENV_CANARY;

  const logs = join(root, "mem-logs");
  const snapshots = join(root, "mem-snapshots");
  mkdirSync(logs);
  mkdirSync(snapshots);
  const goals = join(root, "goals.json");
  writeFileSync(goals, "[]");
  const memoryRoots: MemoryRoots = {
    logs,
    snapshots,
    goals,
    history: join(root, "history"),
    legacyHistory: join(root, "legacy-history"),
  };

  const ctx = {
    cfg: {
      baseUrl: "https://user:" + TOKEN_CANARY + "@api.example.test/cloud",
      defaultModel: "",
      permissionMode: "ask",
      autoApply: false,
      telemetry: true,
      defaultEffort: "",
      backend: "auto",
    },
    flags: { cwd, json: false, audit: false, yes: false },
    tokens: { get: async () => TOKEN_CANARY },
    api: { getJson: async () => ({}) },
    confirm: async () => false,
  } as unknown as AppContext;

  return {
    ctx,
    cwd,
    outDir,
    dependencies: { memoryRoots, mcpStore: new LocalMcpStore(join(root, "mcp.json")) },
    restore: () => {
      const put = (key: string, value: string | undefined): void => {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      };
      put("AETHER_CONFIG_DIR", previousConfig);
      put("AETHER_LOG_DIR", previousLogs);
      put("AETHER_TEST_SECRET", previousSecret);
    },
  };
}

test("bundle contains only allowlisted, canary-free, hash-verified entries", async () => {
  const fixture = setup();
  try {
    const result = await createSupportBundle(fixture.ctx, {
      now: NOW,
      outDir: fixture.outDir,
      dependencies: fixture.dependencies,
    });
    assert.equal(basename(result.path), "aether-support-20260814-120000.tar");
    const archive = readFileSync(result.path);
    assert.equal(result.bytes, archive.length);
    assert.equal(result.sha256, createHash("sha256").update(archive).digest("hex"));

    const entries = readTar(archive);
    assert.deepEqual(
      entries.map((entry) => entry.name).sort(),
      [...SUPPORT_BUNDLE_FILES].sort(),
    );
    for (const entry of entries) {
      const text = entry.data.toString("utf8");
      for (const canary of [TOKEN_CANARY, ENV_CANARY, JWT_CANARY, BODY_CANARY, "SKILLBODYCANARY"]) {
        assert.equal(text.includes(canary), false, canary + " leaked into " + entry.name);
      }
    }

    const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
    const manifest = JSON.parse(byName.get("support-manifest.json")!.toString("utf8")) as {
      files: { name: string; sha256: string; bytes: number }[];
    };
    assert.equal(manifest.files.length, SUPPORT_BUNDLE_FILES.length - 1);
    for (const record of manifest.files) {
      const data = byName.get(record.name)!;
      assert.equal(createHash("sha256").update(data).digest("hex"), record.sha256);
      assert.equal(data.length, record.bytes);
    }

    // Inventories are metadata: ids/digests present, content absent.
    const skills = JSON.parse(byName.get("skill-inventory.json")!.toString("utf8")) as {
      skills: { id: string; digest: string }[];
    };
    assert.equal(skills.skills.some((skill) => skill.id === "project/canary"), true);
    assert.match(skills.skills[0]!.digest, /^sha256:[0-9a-f]{64}$/);

    const config = JSON.parse(byName.get("sanitized-config.json")!.toString("utf8")) as Record<string, unknown>;
    assert.equal(config["base_url_host"], "api.example.test");
    assert.equal("baseUrl" in config, false);

    const events = byName.get("recent-redacted-events.ndjson")!.toString("utf8");
    assert.match(events, /\[REDACTED\]/);
    assert.match(events, /\[REDACTED-JWT\]/);
  } finally {
    fixture.restore();
  }
});

test("interrupted generation leaves no final bundle file", async () => {
  const fixture = setup();
  try {
    await assert.rejects(
      createSupportBundle(fixture.ctx, {
        now: NOW,
        outDir: fixture.outDir,
        dependencies: fixture.dependencies,
        verifyHook: () => {
          throw new Error("simulated mid-write interruption");
        },
      }),
      /simulated mid-write interruption/,
    );
    assert.deepEqual(readdirSync(fixture.outDir).filter((name) => name.endsWith(".tar")), []);
    assert.equal(existsSync(join(fixture.outDir, "aether-support-20260814-120000.tar")), false);
  } finally {
    fixture.restore();
  }
});
