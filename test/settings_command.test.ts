import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Writable } from "node:stream";
import {
  SETTINGS_EXIT,
  runSettingsCommand,
  settingsOptionsFromFlags,
  settingsStorePaths,
  type SettingsCommandIo,
  type SettingsInteractiveRuntime,
} from "../src/commands/settings.js";
import type { CommandFlags } from "../src/core/command_dispatch.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import type { AppContext } from "../src/core/context.js";
import {
  SettingsRegistry,
  booleanValidator,
  secretReference,
  secretReferenceValidator,
  stringValidator,
  type SettingChange,
  type SettingDefinition,
  type SettingLayer,
  type SettingsOperationTimer,
  type SettingValue,
} from "../src/core/settings_registry.js";
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

function context(cwd: string, json = false, yes = false): AppContext {
  return {
    cfg: { ...DEFAULT_CONFIG },
    api: {} as AppContext["api"],
    tokens: {} as AppContext["tokens"],
    flags: { cwd, json, yes, audit: false },
    confirm: async () => false,
  };
}

function captureIo(): { io: SettingsCommandIo; out: () => string; err: () => string } {
  let stdout = "";
  let stderr = "";
  const writer = (append: (value: string) => void): Pick<Writable, "write"> => ({
    write: ((chunk: string | Uint8Array) => {
      append(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as Writable["write"],
  });
  return {
    io: { out: writer((value) => { stdout += value; }), err: writer((value) => { stderr += value; }) },
    out: () => stdout,
    err: () => stderr,
  };
}

class FakeInteractiveInput extends EventEmitter {
  isRaw = false;
  #paused = true;
  readonly rawTransitions: boolean[] = [];

  isPaused(): boolean { return this.#paused; }
  setRawMode(value: boolean): this {
    this.isRaw = value;
    this.rawTransitions.push(value);
    return this;
  }
  resume(): this { this.#paused = false; return this; }
  pause(): this { this.#paused = true; return this; }
}

class FakeInteractiveOutput extends EventEmitter {
  columns = 80;
  rows = 24;
}

function interactiveRuntime(): {
  runtime: SettingsInteractiveRuntime;
  input: FakeInteractiveInput;
  signals: EventEmitter;
} {
  const input = new FakeInteractiveInput();
  const output = new FakeInteractiveOutput();
  const signals = new EventEmitter();
  return {
    input,
    signals,
    runtime: {
      stdin: input as unknown as typeof process.stdin,
      stdout: output as unknown as typeof process.stdout,
      signals: signals as unknown as SettingsInteractiveRuntime["signals"],
    },
  };
}

class ManualSettingsTimer implements SettingsOperationTimer {
  #next = 0;
  readonly #callbacks = new Map<number, () => void>();

  schedule(callback: () => void, _delayMs: number): unknown {
    const id = ++this.#next;
    this.#callbacks.set(id, callback);
    return id;
  }

  cancel(handle: unknown): void {
    if (typeof handle === "number") this.#callbacks.delete(handle);
  }

  fireAll(): void {
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const callback of callbacks) callback();
  }

  get pending(): number { return this.#callbacks.size; }
}

interface MutableDefinitionOptions<T extends SettingValue> {
  id: string;
  section: string;
  value: T;
  valueType: SettingDefinition<T>["valueType"];
  validate: SettingDefinition<T>["validate"];
  health?: SettingDefinition<T> extends never ? never : "available" | "unavailable";
  confirmation?: SettingDefinition<T>["confirmation"];
  sensitive?: boolean;
  scopes?: SettingDefinition<T>["scopes"];
}

function mutableDefinition<T extends SettingValue>(
  options: MutableDefinitionOptions<T>,
  observed: { value: T; applyCount: number; planCount?: number },
): SettingDefinition<T> {
  const layers = (): SettingLayer[] => [{ scope: "global", source: "test settings", value: observed.value }];
  return {
    id: options.id,
    section: options.section,
    label: options.id,
    description: `description for ${options.id}`,
    valueType: options.valueType,
    scopes: options.scopes ?? ["default", "global", "project"],
    ...(options.confirmation ? { confirmation: options.confirmation } : {}),
    ...(options.sensitive === undefined ? {} : { sensitive: options.sensitive }),
    async read() {
      return {
        layers: layers(),
        health: options.health === "unavailable"
          ? { state: "unavailable", summary: "runtime adapter is not bound" }
          : { state: "configured", summary: "configured for test" },
      };
    },
    validate: options.validate,
    async plan(change) {
      if (observed.planCount !== undefined) observed.planCount += 1;
      return change;
    },
    async apply(plan) {
      const change = plan as SettingChange<T>;
      observed.applyCount += 1;
      if (change.operation === "set" && change.afterAtScope?.state === "known") {
        observed.value = change.afterAtScope.value;
      }
      return { ok: true, receipt: { rollbackToken: change, summary: "saved through test authority" } };
    },
    async rollback() {},
    async doctor() {
      return options.health === "unavailable"
        ? { state: "unavailable", summary: "runtime adapter is not bound" }
        : { state: "configured", summary: "configured for test" };
    },
  };
}

function registryFixture(): {
  registry: SettingsRegistry;
  enabled: { value: boolean; applyCount: number; planCount: number };
  danger: { value: boolean; applyCount: number };
} {
  const enabled = { value: true, applyCount: 0, planCount: 0 };
  const danger = { value: false, applyCount: 0 };
  const secret = { value: secretReference("vault", "private/account"), applyCount: 0 };
  const unavailable = { value: "unavailable", applyCount: 0 };
  const registry = new SettingsRegistry({
    unknownSettings: { future: "sk-this-value-must-never-appear" },
  });
  registry.register(mutableDefinition({
    id: "agent.enabled",
    section: "Agent",
    value: true,
    valueType: "boolean",
    validate: booleanValidator,
  }, enabled));
  registry.register(mutableDefinition({
    id: "agent.danger",
    section: "Agent",
    value: false,
    valueType: "boolean",
    validate: booleanValidator,
    confirmation: {
      impact: "destructive",
      phrase: "ENABLE DANGER",
      reason: "test setting is destructive",
    },
  }, danger));
  registry.register(mutableDefinition({
    id: "agent.credential",
    section: "Agent",
    value: secret.value,
    valueType: "secret_ref",
    validate: secretReferenceValidator,
    sensitive: true,
  }, secret));
  registry.register(mutableDefinition({
    id: "online.availability",
    section: "Aether Online",
    value: "unavailable",
    valueType: "string",
    validate: stringValidator,
    health: "unavailable",
    scopes: ["default"],
  }, unavailable));
  return { registry, enabled, danger };
}

interface ResetBacking {
  bytes: string;
  readonly planned: string[];
  readonly applied: string[];
  readonly rolledBack: string[];
  failAfterMutation?: string;
}

interface ResetDefinitionOptions {
  readonly id: string;
  readonly section?: string;
  readonly scopes?: SettingDefinition<boolean>["scopes"];
  readonly layerScope?: "global" | "project";
  readonly rollbackCapable?: boolean;
  readonly confirmation?: SettingDefinition<boolean>["confirmation"];
}

function resetDefinition(
  options: ResetDefinitionOptions,
  backing: ResetBacking,
): SettingDefinition<boolean> {
  const rollback = options.rollbackCapable === false
    ? {}
    : {
        async rollback(receipt: { readonly rollbackToken?: unknown }) {
          backing.rolledBack.push(options.id);
          backing.bytes = String(receipt.rollbackToken);
        },
      };
  return {
    id: options.id,
    section: options.section ?? "Reset Group",
    label: options.id,
    description: `reset fixture for ${options.id}`,
    valueType: "boolean",
    scopes: options.scopes ?? ["default", "global", "project"],
    ...(options.confirmation ? { confirmation: options.confirmation } : {}),
    async read() {
      const document = JSON.parse(backing.bytes) as Record<string, unknown>;
      const value = document[options.id];
      return {
        layers: typeof value === "boolean"
          ? [{
              scope: options.layerScope ?? "global",
              source: "byte-backed reset fixture",
              value,
            }]
          : [],
        health: { state: "configured", summary: "configured for reset test" },
      };
    },
    validate: booleanValidator,
    async plan(change) {
      backing.planned.push(options.id);
      return change;
    },
    async apply(plan) {
      const before = backing.bytes;
      const change = plan as SettingChange<boolean>;
      const document = JSON.parse(backing.bytes) as Record<string, unknown>;
      if (change.operation === "unset") delete document[options.id];
      else if (change.afterAtScope?.state === "known") document[options.id] = change.afterAtScope.value;
      backing.bytes = JSON.stringify(document);
      backing.applied.push(options.id);
      const receipt = { rollbackToken: before, summary: `reset ${options.id}` };
      if (backing.failAfterMutation === options.id) {
        return { ok: false as const, error: "injected reset failure", compensationReceipt: receipt };
      }
      return { ok: true as const, receipt };
    },
    ...rollback,
  };
}

function resetRegistryFixture(options: {
  readonly bytes?: string;
  readonly rollbacklessId?: string;
  readonly failAfterMutation?: string;
} = {}): { registry: SettingsRegistry; backing: ResetBacking } {
  const backing: ResetBacking = {
    bytes: options.bytes ?? [
      "{",
      '  "reset.alpha": true,',
      '  "reset.beta": false,',
      '  "reset.project": true,',
      '  "other.keep": true',
      "}",
      "",
    ].join("\n"),
    planned: [],
    applied: [],
    rolledBack: [],
    ...(options.failAfterMutation ? { failAfterMutation: options.failAfterMutation } : {}),
  };
  const registry = new SettingsRegistry({ now: () => "2030-01-02T03:04:05.000Z" });
  registry.register(resetDefinition({ id: "reset.alpha" }, backing));
  registry.register(resetDefinition({
    id: "reset.beta",
    rollbackCapable: options.rollbacklessId !== "reset.beta",
    confirmation: {
      impact: "destructive",
      phrase: "RESET BETA",
      reason: "reset beta requires an exact phrase",
    },
  }, backing));
  registry.register(resetDefinition({ id: "reset.empty" }, backing));
  registry.register(resetDefinition({
    id: "reset.project",
    scopes: ["default", "project"],
    layerScope: "project",
  }, backing));
  registry.register(resetDefinition({ id: "other.keep", section: "Other" }, backing));
  return { registry, backing };
}

function neverReadRegistry(
  timer: SettingsOperationTimer,
  observed: { signal?: AbortSignal },
): SettingsRegistry {
  const registry = new SettingsRegistry({ operationTimeoutMs: 20, operationTimer: timer });
  registry.register({
    id: "startup.never",
    section: "Startup",
    label: "Never-settling startup",
    description: "bounded interactive startup fixture",
    valueType: "boolean",
    scopes: ["default"],
    read(operation) {
      observed.signal = operation?.signal;
      return new Promise(() => {});
    },
    validate: booleanValidator,
    async plan() { return {}; },
    async apply() { return { ok: false, error: "read-only" }; },
  });
  return registry;
}

test("settings store paths separate global, project, and process-session state", () => {
  const ctx = context(join("tmp", "workspace"));
  const paths = settingsStorePaths(ctx, { configRoot: join("tmp", "config"), sessionId: "test/unsafe" });
  assert.equal(paths.global, resolve("tmp", "config", "settings", "global.json"));
  assert.equal(paths.project, resolve("tmp", "workspace", ".aether", "settings.json"));
  assert.match(paths.session, /settings[\\/]sessions[\\/][a-f0-9]{20}-test-unsafe\.json$/);
  assert.notEqual(paths.global, paths.project);
  assert.notEqual(paths.project, paths.session);
});

test("owned command flags are forwarded as data without an argv reparse", () => {
  const flags: CommandFlags = {
    bool: (name) => name === "redacted",
    str: () => undefined,
    list: () => [],
  };
  assert.deepEqual(settingsOptionsFromFlags(flags, "project"), {
    scope: "project",
    redacted: true,
    preview: false,
  });
});

test("list and get emit stable redacted JSON and never reveal secret references", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-command-"));
  try {
    const fixture = registryFixture();
    const capture = captureIo();
    const code = await runSettingsCommand(context(root, true), ["list", "Agent"], {
      registry: fixture.registry,
      capabilities: HEADLESS,
    }, capture.io);
    assert.equal(code, SETTINGS_EXIT.ok);
    const output = capture.out();
    assert.equal(output.endsWith("\n"), true);
    assert.doesNotMatch(output, /private\/account|sk-this-value/);
    const parsed = JSON.parse(output) as { protocol: string; data: { settings: Array<{ id: string; value?: unknown }> } };
    assert.equal(parsed.protocol, "aether.settings/1");
    assert.deepEqual(parsed.data.settings.map((item) => item.id), ["agent.credential", "agent.danger", "agent.enabled"]);
    assert.equal(parsed.data.settings[0]?.value, "[secret reference hidden]");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("set parses typed values, stages, and applies through the registry", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-command-"));
  try {
    const fixture = registryFixture();
    const capture = captureIo();
    const code = await runSettingsCommand(context(root, true), ["set", "agent.enabled", "false"], {
      registry: fixture.registry,
      capabilities: HEADLESS,
      scope: "global",
    }, capture.io);
    assert.equal(code, SETTINGS_EXIT.ok);
    assert.equal(fixture.enabled.value, false);
    assert.equal(fixture.enabled.applyCount, 1);
    assert.equal(fixture.enabled.planCount, 1, "the command applies the exact plan it previewed");
    const parsed = JSON.parse(capture.out()) as { ok: boolean; data: { status: string } };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.status, "applied");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--yes cannot bypass an exact destructive confirmation phrase", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-command-"));
  try {
    const fixture = registryFixture();
    const rejected = captureIo();
    const code = await runSettingsCommand(context(root, true, true), ["set", "agent.danger", "true"], {
      registry: fixture.registry,
      capabilities: HEADLESS,
      scope: "global",
      confirmPhrase: async () => null,
    }, rejected.io);
    assert.equal(code, SETTINGS_EXIT.failed);
    assert.equal(fixture.danger.applyCount, 0);
    assert.equal(fixture.danger.value, false);
    assert.match(rejected.out(), /--yes never approves/);

    const approved = captureIo();
    const success = await runSettingsCommand(context(root, true, true), ["set", "agent.danger", "true"], {
      registry: fixture.registry,
      capabilities: HEADLESS,
      scope: "global",
      confirmPhrase: async (confirmation) => confirmation.phrase,
    }, approved.io);
    assert.equal(success, SETTINGS_EXIT.ok);
    assert.equal(fixture.danger.applyCount, 1);
    assert.equal(fixture.danger.value, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("secret-ref values and read-only settings have explicit refusal states", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-command-"));
  try {
    const fixture = registryFixture();
    const secret = captureIo();
    const secretCode = await runSettingsCommand(context(root, true), ["set", "agent.credential", "raw-secret"], {
      registry: fixture.registry,
      capabilities: HEADLESS,
      scope: "global",
    }, secret.io);
    assert.equal(secretCode, SETTINGS_EXIT.failed);
    assert.match(secret.out(), /owning credential or connection flow/);
    assert.doesNotMatch(secret.out(), /raw-secret/);

    const readonly = captureIo();
    const readOnlyCode = await runSettingsCommand(context(root, true), ["set", "online.availability", "enabled"], {
      registry: fixture.registry,
      capabilities: HEADLESS,
      scope: "project",
    }, readonly.io);
    assert.equal(readOnlyCode, SETTINGS_EXIT.failed);
    assert.match(readonly.out(), /scope\.unsupported/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("untrusted validator diagnostics are redacted on the command JSON rail", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-command-"));
  try {
    const fixture = registryFixture();
    const synthetic = "sk-abcdefghijklmnop123456";
    fixture.registry.register(mutableDefinition({
      id: "agent.validator-output",
      section: "Agent",
      value: false,
      valueType: "boolean",
      validate: () => ({
        ok: false,
        issues: [{ code: `invalid.${synthetic}`, message: `Bearer ${synthetic}` }],
      }),
    }, { value: false, applyCount: 0 }));
    const capture = captureIo();
    const code = await runSettingsCommand(context(root, true), ["set", "agent.validator-output", "true"], {
      registry: fixture.registry,
      capabilities: HEADLESS,
      scope: "global",
    }, capture.io);
    assert.equal(code, SETTINGS_EXIT.failed);
    assert.doesNotMatch(capture.out(), /abcdefghijklmnop123456/);
    assert.match(capture.out(), /\[REDACTED\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor reports unavailable domains truthfully with a failing exit", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-command-"));
  try {
    const fixture = registryFixture();
    const capture = captureIo();
    const code = await runSettingsCommand(context(root, true), ["doctor", "Aether Online"], {
      registry: fixture.registry,
      capabilities: HEADLESS,
    }, capture.io);
    assert.equal(code, SETTINGS_EXIT.failed);
    const parsed = JSON.parse(capture.out()) as { ok: boolean; data: { settings: Array<{ health: { state: string } }> } };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.data.settings[0]?.health.state, "unavailable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("export is redacted and import is validation-only with no mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-command-"));
  try {
    const fixture = registryFixture();
    const exported = captureIo();
    const exportCode = await runSettingsCommand(context(root, true), ["export"], {
      registry: fixture.registry,
      capabilities: HEADLESS,
      redacted: true,
    }, exported.io);
    assert.equal(exportCode, SETTINGS_EXIT.ok);
    assert.doesNotMatch(exported.out(), /private\/account|sk-this-value/);
    const document = JSON.parse(exported.out()) as { excludedSecretRefs: string[] };
    assert.deepEqual(document.excludedSecretRefs, ["agent.credential"]);

    const importPath = join(root, "settings-import.json");
    writeFileSync(importPath, JSON.stringify({
      schemaVersion: 1,
      settings: {
        "agent.enabled": { value: false, scope: "project" },
      },
    }), "utf8");
    const preview = captureIo();
    const importCode = await runSettingsCommand(context(root, true), ["import", importPath], {
      registry: fixture.registry,
      capabilities: HEADLESS,
      preview: true,
    }, preview.io);
    assert.equal(importCode, SETTINGS_EXIT.ok);
    assert.equal(fixture.enabled.value, true);
    assert.equal(fixture.enabled.applyCount, 0);
    const result = JSON.parse(preview.out()) as { data: { mutated: boolean; preview: unknown[] } };
    assert.equal(result.data.mutated, false);
    assert.equal(result.data.preview.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reset preview emits the exact redacted issued plan and cancels byte-identically", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-reset-preview-"));
  try {
    const first = resetRegistryFixture();
    const before = first.backing.bytes;
    const capture = captureIo();
    let prompts = 0;
    const code = await runSettingsCommand(context(root, true), ["reset", "reset group"], {
      registry: first.registry,
      capabilities: HEADLESS,
      scope: "global",
      preview: true,
      confirmPhrase: async () => {
        prompts += 1;
        return null;
      },
    }, capture.io);
    assert.equal(code, SETTINGS_EXIT.ok);
    assert.equal(first.backing.bytes, before, "preview cancellation must preserve backing bytes exactly");
    assert.deepEqual(first.backing.planned, ["reset.alpha", "reset.beta"]);
    assert.deepEqual(first.backing.applied, []);
    assert.deepEqual(first.backing.rolledBack, []);
    assert.equal(prompts, 0, "preview must not enter the confirmation or apply rail");
    assert.equal(capture.err(), "");

    const parsed = JSON.parse(capture.out()) as {
      ok: boolean;
      command: string;
      data: {
        status: string;
        mutated: boolean;
        resetSettingIds: string[];
        alreadyUnsetSettingIds: string[];
        cancellation: { status: string; mutated: boolean; discardedChanges: number };
        plan: { planId: string; changes: Array<{ settingId: string; operation: string }>; confirmations: Array<{ phrase: string }> };
      };
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, "reset");
    assert.equal(parsed.data.status, "previewed");
    assert.equal(parsed.data.mutated, false);
    assert.deepEqual(parsed.data.resetSettingIds, ["reset.alpha", "reset.beta"]);
    assert.deepEqual(parsed.data.alreadyUnsetSettingIds, ["reset.empty"]);
    assert.deepEqual(parsed.data.plan.changes.map((change) => [change.settingId, change.operation]), [
      ["reset.alpha", "unset"],
      ["reset.beta", "unset"],
    ]);
    assert.deepEqual(parsed.data.plan.confirmations.map((confirmation) => confirmation.phrase), ["RESET BETA"]);
    assert.match(parsed.data.plan.planId, /^settings-/);
    assert.deepEqual(parsed.data.cancellation, {
      status: "cancelled",
      mutated: false,
      discardedChanges: 2,
    });
    assert.doesNotMatch(capture.out(), /reset\.project.*operation|other\.keep.*operation/);

    const second = resetRegistryFixture();
    const repeated = captureIo();
    const repeatedCode = await runSettingsCommand(context(root, true), ["reset", "Reset Group"], {
      registry: second.registry,
      capabilities: HEADLESS,
      scope: "global",
      preview: true,
    }, repeated.io);
    assert.equal(repeatedCode, SETTINGS_EXIT.ok);
    assert.equal(repeated.out(), capture.out(), "preview JSON must be byte-stable for the same snapshot");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reset applies the same issued batch through exact confirmation and stable receipt rails", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-reset-apply-"));
  try {
    const fixture = resetRegistryFixture();
    const confirmations: string[] = [];
    const capture = captureIo();
    const code = await runSettingsCommand(context(root, true, true), ["reset", "Reset Group"], {
      registry: fixture.registry,
      capabilities: HEADLESS,
      scope: "global",
      confirmPhrase: async (confirmation) => {
        confirmations.push(confirmation.settingId);
        return confirmation.phrase;
      },
    }, capture.io);
    assert.equal(code, SETTINGS_EXIT.ok);
    assert.deepEqual(confirmations, ["reset.beta"]);
    assert.deepEqual(fixture.backing.planned, ["reset.alpha", "reset.beta"]);
    assert.deepEqual(fixture.backing.applied, ["reset.alpha", "reset.beta"]);
    assert.deepEqual(fixture.backing.rolledBack, []);
    const document = JSON.parse(fixture.backing.bytes) as Record<string, unknown>;
    assert.equal(Object.hasOwn(document, "reset.alpha"), false);
    assert.equal(Object.hasOwn(document, "reset.beta"), false);
    assert.equal(document["reset.project"], true, "a project-only member must not be reset at global scope");
    assert.equal(document["other.keep"], true, "a member from another section must remain untouched");

    const parsed = JSON.parse(capture.out()) as {
      ok: boolean;
      data: {
        status: string;
        mutated: boolean;
        resetSettingIds: string[];
        receipt: { status: string; completedAt: string; applied: Array<{ settingId: string }> };
      };
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.status, "applied");
    assert.equal(parsed.data.mutated, true);
    assert.deepEqual(parsed.data.resetSettingIds, ["reset.alpha", "reset.beta"]);
    assert.equal(parsed.data.receipt.status, "applied");
    assert.equal(parsed.data.receipt.completedAt, "2030-01-02T03:04:05.000Z");
    assert.deepEqual(parsed.data.receipt.applied.map((entry) => entry.settingId), ["reset.alpha", "reset.beta"]);

    const humanFixture = resetRegistryFixture();
    const human = captureIo();
    const humanCode = await runSettingsCommand(context(root), ["reset", "Reset Group"], {
      registry: humanFixture.registry,
      capabilities: HEADLESS,
      scope: "global",
      confirmPhrase: async (confirmation) => confirmation.phrase,
    }, human.io);
    assert.equal(humanCode, SETTINGS_EXIT.ok);
    assert.equal(human.out(), "reset 2 settings in Reset Group at global scope\n");
    assert.equal(human.err(), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reset compensates a later failed mutation and reports the truthful rolled-back outcome", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-reset-compensation-"));
  try {
    const fixture = resetRegistryFixture({ failAfterMutation: "reset.beta" });
    const before = fixture.backing.bytes;
    const capture = captureIo();
    const code = await runSettingsCommand(context(root, true), ["reset", "Reset Group"], {
      registry: fixture.registry,
      capabilities: HEADLESS,
      scope: "global",
      confirmPhrase: async (confirmation) => confirmation.phrase,
    }, capture.io);
    assert.equal(code, SETTINGS_EXIT.failed);
    assert.equal(fixture.backing.bytes, before, "compensation must restore the original bytes, including formatting");
    assert.deepEqual(fixture.backing.applied, ["reset.alpha", "reset.beta"]);
    assert.deepEqual(fixture.backing.rolledBack, ["reset.beta", "reset.alpha"]);
    const parsed = JSON.parse(capture.out()) as {
      ok: boolean;
      data: {
        status: string;
        mutated: boolean;
        receipt: { status: string; rollbacks: Array<{ settingId: string; status: string }> };
      };
    };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.data.status, "rolled_back");
    assert.equal(parsed.data.mutated, false);
    assert.equal(parsed.data.receipt.status, "rolled_back");
    assert.deepEqual(parsed.data.receipt.rollbacks, [
      { settingId: "reset.beta", scope: "global", status: "rolled_back" },
      { settingId: "reset.alpha", scope: "global", status: "rolled_back" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reset fails closed before planning when a batch member is not rollback-capable", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-reset-atomic-"));
  try {
    const fixture = resetRegistryFixture({ rollbacklessId: "reset.beta" });
    const before = fixture.backing.bytes;
    const capture = captureIo();
    const code = await runSettingsCommand(context(root, true), ["reset", "Reset Group"], {
      registry: fixture.registry,
      capabilities: HEADLESS,
      scope: "global",
    }, capture.io);
    assert.equal(code, SETTINGS_EXIT.failed);
    assert.equal(fixture.backing.bytes, before);
    assert.deepEqual(fixture.backing.planned, [], "atomic capability must be checked before adapter planning");
    assert.deepEqual(fixture.backing.applied, []);
    const parsed = JSON.parse(capture.out()) as { ok: boolean; data: { status: string; mutated: boolean } };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.data.status, "plan_unavailable");
    assert.equal(parsed.data.mutated, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reset distinguishes unknown, unsupported-scope, and already-unset sections", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-reset-states-"));
  try {
    const unknownFixture = resetRegistryFixture();
    const unknown = captureIo();
    const unknownCode = await runSettingsCommand(context(root, true), ["reset", "Missing"], {
      registry: unknownFixture.registry,
      capabilities: HEADLESS,
      scope: "global",
    }, unknown.io);
    assert.equal(unknownCode, SETTINGS_EXIT.failed);
    assert.equal((JSON.parse(unknown.out()) as { data: { status: string } }).data.status, "unknown_section");

    const alreadyFixture = resetRegistryFixture({
      bytes: '{"reset.project":true,"other.keep":true}\n',
    });
    const before = alreadyFixture.backing.bytes;
    const already = captureIo();
    const alreadyCode = await runSettingsCommand(context(root, true), ["reset", "Reset Group"], {
      registry: alreadyFixture.registry,
      capabilities: HEADLESS,
      scope: "global",
    }, already.io);
    assert.equal(alreadyCode, SETTINGS_EXIT.ok);
    assert.equal(alreadyFixture.backing.bytes, before);
    assert.deepEqual(alreadyFixture.backing.planned, []);
    const alreadyData = (JSON.parse(already.out()) as {
      data: { status: string; mutated: boolean; resetSettingIds: string[]; alreadyUnsetSettingIds: string[] };
    }).data;
    assert.equal(alreadyData.status, "already_unset");
    assert.equal(alreadyData.mutated, false);
    assert.deepEqual(alreadyData.resetSettingIds, []);
    assert.deepEqual(alreadyData.alreadyUnsetSettingIds, ["reset.alpha", "reset.beta", "reset.empty"]);

    const projectBacking: ResetBacking = {
      bytes: '{"project.only":true}',
      planned: [],
      applied: [],
      rolledBack: [],
    };
    const projectRegistry = new SettingsRegistry();
    projectRegistry.register(resetDefinition({
      id: "project.only",
      section: "Project Only",
      scopes: ["default", "project"],
      layerScope: "project",
    }, projectBacking));
    const unsupported = captureIo();
    const unsupportedCode = await runSettingsCommand(context(root, true), ["reset", "Project Only"], {
      registry: projectRegistry,
      capabilities: HEADLESS,
      scope: "global",
    }, unsupported.io);
    assert.equal(unsupportedCode, SETTINGS_EXIT.failed);
    assert.equal((JSON.parse(unsupported.out()) as { data: { status: string } }).data.status, "scope_unsupported");
    assert.equal(projectBacking.bytes, '{"project.only":true}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no-arg noninteractive mode renders the responsive settings view", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-command-"));
  try {
    const fixture = registryFixture();
    const capture = captureIo();
    const code = await runSettingsCommand(context(root), [], {
      registry: fixture.registry,
      capabilities: { ...HEADLESS, columns: 42, rows: 12 },
      interactive: false,
    }, capture.io);
    assert.equal(code, SETTINGS_EXIT.ok);
    assert.match(capture.out(), /AETHER SETTINGS\s+NARROW/);
    assert.match(capture.out(), /Aether Online/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("interactive startup bounds a never-settling read and fails visibly without entering raw mode", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-command-startup-timeout-"));
  try {
    const timer = new ManualSettingsTimer();
    const observed: { signal?: AbortSignal } = {};
    const registry = neverReadRegistry(timer, observed);
    const fake = interactiveRuntime();
    const capture = captureIo();
    const pending = runSettingsCommand(context(root), [], {
      registry,
      capabilities: HEADLESS,
      interactive: true,
      interactiveRuntime: fake.runtime,
    }, capture.io);

    assert.equal(fake.signals.listenerCount("SIGINT"), 1, "startup signal handler must precede begin()");
    assert.equal(timer.pending, 1);
    timer.fireAll();
    assert.equal(await pending, SETTINGS_EXIT.failed);
    assert.equal(observed.signal?.aborted, true);
    assert.match(capture.out(), /initial snapshot timed out; no settings were changed/);
    assert.deepEqual(fake.input.rawTransitions, []);
    assert.equal(fake.input.isPaused(), true);
    assert.equal(fake.input.listenerCount("data"), 0);
    assert.equal(fake.signals.listenerCount("SIGINT"), 0);
    assert.equal(fake.signals.listenerCount("SIGTERM"), 0);
    assert.equal(timer.pending, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SIGINT during the initial never-settling snapshot aborts before raw mode and leaks no listeners", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-command-startup-signal-"));
  try {
    const timer = new ManualSettingsTimer();
    const observed: { signal?: AbortSignal } = {};
    const registry = neverReadRegistry(timer, observed);
    const fake = interactiveRuntime();
    const capture = captureIo();
    const pending = runSettingsCommand(context(root), [], {
      registry,
      capabilities: HEADLESS,
      interactive: true,
      interactiveRuntime: fake.runtime,
    }, capture.io);

    assert.equal(fake.signals.listenerCount("SIGINT"), 1);
    assert.equal(timer.pending, 1);
    assert.deepEqual(fake.input.rawTransitions, []);
    fake.signals.emit("SIGINT");
    assert.equal(await pending, 130);
    assert.equal(observed.signal?.aborted, true);
    assert.deepEqual(fake.input.rawTransitions, [], "startup cancellation must never enter raw mode");
    assert.equal(fake.input.isPaused(), true);
    assert.equal(fake.input.listenerCount("data"), 0);
    assert.equal(fake.signals.listenerCount("SIGINT"), 0);
    assert.equal(fake.signals.listenerCount("SIGTERM"), 0);
    assert.equal(timer.pending, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("interactive SIGINT waits for in-flight apply compensation before resolving", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-settings-command-signal-"));
  try {
    let enterApply!: () => void;
    let releaseApply!: () => void;
    const entered = new Promise<void>((resolve) => { enterApply = resolve; });
    const released = new Promise<void>((resolve) => { releaseApply = resolve; });
    const observed = { value: true, rollbacks: 0 };
    let applySignal: AbortSignal | undefined;
    const registry = new SettingsRegistry();
    registry.register({
      id: "agent.enabled",
      section: "Agent",
      label: "Agent enabled",
      description: "delayed authority for signal settlement regression",
      valueType: "boolean",
      scopes: ["default", "global", "project"],
      async read() {
        return {
          layers: [{ scope: "global", source: "test settings", value: observed.value }],
          health: { state: "configured", summary: "configured for test" },
        };
      },
      validate: booleanValidator,
      async plan(change) { return change; },
      async apply(plan, operation) {
        applySignal = operation?.signal;
        enterApply();
        await released;
        const before = observed.value;
        const change = plan as SettingChange<boolean>;
        observed.value = change.afterAtScope?.state === "known" ? change.afterAtScope.value : false;
        return { ok: true as const, receipt: { rollbackToken: before } };
      },
      async rollback(receipt) {
        observed.rollbacks += 1;
        observed.value = Boolean(receipt.rollbackToken);
      },
    });
    const fake = interactiveRuntime();
    const capture = captureIo();
    const pending = runSettingsCommand(context(root), [], {
      registry,
      capabilities: HEADLESS,
      interactive: true,
      interactiveRuntime: fake.runtime,
    }, capture.io);

    for (let attempt = 0; attempt < 20 && fake.input.listenerCount("data") === 0; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(fake.input.listenerCount("data"), 1);
    fake.input.emit("data", Buffer.from(" "));
    fake.input.emit("data", Buffer.from("\u0013"));
    await entered;

    let resolved = false;
    void pending.then(() => { resolved = true; });
    fake.signals.emit("SIGINT");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(applySignal?.aborted, true);
    assert.equal(resolved, false, "the command must keep the UI alive while mutation state is unresolved");

    releaseApply();
    assert.equal(await pending, 130);
    assert.equal(observed.rollbacks, 1);
    assert.equal(observed.value, true);
    assert.equal(fake.signals.listenerCount("SIGINT"), 0);
    assert.equal(fake.signals.listenerCount("SIGTERM"), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
