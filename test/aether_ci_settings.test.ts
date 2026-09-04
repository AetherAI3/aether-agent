import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";
import {
  AETHER_CI_CONFIG_MAX_BYTES,
  AETHER_CI_CONFIG_MAX_CHECKS,
  AetherCiSettingsFile,
  canonicalAetherCiJson,
  inspectAetherCiConfig,
  parseAetherCiJson,
  registerAetherCiSettings,
  type AetherCiConfig,
} from "../src/core/aether_ci_settings.js";
import { runSettingsCommand, SETTINGS_EXIT, type SettingsCommandIo } from "../src/commands/settings.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import type { AppContext } from "../src/core/context.js";
import { SettingsRegistry } from "../src/core/settings_registry.js";
import { withSettingsFileLock } from "../src/core/settings_file_authority.js";
import type { TerminalCapabilities } from "../src/core/terminal_capabilities.js";

const HEADLESS: TerminalCapabilities = {
  host: "headless",
  columns: 80,
  rows: 24,
  color: false,
  unicode: false,
  mouse: false,
  keyReleaseEvents: false,
  audioInput: false,
  audioOutput: false,
};

function baseConfig(overrides: Partial<AetherCiConfig> = {}): AetherCiConfig {
  return {
    version: 1,
    gates: { commit: false, push: false, agent: false },
    checks: [],
    project: null,
    ...overrides,
  };
}

function withTemp(name: string, run: (root: string, path: string) => void | Promise<void>): Promise<void> | void {
  const root = mkdtempSync(join(tmpdir(), name));
  const path = join(root, ".aether-ci.yml");
  const complete = () => rmSync(root, { recursive: true, force: true });
  try {
    const result = run(root, path);
    if (result instanceof Promise) return result.finally(complete);
    complete();
  } catch (error) {
    complete();
    throw error;
  }
}

function commandContext(cwd: string): AppContext {
  return {
    cfg: { ...DEFAULT_CONFIG },
    api: {} as AppContext["api"],
    tokens: {} as AppContext["tokens"],
    flags: { cwd, json: true, yes: false, audit: false },
    confirm: async () => false,
  };
}

function captureIo(): { io: SettingsCommandIo; output: () => string } {
  let output = "";
  const writer: Pick<Writable, "write"> = {
    write: ((chunk: string | Uint8Array) => {
      output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    }) as Writable["write"],
  };
  return { io: { out: writer, err: writer }, output: () => output };
}

test("portable CI parser accepts canonical JSON with Cloud v1 null/default semantics", () => {
  const parsed = parseAetherCiJson(JSON.stringify({
    version: 1,
    gates: { push: true },
    checks: [{ name: "unit", type: "test", run: "  npm test  " }],
    project: "prj_0123456789abcdef",
  }));
  if (!parsed.ok) throw new Error(parsed.detail);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.config.gates, { commit: false, push: true, agent: false });
  assert.equal(parsed.config.checks[0]?.run, "npm test");
  assert.equal(parsed.config.project, "prj_0123456789abcdef");

  const nulls = parseAetherCiJson('{"version":1,"gates":null,"checks":null,"project":null}');
  assert.equal(nulls.ok, true);
  if (nulls.ok) {
    assert.deepEqual(nulls.config.gates, { commit: false, push: false, agent: false });
    assert.deepEqual(nulls.config.checks, []);
    assert.equal(nulls.config.project, null);
  }
});

test("portable CI parser is closed, bounded, duplicate-safe, and secret/control rejecting", () => {
  const cases: Array<{ raw: string; status: string }> = [
    { raw: '{"version":1,"unknown":true}', status: "malformed" },
    { raw: '{"version":2}', status: "unsupported_version" },
    { raw: '{"version":1,"version":1}', status: "malformed" },
    { raw: '{"version":1,"gates":{"push":true,"push":false}}', status: "malformed" },
    { raw: '{"version":1,"gates":{"publish":true}}', status: "malformed" },
    { raw: '{"version":1,"checks":[{"name":"x","type":"shell","run":"npm test"}]}', status: "malformed" },
    { raw: '{"version":1,"checks":[{"name":"x","type":"test","run":"echo token=super-secret"}]}', status: "unsafe" },
    { raw: JSON.stringify({ version: 1, checks: [{ name: "bad\u001b[2J", type: "test", run: "npm test" }] }), status: "unsafe" },
  ];
  for (const fixture of cases) {
    const parsed = parseAetherCiJson(fixture.raw);
    assert.equal(parsed.ok, false, fixture.raw);
    if (!parsed.ok) assert.equal(parsed.status, fixture.status, fixture.raw);
  }

  const tooMany = parseAetherCiJson(JSON.stringify({
    version: 1,
    checks: Array.from({ length: AETHER_CI_CONFIG_MAX_CHECKS + 1 }, (_, index) => ({
      name: `check-${index}`,
      type: "test",
      run: "npm test",
    })),
  }));
  assert.equal(tooMany.ok, false);
});

