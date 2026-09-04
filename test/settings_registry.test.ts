import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SettingsRegistry,
  booleanValidator,
  enumValidator,
  finiteNumberValidator,
  pathValidator,
  secretReference,
  secretReferenceValidator,
  settingsPlanToRedactedJson,
  stableJsonStringify,
  stringValidator,
  type AdapterApplyReceipt,
  type AdapterApplyResult,
  type SettingChange,
  type SettingDefinition,
  type SettingHealth,
  type SettingLayer,
  type SettingPlanContext,
  type SettingsOperationContext,
  type SettingsOperationTimer,
  type SettingValue,
  type SettingValueType,
  type ValidationResult,
} from "../src/core/settings_registry.js";

interface DefinitionOptions<T extends SettingValue> {
  id: string;
  valueType: SettingValueType;
  layers?: SettingLayer[];
  validate: (value: unknown) => ValidationResult<T>;
  health?: SettingHealth;
  doctor?: SettingHealth;
  requiresRestart?: boolean;
  sensitive?: boolean;
  confirmation?: SettingDefinition<T>["confirmation"];
  rollback?: boolean;
  onPlan?: (change: SettingChange<T>, context: SettingPlanContext) => unknown;
  onApply?: (plan: unknown, context?: SettingsOperationContext) => AdapterApplyResult | Promise<AdapterApplyResult>;
  onRollback?: (receipt: AdapterApplyReceipt, context?: SettingsOperationContext) => void | Promise<void>;
}

