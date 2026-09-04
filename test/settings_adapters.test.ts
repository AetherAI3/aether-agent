import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACTIONS_RUNNER_PREREQUISITE,
  ONLINE_SETTINGS_PREREQUISITE,
  VOICE_SETTINGS_PREREQUISITE,
  createAgentSettingsRegistry,
  type AgentConfigPort,
  type SkillSettingsPort,
} from "../src/core/settings_adapters.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import type { AppContext, GlobalFlags } from "../src/core/context.js";
import type { McpStoreInspection } from "../src/core/mcp_store.js";
import type { SkillManifest } from "../src/core/skills/skill_schema.js";
import type { SkillDescriptor, SkillIndex } from "../src/core/skills/skill_types.js";
import type { SkillSetting, SkillSettingsStore } from "../src/core/skills/skill_settings.js";
import type { TerminalCapabilities } from "../src/core/terminal_capabilities.js";
import { VersionedSettingsStore } from "../src/core/settings_store.js";
import type { AetherConfig } from "../src/types.js";

function flags(cwd: string): GlobalFlags {
  return { json: false, audit: false, yes: false, cwd };
}

function config(overrides: Partial<AetherConfig> = {}): AetherConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function context(root: string, cfg = config()): Pick<AppContext, "cfg" | "flags"> {
  return { cfg, flags: flags(root) };
}

function stores(root: string): VersionedSettingsStore {
  let id = 0;
  return new VersionedSettingsStore({
    global: join(root, "settings", "global.json"),
    project: join(root, "settings", "project.json"),
    session: join(root, "settings", "session.json"),
  }, { nextId: () => `adapter-${++id}` });
}

function emptySkills(): SkillIndex {
  return { skills: [], errors: [], generatedAt: "2026-09-04T00:00:00.000Z" };
}

const plainTerminal: TerminalCapabilities = {
  host: "tty",
  columns: 100,
  rows: 30,
  color: false,
  unicode: false,
  mouse: false,
  keyReleaseEvents: false,
  audioInput: false,
  audioOutput: false,
};

function mcpInspection(secret: string): McpStoreInspection {
  return {
    status: "ok",
    servers: [{ name: "private", url: "https://mcp.example.test", transport: "http", authToken: secret }],
  };
}