test("inspection distinguishes unsupported YAML, malformed, unsafe, oversize, and valid JSON", () => withTemp(
  "aether-ci-inspect-",
  (_root, path) => {
    writeFileSync(path, "version: 1\ngates:\n  push: true\n", "utf8");
    assert.equal(inspectAetherCiConfig(path).status, "unsupported_yaml");

    writeFileSync(path, "{", "utf8");
    assert.equal(inspectAetherCiConfig(path).status, "malformed");

    writeFileSync(path, JSON.stringify({
      version: 1,
      checks: [{ name: "leak", type: "test", run: "echo TOKEN=abcdef012345" }],
    }), "utf8");
    assert.equal(inspectAetherCiConfig(path).status, "unsafe");

    writeFileSync(path, "{" + " ".repeat(AETHER_CI_CONFIG_MAX_BYTES) + "}", "utf8");
    assert.equal(inspectAetherCiConfig(path).status, "oversize");

    writeFileSync(path, canonicalAetherCiJson(baseConfig()), "utf8");
    assert.equal(inspectAetherCiConfig(path).status, "ok");
  },
));

test("preview then cancel is byte-identical and revokes the issued plan", async () => withTemp(
  "aether-ci-cancel-",
  async (_root, path) => {
    const original = canonicalAetherCiJson(baseConfig({
      checks: [{ name: "unit", type: "test", run: "npm test" }],
    }));
    writeFileSync(path, original, "utf8");
    const registry = new SettingsRegistry();
    registerAetherCiSettings(registry, new AetherCiSettingsFile(path, { nextId: () => "cancel" }));
    const transaction = await registry.begin();
    assert.equal(transaction.stage("actions.ci_gate_push", "project", true).ok, true);
    const plan = await transaction.createPlan();
    assert.equal(transaction.preview()[0]?.settingId, "actions.ci_gate_push");
    assert.equal(transaction.cancel().mutated, false);
    assert.equal(readFileSync(path, "utf8"), original);
    assert.equal((await registry.apply(plan, { confirmations: ["ENABLE CI PUSH GATE"] })).failure?.kind, "invalid_plan");
    assert.equal(readFileSync(path, "utf8"), original);
  },
));

test("same-plan gate edits coalesce into one target write and preserve opaque checks", () => withTemp(
  "aether-ci-atomic-",
  (_root, path) => {
    const original = canonicalAetherCiJson(baseConfig({
      checks: [
        { name: "unit", type: "test", run: "npm test" },
        { name: "types", type: "typecheck", run: "npm run typecheck" },
      ],
      project: "prj_0123456789abcdef",
    }));
    writeFileSync(path, original, "utf8");
    const file = new AetherCiSettingsFile(path, { nextId: () => "atomic" });
    const batchKey = {};
    const commit = file.plan("commit", true, batchKey);
    const agent = file.plan("agent", true, batchKey);
    const first = file.apply(commit);
    const second = file.apply(agent);
    assert.equal(first.performedWrite, true);
    assert.equal(second.performedWrite, false);
    assert.equal(first.rollbackToken, second.rollbackToken);

    const inspection = file.inspect();
    assert.equal(inspection.status, "ok");
    assert.deepEqual(inspection.config?.gates, { commit: true, push: false, agent: true });
    assert.deepEqual(inspection.config?.checks, [
      { name: "unit", type: "test", run: "npm test" },
      { name: "types", type: "typecheck", run: "npm run typecheck" },
    ]);
    assert.equal(inspection.config?.project, "prj_0123456789abcdef");

    file.rollback(first.rollbackToken);
    file.rollback(first.rollbackToken);
    assert.equal(readFileSync(path, "utf8"), original, "rollback is exact and idempotent");
  },
));

test("optimistic digest rejects a concurrent edit without overwriting it", () => withTemp(
  "aether-ci-concurrency-",
  (_root, path) => {
    writeFileSync(path, canonicalAetherCiJson(baseConfig()), "utf8");
    const file = new AetherCiSettingsFile(path, { nextId: () => "concurrency" });
    const plan = file.plan("push", true, {});
    const concurrent = canonicalAetherCiJson(baseConfig({
      checks: [{ name: "new", type: "lint", run: "npm run lint" }],
    }));
    writeFileSync(path, concurrent, "utf8");
    assert.throws(() => file.apply(plan), /changed after preview/);
    assert.equal(readFileSync(path, "utf8"), concurrent);
  },
));