function setting<T extends SettingValue>(options: DefinitionOptions<T>): SettingDefinition<T> {
  return {
    id: options.id,
    section: "test",
    label: options.id,
    description: `setting ${options.id}`,
    valueType: options.valueType,
    scopes: ["default", "global", "project", "session", "env", "server_policy"],
    ...(options.requiresRestart === undefined ? {} : { requiresRestart: options.requiresRestart }),
    ...(options.sensitive === undefined ? {} : { sensitive: options.sensitive }),
    ...(options.confirmation === undefined ? {} : { confirmation: options.confirmation }),
    async read() {
      return {
        layers: options.layers ?? [],
        ...(options.health ? { health: options.health } : {}),
      };
    },
    validate: options.validate,
    async plan(change, context) {
      return options.onPlan?.(change, context) ?? change;
    },
    async apply(plan, context) {
      return await (options.onApply?.(plan, context) ?? {
        ok: true as const,
        receipt: { rollbackToken: null },
      });
    },
    ...(options.rollback
      ? {
          async rollback(receipt: AdapterApplyReceipt, context?: SettingsOperationContext) {
            await options.onRollback?.(receipt, context);
          },
        }
      : {}),
    ...(options.doctor
      ? {
          async doctor() {
            return options.doctor as SettingHealth;
          },
        }
      : {}),
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

test("scope precedence keeps an invalid higher override honestly unknown", async () => {
  const registry = new SettingsRegistry();
  registry.register(setting({
    id: "agent.enabled",
    valueType: "boolean",
    validate: booleanValidator,
    layers: [
      { scope: "global", source: "~/.aether/config.json", value: true },
      { scope: "default", source: "built-in", value: false },
      { scope: "env", source: "AETHER_AGENT_ENABLED", value: "perhaps" },
    ],
  }));

  const snapshot = await registry.snapshot();
  const effective = snapshot.settings["agent.enabled"];
  assert.equal(effective?.state, "unknown");
  if (effective?.state !== "unknown") throw new Error("expected unknown effective value");
  assert.equal(effective.scope, "env");
  assert.equal(effective.rawValue, "perhaps");
  assert.deepEqual(effective.precedence.map((layer) => layer.scope), ["env", "global", "default"]);
  assert.equal(effective.health.state, "unknown");

  const tx = await registry.begin();
  const staged = tx.stage("agent.enabled", "global", false);
  assert.equal(staged.ok && staged.changed, true);
  if (!staged.ok || !staged.changed) throw new Error("expected staged change");
  assert.equal(staged.preview.after.state, "unknown");
  assert.equal(staged.preview.after.scope, "env");

  const envWrite = tx.stage("agent.enabled", "env", true);
  assert.equal(envWrite.ok, false);
  if (envWrite.ok) throw new Error("environment writes must be rejected");
  assert.equal(envWrite.issues[0]?.code, "scope.read_only");
  assert.equal(tx.stage("agent.enabled", "server_policy", true).ok, false);
  assert.equal(tx.unset("agent.enabled", "default").ok, false);
});

test("typed validators reject coercion and doctors never imply verification", async () => {
  assert.deepEqual(booleanValidator("true"), {
    ok: false,
    issues: [{ code: "type.boolean", message: "expected a boolean" }],
  });
  assert.deepEqual(finiteNumberValidator(Number.POSITIVE_INFINITY).ok, false);
  assert.deepEqual(pathValidator("\0bad").ok, false);
  assert.equal(enumValidator(["auto", "manual"] as const)("other").ok, false);
  assert.deepEqual(secretReferenceValidator("raw-secret").ok, false);
  assert.deepEqual(secretReference("env", "AETHER_API_TOKEN"), {
    kind: "secret_ref",
    provider: "env",
    name: "AETHER_API_TOKEN",
  });

  const registry = new SettingsRegistry();
  registry.register(setting({
    id: "limits.turns",
    valueType: "number",
    layers: [{ scope: "global", source: "config", value: 4 }],
    validate: finiteNumberValidator,
    health: { state: "configured", summary: "loaded only" },
    doctor: { state: "verified", summary: "checked end to end" },
  }));
  registry.register(setting({
    id: "broken.validator",
    valueType: "number",
    layers: [{ scope: "global", source: "future writer", value: 4 }],
    validate: (_value) => ({ ok: true, value: "wrong" }) as unknown as ValidationResult<number>,
  }));

  assert.equal((await registry.snapshot()).settings["limits.turns"]?.health.state, "configured");
  assert.equal((await registry.snapshot({ doctor: true })).settings["limits.turns"]?.health.state, "verified");
  const broken = (await registry.snapshot()).settings["broken.validator"];
  assert.equal(broken?.state, "unknown");
  if (broken?.state !== "unknown") throw new Error("expected validator mismatch to remain unknown");
  assert.equal(broken.issues[0]?.code, "validator.type_mismatch");
});

test("a never-settling read is bounded, signalled, and surfaced as unavailable", async () => {
  const timer = new ManualSettingsTimer();
  let readSignal: AbortSignal | undefined;
  const registry = new SettingsRegistry({ operationTimeoutMs: 25, operationTimer: timer });
  registry.register({
    id: "bounded.read",
    section: "test",
    label: "bounded read",
    description: "never-settling read fixture",
    valueType: "boolean",
    scopes: ["default"],
    read(context) {
      readSignal = context?.signal;
      return new Promise(() => {});
    },
    validate: booleanValidator,
    async plan() { return {}; },
    async apply() { return { ok: false, error: "read-only" }; },
  });

  const pending = registry.snapshot();
  assert.equal(timer.pending, 1);
  timer.fireAll();
  const snapshot = await pending;
  assert.equal(readSignal?.aborted, true);
  assert.equal(snapshot.settings["bounded.read"]?.health.state, "unavailable");
  assert.match(snapshot.settings["bounded.read"]?.health.summary ?? "", /timed out after 25 ms/);
  assert.equal(timer.pending, 0);
});

test("a never-settling doctor shares the bounded snapshot signal without hiding the read value", async () => {
  const timer = new ManualSettingsTimer();
  let enterDoctor!: () => void;
  const doctorEntered = new Promise<void>((resolve) => { enterDoctor = resolve; });
  let doctorSignal: AbortSignal | undefined;
  const registry = new SettingsRegistry({ operationTimeoutMs: 30, operationTimer: timer });
  registry.register({
    id: "bounded.doctor",
    section: "test",
    label: "bounded doctor",
    description: "never-settling doctor fixture",
    valueType: "boolean",
    scopes: ["default"],
    async read() {
      return { layers: [{ scope: "default", source: "fixture", value: true }] };
    },
    validate: booleanValidator,
    async plan() { return {}; },
    async apply() { return { ok: false, error: "read-only" }; },
    doctor(context) {
      doctorSignal = context?.signal;
      enterDoctor();
      return new Promise(() => {});
    },
  });

  const pending = registry.snapshot({ doctor: true });
  await doctorEntered;
  timer.fireAll();
  const snapshot = await pending;
  const effective = snapshot.settings["bounded.doctor"];
  assert.equal(effective?.state, "known");
  assert.equal(effective?.state === "known" && effective.value, true);
  assert.equal(effective?.health.state, "unavailable");
  assert.match(effective?.health.summary ?? "", /timed out after 30 ms/);
  assert.equal(doctorSignal?.aborted, true);
  assert.equal(timer.pending, 0);
});

test("a never-settling plan is bounded, receives cancellation, and can never be issued", async () => {
  const timer = new ManualSettingsTimer();
  let enterPlan!: () => void;
  const planEntered = new Promise<void>((resolve) => { enterPlan = resolve; });
  let planSignal: AbortSignal | undefined;
  let applied = 0;
  const registry = new SettingsRegistry({ operationTimeoutMs: 35, operationTimer: timer });
  registry.register(setting({
    id: "bounded.plan",
    valueType: "boolean",
    validate: booleanValidator,
    layers: [{ scope: "global", source: "fixture", value: false }],
    onPlan(_change, context) {
      planSignal = context.signal;
      enterPlan();
      return new Promise(() => {});
    },
    onApply() {
      applied += 1;
      return { ok: true, receipt: {} };
    },
  }));

  const transaction = await registry.begin();
  transaction.stage("bounded.plan", "global", true);
  const planning = transaction.createPlan();
  await planEntered;
  assert.equal(timer.pending, 1);
  timer.fireAll();
  await assert.rejects(planning, /settings planning timed out after 35 ms/);
  assert.equal(planSignal?.aborted, true);
  assert.equal(applied, 0);
  assert.equal(timer.pending, 0);
});

test("equal-precedence duplicates preserve every raw value instead of choosing one", async () => {
  const registry = new SettingsRegistry();
  registry.register(setting({
    id: "future.mode",
    valueType: "string",
    validate: stringValidator,
    layers: [
      { scope: "project", source: "b.json", value: "b" },
      { scope: "project", source: "a.json", value: "a" },
      { scope: "default", source: "built-in", value: "default" },
    ],
  }));
  const value = (await registry.snapshot()).settings["future.mode"];
  assert.equal(value?.state, "unknown");
  if (value?.state !== "unknown") throw new Error("expected duplicate to be unknown");
  assert.equal(value.issues[0]?.code, "scope.duplicate");
  assert.deepEqual(value.rawValue, [
    { source: "a.json", value: "a" },
    { source: "b.json", value: "b" },
  ]);
});

test("staging previews before/after while cancel performs no adapter mutation", async () => {
  const calls: string[] = [];
  const disk = { value: "before", extension: { future: 7 } };
  const registry = new SettingsRegistry();
  registry.register(setting({
    id: "editor.mode",
    valueType: "enum",
    validate: enumValidator(["before", "after"] as const),
    layers: [{ scope: "global", source: "config.json", value: disk.value }],
    onPlan(change) {
      calls.push("plan");
      return change;
    },
    onApply() {
      calls.push("apply");
      disk.value = "after";
      return { ok: true, receipt: {} };
    },
  }));

  const bytesBefore = JSON.stringify(disk);
  const tx = await registry.begin();
  const staged = tx.stage("editor.mode", "global", "after");
  assert.equal(staged.ok && staged.changed, true);
  if (!staged.ok || !staged.changed) throw new Error("expected change");
  assert.equal(staged.preview.before.value, "before");
  assert.equal(staged.preview.after.value, "after");
  assert.equal(staged.preview.beforeAtScope?.value, "before");
  assert.equal(staged.preview.afterAtScope?.value, "after");

  assert.deepEqual(tx.cancel(), { status: "cancelled", discardedChanges: 1, mutated: false });
  assert.equal(JSON.stringify(disk), bytesBefore);
  assert.deepEqual(calls, []);
  assert.deepEqual(tx.preview(), []);
});

test("cancelling an in-flight apply waits for compensation and never reports mutated false early", async () => {
  let enterApply!: () => void;
  let releaseApply!: () => void;
  const entered = new Promise<void>((resolve) => { enterApply = resolve; });
  const released = new Promise<void>((resolve) => { releaseApply = resolve; });
  const value = { current: false };
  let applySignal: AbortSignal | undefined;
  let rollbackSignal: AbortSignal | undefined;
  const registry = new SettingsRegistry({ now: () => "2026-09-04T00:00:00.000Z" });
  registry.register(setting({
    id: "cancel.delayed",
    valueType: "boolean",
    validate: booleanValidator,
    layers: [{ scope: "global", source: "config", value: false }],
    rollback: true,
    async onApply(_plan, context) {
      applySignal = context?.signal;
      enterApply();
      await released;
      const before = value.current;
      value.current = true;
      return { ok: true, receipt: { rollbackToken: before } };
    },
    onRollback(receipt, context) {
      rollbackSignal = context?.signal;
      value.current = Boolean(receipt.rollbackToken);
    },
  }));

  const transaction = await registry.begin();
  transaction.stage("cancel.delayed", "global", true);
  const plan = await transaction.createPlan();
  const applying = transaction.applyPlan(plan);
  await entered;

  let cancellationSettled = false;
  const cancelling = transaction.cancelAndWait().then((outcome) => {
    cancellationSettled = true;
    return outcome;
  });
  assert.equal(applySignal?.aborted, true);
  await Promise.resolve();
  assert.equal(cancellationSettled, false, "cancellation must not terminalize while adapter mutation is unresolved");

  releaseApply();
  const [receipt, outcome] = await Promise.all([applying, cancelling]);
  assert.deepEqual(outcome.cancellation, {
    status: "cancelling",
    discardedChanges: 1,
    mutated: "unknown",
  });
  assert.equal(receipt.status, "cancelled");
  assert.equal(receipt.failure?.kind, "cancelled");
  assert.equal(outcome.apply, receipt);
  assert.deepEqual(receipt.rollbacks, [{
    settingId: "cancel.delayed",
    scope: "global",
    status: "rolled_back",
  }]);
  assert.equal(rollbackSignal?.aborted, false, "cleanup uses a non-aborted signal");
  assert.equal(value.current, false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(value.current, false, "no adapter mutation may land after cancellation settles");
});

test("cancel during asynchronous planning revokes the would-be plan before it can mutate", async () => {
  let enterPlan!: () => void;
  let releasePlan!: () => void;
  const entered = new Promise<void>((resolve) => { enterPlan = resolve; });
  const released = new Promise<void>((resolve) => { releasePlan = resolve; });
  let applied = 0;
  const registry = new SettingsRegistry();
  registry.register(setting({
    id: "cancel.planning",
    valueType: "boolean",
    validate: booleanValidator,
    layers: [{ scope: "global", source: "config", value: false }],
    async onPlan(change) {
      enterPlan();
      await released;
      return change;
    },
    onApply() {
      applied += 1;
      return { ok: true, receipt: {} };
    },
  }));

  const transaction = await registry.begin();
  transaction.stage("cancel.planning", "global", true);
  const planning = transaction.createPlan();
  await entered;
  assert.deepEqual(transaction.cancel(), { status: "cancelled", discardedChanges: 1, mutated: false });
  releasePlan();
  await assert.rejects(planning, /planning was cancelled or changed/);
  assert.equal(applied, 0);
});

test("plans are stable, require exact impact confirmations, and return bounded receipts", async () => {
  const calls: string[] = [];
  const fixedNow = "2026-09-04T00:00:00.000Z";
  const registry = new SettingsRegistry({ now: () => fixedNow });
  registry.register(setting({
    id: "z.cost",
    valueType: "number",
    validate: finiteNumberValidator,
    layers: [{ scope: "global", source: "config", value: 1 }],
    rollback: true,
    confirmation: {
      impact: "cost_sensitive",
      phrase: "APPLY COST CHANGE",
      reason: "may increase usage",
      approvalFlag: "--approve cost",
    },
    onPlan: (change) => ({ next: change.afterAtScope?.value, opaque: "PLAN-SECRET" }),
    onApply() {
      calls.push("apply:z.cost");
      return { ok: true, receipt: { rollbackToken: "ROLLBACK-SECRET", summary: "saved" } };
    },
  }));
  registry.register(setting({
    id: "a.erase",
    valueType: "boolean",
    validate: booleanValidator,
    layers: [{ scope: "project", source: "project", value: false }],
    requiresRestart: true,
    rollback: true,
    confirmation: {
      impact: "destructive",
      phrase: "ERASE CACHE",
      reason: "removes cached data",
    },
    onPlan: (change) => ({ next: change.afterAtScope?.value }),
    onApply() {
      calls.push("apply:a.erase");
      return { ok: true, receipt: { rollbackToken: false } };
    },
  }));

  const tx = await registry.begin();
  assert.equal(tx.stage("z.cost", "global", 2).ok, true);
  assert.equal(tx.stage("a.erase", "project", true).ok, true);
  const plan = await tx.createPlan();
  assert.deepEqual(plan.changes.map((change) => change.settingId), ["a.erase", "z.cost"]);
  assert.equal(plan.requiresRestart, true);
  assert.deepEqual(plan.confirmations.map((item) => item.phrase), ["ERASE CACHE", "APPLY COST CHANGE"]);
  assert.doesNotMatch(settingsPlanToRedactedJson(plan), /PLAN-SECRET/);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.confirmations), true);
  assert.equal(Object.isFrozen(plan.confirmations[0]), true);
  assert.equal(
    Reflect.set(plan.confirmations[0] as object, "phrase", "ATTACKER REWROTE APPROVAL"),
    false,
  );
  assert.equal(Reflect.set(plan as object, "confirmations", []), false);
  assert.equal(plan.confirmations[0]?.phrase, "ERASE CACHE");
  const attackerApproval = await registry.apply(plan, {
    confirmations: ["ATTACKER REWROTE APPROVAL", "APPLY COST CHANGE"],
  });
  assert.equal(attackerApproval.failure?.kind, "confirmation_required");
  assert.equal(attackerApproval.failure?.missingConfirmations?.[0]?.phrase, "ERASE CACHE");

  const tx2 = await registry.begin();
  tx2.stage("z.cost", "global", 2);
  tx2.stage("a.erase", "project", true);
  assert.equal((await tx2.createPlan()).planId, plan.planId);

  const rejected = await registry.apply(plan, { confirmations: ["ERASE CACHE"] });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.failure?.kind, "confirmation_required");
  assert.deepEqual(calls, []);

  const applied = await registry.apply(plan, {
    confirmations: ["ERASE CACHE", "APPLY COST CHANGE"],
  });
  assert.equal(applied.status, "applied");
  assert.equal(applied.completedAt, fixedNow);
  assert.deepEqual(calls, ["apply:a.erase", "apply:z.cost"]);
  assert.doesNotMatch(JSON.stringify(applied), /ROLLBACK-SECRET/);
  assert.equal((await registry.apply(plan, {
    confirmations: ["ERASE CACHE", "APPLY COST CHANGE"],
  })).failure?.kind, "invalid_plan");
});