test("composition registers every domain without decorative unsupported toggles", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-adapters-"));
  const ciPath = join(root, ".aether-ci.yml");
  writeFileSync(ciPath, JSON.stringify({
    version: 1,
    gates: { commit: false, push: true, agent: false },
    checks: [],
    project: null,
  }, null, 2) + "\n", "utf8");
  const persisted = config({ backend: "auto", baseUrl: "https://persisted.example.test/cloud" });
  const configPort: AgentConfigPort = {
    source: join(root, "config.json"),
    exists: () => true,
    readPersisted: () => persisted,
    save: () => {},
  };
  const secret = "SENTINEL-mcp-auth-never-export";
  const registry = createAgentSettingsRegistry(context(root, config(persisted)), {
    store: stores(root),
    env: {
      AETHER_BACKEND: "cloud",
      NO_COLOR: "1",
      AETHER_ASCII: "1",
      AETHER_NO_ANIM: "1",
      OLLAMA_HOST: "file:///not-supported",
    },
    terminalCapabilities: plainTerminal,
    config: configPort,
    mcpStore: { inspect: () => mcpInspection(secret), filePath: () => join(root, "mcp.json") },
    skillIndex: emptySkills(),
    skillSettings: { load: () => ({ schemaVersion: 1, settings: [] }), save: () => {} },
    ciConfigPath: ciPath,
  });

  const ids = registry.ids();
  for (const expected of [
    "agent.api_base_url",
    "appearance.color",
    "mcp.registry_state",
    "skills.catalog_health",
    "ollama.host",
    "code.hosted_model",
    "online.availability",
    "actions.runner_availability",
    "actions.ci_config",
    "actions.ci_gate_commit",
    "actions.ci_gate_push",
    "actions.ci_gate_agent",
    "actions.ci_check_names",
    "voice.availability",
  ]) assert.ok(ids.includes(expected), expected);
  assert.equal(ids.includes("voice.enabled"), false, "no writable Voice toggle without a consuming runtime");

  const snapshot = await registry.snapshot();
  assert.equal(snapshot.settings["code.backend"]?.state, "known");
  assert.equal(snapshot.settings["code.backend"]?.source, "AETHER_BACKEND");
  assert.equal(snapshot.settings["code.backend"]?.state === "known" && snapshot.settings["code.backend"]?.value, "cloud");
  assert.equal(snapshot.settings["appearance.color"]?.state === "known" && snapshot.settings["appearance.color"]?.value, false);
  assert.equal(snapshot.settings["appearance.animation"]?.state === "known" && snapshot.settings["appearance.animation"]?.value, false);
  assert.equal(snapshot.settings["mcp.local_server_count"]?.state === "known" && snapshot.settings["mcp.local_server_count"]?.value, 1);
  assert.equal(snapshot.settings["voice.availability"]?.health.summary, `requires ${VOICE_SETTINGS_PREREQUISITE}`);
  assert.equal(snapshot.settings["online.availability"]?.health.summary, `requires ${ONLINE_SETTINGS_PREREQUISITE}`);
  assert.equal(snapshot.settings["actions.runner_availability"]?.health.summary, `requires ${ACTIONS_RUNNER_PREREQUISITE}`);
  assert.match(snapshot.settings["actions.ci_config"]?.health.summary ?? "", /validated against Cloud contract/);
  assert.equal(snapshot.settings["actions.ci_config"]?.state === "known" && snapshot.settings["actions.ci_config"]?.value, "validated_json");
  assert.equal(snapshot.settings["actions.ci_gate_push"]?.state === "known" && snapshot.settings["actions.ci_gate_push"]?.value, true);
  assert.equal(snapshot.settings["ollama.host"]?.state, "unknown", "unsupported env host remains unknown");

  const tx = await registry.begin();
  assert.equal(tx.stage("online.availability", "global", "available").ok, false);
  assert.equal(tx.stage("actions.runner_availability", "global", "available").ok, false);
  const backend = tx.stage("code.backend", "global", "local");
  assert.equal(backend.ok && backend.changed, true);
  if (!backend.ok || !backend.changed) throw new Error("expected backend stage");
  assert.equal(backend.preview.after.state, "known");
  assert.equal(backend.preview.after.value, "cloud", "env override stays effective and visible");
  assert.doesNotMatch(tx.exportRedacted(), new RegExp(secret));
});

test("a corrupt MCP registry reports an unknown server count, never a known zero", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-mcp-corrupt-"));
  const registry = createAgentSettingsRegistry(context(root), {
    store: stores(root),
    env: {},
    terminalCapabilities: plainTerminal,
    mcpStore: {
      inspect: () => ({ status: "corrupt", servers: [], detail: "synthetic corrupt fixture" }),
      filePath: () => join(root, "mcp.json"),
    },
    skillIndex: emptySkills(),
    skillSettings: { load: () => ({ schemaVersion: 1, settings: [] }), save: () => {} },
  });
  const count = (await registry.snapshot()).settings["mcp.local_server_count"];
  assert.equal(count?.state, "unknown");
  assert.equal(count?.health.state, "degraded");
});