test("adjacent exclusive lock serializes CI apply and rollback across file instances", () => withTemp(
  "aether-ci-lock-",
  (_root, path) => {
    const original = canonicalAetherCiJson(baseConfig());
    writeFileSync(path, original, "utf8");
    const file = new AetherCiSettingsFile(path, { nextId: () => "lock" });
    const plan = file.plan("push", true, {});

    withSettingsFileLock(path, () => {
      assert.throws(() => file.apply(plan), /locked by another apply or rollback/);
      assert.equal(readFileSync(path, "utf8"), original);
    });

    const receipt = file.apply(plan);
    const applied = readFileSync(path, "utf8");
    withSettingsFileLock(path, () => {
      assert.throws(() => file.rollback(receipt.rollbackToken), /locked by another apply or rollback/);
      assert.equal(readFileSync(path, "utf8"), applied);
    });
    file.rollback(receipt.rollbackToken);
    assert.equal(readFileSync(path, "utf8"), original);
  },
));

test("registry exposes gated booleans and summaries but never check commands", async () => withTemp(
  "aether-ci-registry-",
  async (_root, path) => {
    const original = canonicalAetherCiJson(baseConfig({
      gates: { commit: false, push: false, agent: false },
      checks: [{ name: "unit", type: "test", run: "npm test -- --private" }],
      project: "prj_0123456789abcdef",
    }));
    writeFileSync(path, original, "utf8");
    const registry = new SettingsRegistry();
    registerAetherCiSettings(registry, new AetherCiSettingsFile(path, { nextId: () => "registry" }));
    const snapshot = await registry.snapshot({ doctor: true });
    assert.equal(snapshot.settings["actions.ci_check_count"]?.state === "known" && snapshot.settings["actions.ci_check_count"]?.value, 1);
    assert.equal(snapshot.settings["actions.ci_check_names"]?.state === "known" && snapshot.settings["actions.ci_check_names"]?.value, "unit");
    assert.equal(snapshot.settings["actions.ci_project_binding"]?.state === "known" && snapshot.settings["actions.ci_project_binding"]?.value, "bound");
    assert.equal(snapshot.settings["actions.ci_config"]?.health.state, "verified");
    assert.doesNotMatch(JSON.stringify(snapshot), /npm test -- --private/);
    assert.doesNotMatch((await registry.begin()).exportRedacted(), /npm test -- --private/);
    assert.equal(registry.ids().some((id) => id.includes("run")), false);

    const transaction = await registry.begin();
    transaction.stage("actions.ci_gate_commit", "project", true);
    transaction.stage("actions.ci_gate_agent", "project", true);
    const plan = await transaction.createPlan();
    assert.deepEqual(plan.confirmations.map((item) => item.phrase), [
      "ENABLE CI AGENT GATE",
      "ENABLE CI COMMIT GATE",
    ]);
    assert.equal((await transaction.applyPlan(plan)).failure?.kind, "confirmation_required");
    const applied = await transaction.applyPlan(plan, { confirmations: plan.confirmations.map((item) => item.phrase) });
    assert.equal(applied.status, "applied");
    assert.deepEqual(inspectAetherCiConfig(path).config?.gates, { commit: true, push: false, agent: true });
  },
));

test("terminal settings command cannot edit check names, counts, commands, or binding", async () => withTemp(
  "aether-ci-command-",
  async (root, path) => {
    const original = canonicalAetherCiJson(baseConfig({
      checks: [{ name: "unit", type: "test", run: "npm test" }],
    }));
    writeFileSync(path, original, "utf8");
    const registry = new SettingsRegistry();
    registerAetherCiSettings(registry, new AetherCiSettingsFile(path));
    for (const [id, value] of [
      ["actions.ci_check_names", "replace"],
      ["actions.ci_check_count", "4"],
      ["actions.ci_project_binding", "bound"],
      ["actions.ci_config", "validated_json"],
      ["actions.ci_check_run", "curl https://example.test"],
    ] as const) {
      const capture = captureIo();
      const code = await runSettingsCommand(commandContext(root), ["set", id, value], {
        registry,
        capabilities: HEADLESS,
        scope: "project",
      }, capture.io);
      assert.equal(code, SETTINGS_EXIT.failed, id);
      assert.match(capture.output(), /scope\.unsupported|setting\.unknown|unknown setting id/, id);
      assert.equal(readFileSync(path, "utf8"), original, id);
    }
  },
));

test("unsupported YAML and unsafe JSON stay byte-identical when a gate edit is attempted", async () => withTemp(
  "aether-ci-refuse-",
  async (_root, path) => {
    const fixtures = [
      "version: 1\ngates:\n  push: true\nchecks: []\n",
      JSON.stringify({ version: 1, checks: [{ name: "x", type: "test", run: "echo password=hunter2" }] }),
    ];
    for (const original of fixtures) {
      writeFileSync(path, original, "utf8");
      const registry = new SettingsRegistry();
      registerAetherCiSettings(registry, new AetherCiSettingsFile(path));
      const transaction = await registry.begin();
      assert.equal(transaction.stage("actions.ci_gate_push", "project", false).ok, true);
      await assert.rejects(transaction.createPlan(), /unsupported_yaml|unsafe/);
      assert.equal(readFileSync(path, "utf8"), original);
    }
  },
));