test("validated non-secret settings centrally reject credential-shaped values", async () => {
  const registry = new SettingsRegistry();
  for (const id of ["code.hosted_model", "agent.api_base_url", "display.note"]) {
    registry.register(setting({
      id,
      valueType: "string",
      validate: stringValidator,
      layers: [{ scope: "default", source: "default", value: "safe" }],
    }));
  }
  const tx = await registry.begin();
  const hosted = tx.stage("code.hosted_model", "global", "sk-abcdefghijklmnop123456");
  assert.equal(hosted.ok, false);
  if (hosted.ok) throw new Error("credential-shaped hosted model should fail");
  assert.equal(hosted.issues[0]?.code, "value.secret_material");

  const query = tx.stage(
    "agent.api_base_url",
    "global",
    "https://api.example.test/cloud?api_token=not-even-a-real-secret",
  );
  assert.equal(query.ok, false);
  if (query.ok) throw new Error("credential query parameter should fail");
  assert.match(query.issues[0]?.message ?? "", /credential query parameter/);

  assert.equal(tx.stage("display.note", "project", "Bearer abcdefghijklmnop").ok, false);
  assert.equal(tx.stage("display.note", "project", "ordinary public note").ok, true);
});

test("a failed batch compensates the failed mutation and prior settings in reverse order", async () => {
  const values: Record<string, boolean> = { a: false, b: false, c: false };
  const calls: string[] = [];
  const registry = new SettingsRegistry({ now: () => "2026-09-04T00:00:00.000Z" });

  for (const id of ["a", "b", "c"] as const) {
    registry.register(setting({
      id: `batch.${id}`,
      valueType: "boolean",
      validate: booleanValidator,
      layers: [{ scope: "global", source: "config", value: false }],
      rollback: true,
      onPlan: (change) => ({ id, next: change.afterAtScope?.value }),
      onApply(plan) {
        const before = values[id];
        values[id] = Boolean((plan as { next: unknown }).next);
        calls.push(`apply:${id}`);
        if (id === "c") {
          return {
            ok: false,
            error: "provider failed token=super-secret-value",
            compensationReceipt: { rollbackToken: before },
          };
        }
        return { ok: true, receipt: { rollbackToken: before } };
      },
      onRollback(receipt) {
        calls.push(`rollback:${id}`);
        values[id] = Boolean(receipt.rollbackToken);
      },
    }));
  }

  const tx = await registry.begin();
  tx.stage("batch.c", "global", true);
  tx.stage("batch.a", "global", true);
  tx.stage("batch.b", "global", true);
  const receipt = await tx.apply();
  assert.equal(receipt.status, "rolled_back");
  assert.equal(receipt.failure?.kind, "apply_failed");
  assert.deepEqual(calls, [
    "apply:a",
    "apply:b",
    "apply:c",
    "rollback:c",
    "rollback:b",
    "rollback:a",
  ]);
  assert.deepEqual(values, { a: false, b: false, c: false });
  assert.deepEqual(receipt.rollbacks.map((entry) => entry.settingId), ["batch.c", "batch.b", "batch.a"]);
  assert.doesNotMatch(JSON.stringify(receipt), /super-secret-value/);
});