test("legacy Agent config leaves validate, confirm, apply, and compensate through the existing authority", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-config-"));
  const cfg = config({ autoApply: false, defaultEffort: "LOW" });
  const persisted = config(cfg);
  const saves: AetherConfig[] = [];
  let failSecond = true;
  const port: AgentConfigPort = {
    source: join(root, "config.json"),
    exists: () => true,
    readPersisted: () => persisted,
    save(next) {
      saves.push(config(next));
      if (failSecond && saves.length === 2) throw new Error("simulated atomic config failure");
    },
  };
  const registry = createAgentSettingsRegistry(context(root, cfg), {
    store: stores(root), env: {}, terminalCapabilities: plainTerminal, config: port,
    mcpStore: { inspect: () => ({ status: "missing", servers: [] }), filePath: () => join(root, "mcp.json") },
    skillIndex: emptySkills(), skillSettings: { load: () => ({ schemaVersion: 1, settings: [] }), save: () => {} },
  });
  const tx = await registry.begin();
  assert.equal(tx.stage("agent.api_base_url", "global", "http://remote.example.test").ok, false);
  assert.equal(tx.stage("code.auto_apply", "global", true).ok, true);
  assert.equal(tx.stage("code.effort", "global", "ultra").ok, true);
  const plan = await tx.createPlan();
  assert.deepEqual(plan.changes.map((change) => change.settingId), ["code.auto_apply", "code.effort"]);
  assert.deepEqual(plan.confirmations.map((entry) => entry.phrase), [
    "ENABLE AUTOMATIC EDITS",
    "APPLY HOSTED COST SETTING",
  ]);
  assert.equal((await registry.apply(plan)).status, "rejected");
  const rolledBack = await registry.apply(plan, {
    confirmations: ["ENABLE AUTOMATIC EDITS", "APPLY HOSTED COST SETTING"],
  });
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(cfg.autoApply, false);
  assert.equal(cfg.defaultEffort, "LOW");
  assert.equal(saves.length, 3, "first apply, failed second apply, reverse compensation");

  failSecond = false;
  saves.length = 0;
  const retry = await registry.begin();
  retry.stage("code.auto_apply", "global", true);
  retry.stage("code.effort", "global", "ultra");
  const applied = await retry.apply({
    confirmations: ["ENABLE AUTOMATIC EDITS", "APPLY HOSTED COST SETTING"],
  });
  assert.equal(applied.status, "applied");
  assert.equal(cfg.autoApply, true);
  assert.equal(cfg.defaultEffort, "ULTRA");
});

test("Voice leaves become writable only when audio and a store-consuming runtime are proven", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-voice-"));
  const store = stores(root);
  const registry = createAgentSettingsRegistry(context(root), {
    store,
    env: {},
    terminalCapabilities: { ...plainTerminal, host: "electron", audioInput: true, audioOutput: true, keyReleaseEvents: true },
    config: { exists: () => false, save: () => {} },
    mcpStore: { inspect: () => ({ status: "missing", servers: [] }), filePath: () => join(root, "mcp.json") },
    skillIndex: emptySkills(),
    skillSettings: { load: () => ({ schemaVersion: 1, settings: [] }), save: () => {} },
    voiceRuntime: {
      consumesStore: true,
      doctor: async () => ({ state: "verified", summary: "capture/playback loop verified" }),
    },
  });
  assert.ok(registry.ids().includes("voice.enabled"));
  assert.ok(registry.ids().includes("voice.speech_output"));
  const tx = await registry.begin({ doctor: true });
  assert.equal(tx.stage("voice.end_of_turn_silence_ms", "project", 30_000).ok, false);
  assert.equal(tx.stage("voice.enabled", "global", true).ok, true);
  assert.equal(tx.stage("voice.hotkey", "global", "Ctrl+Shift+V").ok, true);
  assert.equal((await tx.apply()).failure?.kind, "confirmation_required");
  const receipt = await tx.apply({ confirmations: ["ENABLE VOICE BILLING"] });
  assert.equal(receipt.status, "applied");
  assert.equal(store.inspect("global").settings["voice.enabled"], true);
  assert.equal(store.inspect("global").settings["voice.hotkey"], "Ctrl+Shift+V");
  const current = await registry.snapshot({ doctor: true });
  assert.equal(current.settings["voice.enabled"]?.state === "known" && current.settings["voice.enabled"]?.value, true);
  assert.equal(current.settings["voice.enabled"]?.health.state, "verified");
});

function manifest(id: string, automatic: boolean): SkillManifest {
  return {
    schemaVersion: 1,
    id,
    version: "1.0.0",
    name: id,
    description: `test ${id}`,
    entrypoint: "SKILL.md",
    triggers: { commands: [], phrases: [], automatic },
    tools: { allowed: ["read_file"], required: [], denied: [] },
    permissions: { requires: [], mayRequest: [], forbids: [] },
    context: { maxTokens: 1000, maxResources: 1, resources: [] },
    outputs: { kinds: ["text"], verification: [] },
    dependencies: { skills: [] },
    compatibility: { minAgentVersion: "0.1.0", capabilityContract: 1 },
    health: { evalManifest: null },
  };
}