test("multi-setting plans reject adapters without rollback before planning", async () => {
  let planned = 0;
  const registry = new SettingsRegistry();
  for (const id of ["safe.one", "unsafe.two"] as const) {
    registry.register(setting({
      id,
      valueType: "boolean",
      validate: booleanValidator,
      layers: [{ scope: "global", source: "config", value: false }],
      rollback: id === "safe.one",
      onPlan() {
        planned += 1;
        return {};
      },
    }));
  }
  const tx = await registry.begin();
  tx.stage("safe.one", "global", true);
  tx.stage("unsafe.two", "global", true);
  await assert.rejects(tx.createPlan(), /requires rollback support: unsafe\.two/);
  assert.equal(planned, 0);
});

test("cancel and restaging revoke every previously issued plan", async () => {
  let applied = 0;
  const registry = new SettingsRegistry();
  registry.register(setting({
    id: "revocation.mode",
    valueType: "string",
    validate: stringValidator,
    layers: [{ scope: "global", source: "config", value: "before" }],
    onApply() {
      applied += 1;
      return { ok: true, receipt: {} };
    },
  }));

  const cancelled = await registry.begin();
  cancelled.stage("revocation.mode", "global", "cancelled");
  const cancelledPlan = await cancelled.createPlan();
  cancelled.cancel();
  assert.equal((await registry.apply(cancelledPlan)).failure?.kind, "invalid_plan");

  const restaged = await registry.begin();
  restaged.stage("revocation.mode", "global", "first");
  const stalePlan = await restaged.createPlan();
  restaged.stage("revocation.mode", "global", "second");
  assert.equal((await registry.apply(stalePlan)).failure?.kind, "invalid_plan");
  assert.equal((await restaged.apply()).status, "applied");
  assert.equal(applied, 1);
});

test("an adapter throw is conservatively reported as unknown mutation state", async () => {
  const registry = new SettingsRegistry();
  registry.register(setting({
    id: "throwing.adapter",
    valueType: "boolean",
    validate: booleanValidator,
    layers: [{ scope: "global", source: "config", value: false }],
    rollback: true,
    onApply() {
      throw new Error("failed after an unknown mutation");
    },
  }));

  const tx = await registry.begin();
  tx.stage("throwing.adapter", "global", true);
  const receipt = await tx.apply();
  assert.equal(receipt.status, "compensation_failed");
  assert.equal(receipt.failure?.kind, "compensation_failed");
  assert.deepEqual(receipt.rollbacks, [{
    settingId: "throwing.adapter",
    scope: "global",
    status: "rollback_failed",
    error: "adapter threw; mutation state is unknown",
  }]);
});

test("duplicate confirmation phrases are rejected before adapter planning", async () => {
  let planned = 0;
  const registry = new SettingsRegistry();
  for (const id of ["confirm.one", "confirm.two"]) {
    registry.register(setting({
      id,
      valueType: "boolean",
      validate: booleanValidator,
      layers: [{ scope: "global", source: "config", value: false }],
      rollback: true,
      confirmation: {
        impact: "destructive",
        phrase: "CONFIRM SHARED PHRASE",
        reason: "explicit approval required",
      },
      onPlan() {
        planned += 1;
        return {};
      },
    }));
  }
  const tx = await registry.begin();
  tx.stage("confirm.one", "global", true);
  tx.stage("confirm.two", "global", true);
  await assert.rejects(tx.createPlan(), /confirmation phrases must be unique/);
  assert.equal(planned, 0);
});