function descriptor(id: string, scope: "builtin" | "project", trust: SkillDescriptor["trust"]): SkillDescriptor {
  const skillManifest = manifest(id, true);
  return {
    id,
    version: "1.0.0",
    name: id,
    description: `test ${id}`,
    scope,
    root: `/safe/${id}`,
    sha256: "d".repeat(64),
    trust,
    enabled: true,
    automatic: scope === "builtin",
    approxTokens: 1000,
    manifest: skillManifest,
  };
}

test("skill leaves use the canonical settings port and trust remains a higher policy", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-skills-"));
  let records: SkillSetting[] = [];
  const port: SkillSettingsPort = {
    load(): SkillSettingsStore { return { schemaVersion: 1, settings: records }; },
    save(record) {
      records = [...records.filter((item) => item.projectRoot !== record.projectRoot || item.skillId !== record.skillId), record];
    },
  };
  const index: SkillIndex = {
    generatedAt: "2026-09-04T00:00:00.000Z",
    errors: [],
    skills: [
      descriptor("project/review-pr", "project", "untrusted"),
      descriptor("aether/core", "builtin", "builtin"),
    ],
  };
  const registry = createAgentSettingsRegistry(context(root), {
    store: stores(root), env: {}, terminalCapabilities: plainTerminal,
    config: { exists: () => false, save: () => {} },
    mcpStore: { inspect: () => ({ status: "missing", servers: [] }), filePath: () => join(root, "mcp.json") },
    skillIndex: index, skillSettings: port,
  });
  assert.equal(registry.ids().includes("skills.aether.core.automatic"), false, "manifest-owned built-in auto is not editable");
  assert.equal(registry.ids().includes("skills.project.review-pr.automatic"), true);
  assert.equal(registry.ids().some((id) => id.includes("trust")), false, "trust is not a settings toggle");

  const before = await registry.snapshot();
  const automatic = before.settings["skills.project.review-pr.automatic"];
  assert.equal(automatic?.state === "known" && automatic.value, false);
  assert.equal(automatic?.state === "known" && automatic.scope, "server_policy");
  assert.equal(automatic?.health.state, "degraded");

  const tx = await registry.begin();
  const staged = tx.stage("skills.project.review-pr.automatic", "project", true);
  assert.equal(staged.ok && staged.changed, true);
  if (!staged.ok || !staged.changed) throw new Error("expected skill stage");
  assert.equal(staged.preview.after.value, false, "trust policy still narrows the configured opt-in");
  assert.equal((await tx.apply()).status, "applied");
  assert.equal(records[0]?.automatic, true);
  const after = (await registry.snapshot()).settings["skills.project.review-pr.automatic"];
  assert.equal(after?.state === "known" && after.scope, "server_policy");
});

test("store corruption is visible through composed health instead of becoming defaults", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-corrupt-"));
  mkdirSync(join(root, "settings"), { recursive: true });
  const store = stores(root);
  writeFileSync(store.path("project"), "{broken", "utf8");
  const registry = createAgentSettingsRegistry(context(root), {
    store,
    env: {},
    terminalCapabilities: { ...plainTerminal, host: "electron", audioInput: true },
    voiceRuntime: { consumesStore: true },
    config: { exists: () => false, save: () => {} },
    mcpStore: { inspect: () => ({ status: "missing", servers: [] }), filePath: () => join(root, "mcp.json") },
    skillIndex: emptySkills(), skillSettings: { load: () => ({ schemaVersion: 1, settings: [] }), save: () => {} },
  });
  const snapshot = await registry.snapshot();
  assert.equal(snapshot.settings["settings.project_store"]?.state === "known" && snapshot.settings["settings.project_store"]?.value, "corrupt");
  assert.equal(snapshot.settings["settings.project_store"]?.health.state, "degraded");
  const voice = snapshot.settings["voice.enabled"];
  assert.equal(voice?.state, "unknown", "corrupt project scope must outrank the default as unknown");
  assert.equal(voice?.state === "unknown" && voice.scope, "project");
  assert.equal(voice?.health.state, "degraded");
});