test("redacted export is deterministic, excludes secret refs, and preserves unknown fields", async () => {
  const leakedToken = "sk-abcdefghijklmnop123456";
  const registry = new SettingsRegistry({
    unknownSettings: {
      "future.feature": { z: 2, a: 1, secret_ref: "env:SHOULD_NOT_EXPORT" },
      "future.opaque": {
        kind: "secret_ref",
        provider: "vault",
        name: "STRUCTURAL_SECRET_REFERENCE_NAME",
      },
      api_token: leakedToken,
    },
    extensions: { zeta: true, alpha: { future: "kept" } },
  });
  registry.register(setting({
    id: "auth.credential",
    valueType: "secret_ref",
    validate: secretReferenceValidator,
    layers: [{
      scope: "global",
      source: "config",
      value: secretReference("env", "VERY_SECRET_REFERENCE_NAME"),
    }],
    sensitive: true,
  }));
  registry.register(setting({
    id: "display.note",
    valueType: "string",
    validate: stringValidator,
    layers: [{ scope: "global", source: "config", value: `Bearer ${leakedToken}` }],
  }));
  registry.register(setting({
    id: "future.unknown",
    valueType: "boolean",
    validate: () => ({
      ok: false,
      issues: [{
        code: `future.${leakedToken}`,
        message: `provider rejected Bearer ${leakedToken}`,
      }],
    }),
    layers: [{ scope: "project", source: "future writer", value: { future: 7 } }],
  }));

  const tx = await registry.begin();
  assert.equal(
    tx.stage("auth.credential", "global", secretReference("env", "NEW_SECRET_REFERENCE_NAME")).ok,
    true,
  );
  const first = tx.exportRedacted();
  const second = tx.exportRedacted();
  assert.equal(first, second);
  assert.doesNotMatch(
    first,
    /VERY_SECRET_REFERENCE_NAME|NEW_SECRET_REFERENCE_NAME|SHOULD_NOT_EXPORT|STRUCTURAL_SECRET_REFERENCE_NAME|abcdefghijklmnop/,
  );
  const exported = JSON.parse(first) as {
    settings: Record<string, unknown>;
    excludedSecretRefs: string[];
    unknownSettings: Record<string, unknown>;
  };
  assert.equal(exported.settings["auth.credential"], undefined);
  assert.deepEqual(exported.excludedSecretRefs, ["auth.credential"]);
  assert.deepEqual(exported.unknownSettings["future.feature"], { a: 1, z: 2 });
  assert.equal(exported.unknownSettings["future.opaque"], "[SECRET_REFERENCE]");
  assert.equal(exported.unknownSettings["api_token"], "[REDACTED]");
  assert.match(first, /future\.unknown/);

  assert.equal(
    stableJsonStringify({ z: 1, a: { y: 2, b: 3 } }, 0),
    '{"a":{"b":3,"y":2},"z":1}',
  );
});
