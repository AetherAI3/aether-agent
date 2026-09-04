// Typed, renderer-independent settings registry and transaction core.
//
// Domain adapters own persistence and remote calls. This module owns the
// invariants shared by every settings surface: precedence, validation, staged
// previews, explicit confirmation, best-effort atomic batches, receipts, and
// redacted deterministic exports.

import { createHash } from "node:crypto";
import { redactForBundle, scanForSecrets, SENSITIVE_KEY } from "./redaction.js";

export const SETTINGS_SCHEMA_VERSION = 1;
export const DEFAULT_SETTINGS_OPERATION_TIMEOUT_MS = 10_000;
export const MAX_SETTINGS_OPERATION_TIMEOUT_MS = 120_000;

export const SETTING_SCOPES = [
  "default",
  "global",
  "project",
  "session",
  "env",
  "server_policy",
] as const;

export type SettingScope = (typeof SETTING_SCOPES)[number];

/** Lowest to highest. A visible policy/env value must never be silently shadowed. */
export const SETTING_SCOPE_PRECEDENCE: readonly SettingScope[] = SETTING_SCOPES;

export const WRITABLE_SETTING_SCOPES = ["global", "project", "session"] as const;
export type WritableSettingScope = (typeof WRITABLE_SETTING_SCOPES)[number];

export const HEALTH_STATES = [
  "unconfigured",
  "configured",
  "reachable",
  "verified",
  "degraded",
  "unavailable",
  "disabled_by_policy",
  "unknown",
] as const;

export type HealthState = (typeof HEALTH_STATES)[number];
export type SettingValueType = "boolean" | "number" | "string" | "enum" | "path" | "secret_ref";
export type SettingImpact = "destructive" | "cost_sensitive";
export type SettingOperation = "set" | "unset";

/** Secret material is never a setting value. Settings may hold only a locator. */
export interface SecretReference {
  readonly kind: "secret_ref";
  readonly provider: string;
  readonly name: string;
}

export type SettingValue = boolean | number | string | SecretReference;

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface SettingHealth {
  readonly state: HealthState;
  readonly summary?: string;
  readonly checkedAt?: string;
  /** Adapter-specific facts. Renderers must use a redacted export. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SettingLayer {
  readonly scope: SettingScope;
  readonly source: string;
  readonly value: unknown;
}

export interface SettingReadResult {
  readonly layers: readonly SettingLayer[];
  /** Omission means not checked, never healthy. */
  readonly health?: SettingHealth;
  /** Forward-compatible adapter fields retained without interpretation. */
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface KnownEffectiveLayer<T extends SettingValue = SettingValue> {
  readonly state: "known";
  readonly scope: SettingScope;
  readonly source: string;
  readonly rank: number;
  readonly value: T;
}

export interface UnknownEffectiveLayer {
  readonly state: "unknown";
  readonly scope: SettingScope;
  readonly source: string;
  readonly rank: number;
  readonly rawValue: unknown;
  readonly issues: readonly ValidationIssue[];
}

export type EffectiveLayer<T extends SettingValue = SettingValue> =
  | KnownEffectiveLayer<T>
  | UnknownEffectiveLayer;

interface EffectiveSettingBase<T extends SettingValue> {
  readonly id: string;
  readonly section: string;
  readonly valueType: SettingValueType;
  /** Highest-precedence layer first, including invalid/unknown layers. */
  readonly precedence: readonly EffectiveLayer<T>[];
  readonly health: SettingHealth;
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface KnownEffectiveSetting<T extends SettingValue = SettingValue>
  extends EffectiveSettingBase<T> {
  readonly state: "known";
  readonly value: T;
  readonly scope: SettingScope;
  readonly source: string;
}

export interface UnknownEffectiveSetting<T extends SettingValue = SettingValue>
  extends EffectiveSettingBase<T> {
  readonly state: "unknown";
  readonly rawValue: unknown;
  readonly scope: SettingScope;
  readonly source: string;
  readonly issues: readonly ValidationIssue[];
}

export interface UnsetEffectiveSetting<T extends SettingValue = SettingValue>
  extends EffectiveSettingBase<T> {
  readonly state: "unset";
}

export type EffectiveSetting<T extends SettingValue = SettingValue> =
  | KnownEffectiveSetting<T>
  | UnknownEffectiveSetting<T>
  | UnsetEffectiveSetting<T>;

export interface ConfirmationMetadata {
  readonly impact: SettingImpact;
  /** Exact phrase required by the apply rail; a generic --yes is insufficient. */
  readonly phrase: string;
  readonly reason: string;
  readonly approvalFlag?: string;
}

export interface RequiredConfirmation extends ConfirmationMetadata {
  readonly settingId: string;
}

export interface SettingChange<T extends SettingValue = SettingValue> {
  readonly settingId: string;
  readonly scope: WritableSettingScope;
  readonly operation: SettingOperation;
  readonly before: EffectiveSetting<T>;
  readonly after: EffectiveSetting<T>;
  readonly beforeAtScope?: EffectiveLayer<T>;
  readonly afterAtScope?: KnownEffectiveLayer<T>;
}

/** Private-to-adapter receipt. rollbackToken is intentionally absent from public batch receipts. */
export interface AdapterApplyReceipt {
  readonly rollbackToken?: unknown;
  readonly summary?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export type AdapterApplyResult =
  | { readonly ok: true; readonly receipt: AdapterApplyReceipt }
  | {
      readonly ok: false;
      readonly error: string;
      /** Present only when a failed apply mutated enough state to require compensation. */
      readonly compensationReceipt?: AdapterApplyReceipt;
    };

export type ConfirmationResolver<T extends SettingValue> =
  | ConfirmationMetadata
  | readonly ConfirmationMetadata[]
  | ((change: SettingChange<T>) => ConfirmationMetadata | readonly ConfirmationMetadata[] | undefined);

/** Opaque identity shared only among adapter plans created for one registry
 * plan. Stateful adapters may use it to coalesce changes that share an atomic
 * persistence boundary; it is never included in the public apply plan. */
export interface SettingPlanContext {
  readonly batchKey: object;
  readonly signal: AbortSignal;
}

export interface SettingsOperationContext {
  /** Apply adapters should stop before mutation when possible. The registry
   * still compensates any success reported after cancellation. */
  readonly signal: AbortSignal;
}

export interface SettingDefinition<T extends SettingValue = SettingValue> {
  readonly id: string;
  readonly section: string;
  readonly label: string;
  readonly description: string;
  readonly valueType: SettingValueType;
  readonly scopes: readonly SettingScope[];
  readonly sensitive?: boolean;
  readonly requiresRestart?: boolean;
  readonly confirmation?: ConfirmationResolver<T>;
  read(context?: SettingsOperationContext): Promise<SettingReadResult>;
  validate(value: unknown): ValidationResult<T>;
  /** Planning must be read-only. Mutation belongs exclusively to apply(). */
  plan(change: SettingChange<T>, context: SettingPlanContext): Promise<unknown>;
  apply(plan: unknown, context?: SettingsOperationContext): Promise<AdapterApplyResult>;
  rollback?(receipt: AdapterApplyReceipt, context?: SettingsOperationContext): Promise<void>;
  doctor?(context?: SettingsOperationContext): Promise<SettingHealth>;
}

export interface SettingsSnapshot {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  readonly settings: Readonly<Record<string, EffectiveSetting>>;
  /** Unregistered document entries survive reads, previews, and redacted exports. */
  readonly unknownSettings: Readonly<Record<string, unknown>>;
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface SettingsRegistryOptions {
  readonly unknownSettings?: Readonly<Record<string, unknown>>;
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly now?: () => string;
  /** One total bound for a snapshot or staged-plan construction. */
  readonly operationTimeoutMs?: number;
  /** Injectable scheduler keeps timeout behavior deterministic in tests. */
  readonly operationTimer?: SettingsOperationTimer;
}

export interface SettingsOperationTimer {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

/** Renderer-safe metadata. Adapter implementation details and secret values
 * are intentionally absent. */
export interface SettingDescriptor {
  readonly id: string;
  readonly section: string;
  readonly label: string;
  readonly description: string;
  readonly valueType: SettingValueType;
  readonly sensitive: boolean;
  readonly requiresRestart: boolean;
  readonly scopes: readonly SettingScope[];
}

export interface SnapshotOptions {
  /** Runs adapter doctors. False leaves health explicitly unknown when read() has none. */
  readonly doctor?: boolean;
  readonly signal?: AbortSignal;
}

export interface SettingsPlanOptions {
  readonly signal?: AbortSignal;
}

export interface RedactedLayer {
  readonly state: "known" | "unknown";
  readonly scope: SettingScope;
  readonly source: string;
  readonly rank: number;
  readonly value?: unknown;
  readonly issues?: readonly ValidationIssue[];
}

export interface RedactedSetting {
  readonly section: string;
  readonly valueType: Exclude<SettingValueType, "secret_ref">;
  readonly state: "known" | "unknown" | "unset";
  readonly scope?: SettingScope;
  readonly source?: string;
  readonly value?: unknown;
  readonly issues?: readonly ValidationIssue[];
  readonly precedence: readonly RedactedLayer[];
  readonly health: SettingHealth;
}

export interface RedactedSettingsExport {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  readonly settings: Readonly<Record<string, RedactedSetting>>;
  /** IDs are useful for parity checks; their references and presence state are omitted. */
  readonly excludedSecretRefs: readonly string[];
  readonly unknownSettings: Readonly<Record<string, unknown>>;
  readonly extensions: Readonly<Record<string, unknown>>;
  readonly staged: readonly SettingsChangePreview[];
}

export interface SettingsChangePreview {
  readonly settingId: string;
  readonly section: string;
  readonly scope: WritableSettingScope;
  readonly operation: SettingOperation;
  readonly before: RedactedEffectiveValue;
  readonly after: RedactedEffectiveValue;
  readonly beforeAtScope: RedactedLayer | null;
  readonly afterAtScope: RedactedLayer | null;
  readonly requiresRestart: boolean;
  readonly confirmations: readonly RequiredConfirmation[];
}

export interface RedactedEffectiveValue {
  readonly state: "known" | "unknown" | "unset";
  readonly scope?: SettingScope;
  readonly source?: string;
  readonly value?: unknown;
  readonly issues?: readonly ValidationIssue[];
}

export type StageResult =
  | { readonly ok: true; readonly changed: false }
  | { readonly ok: true; readonly changed: true; readonly preview: SettingsChangePreview }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface PlannedSettingChange {
  readonly settingId: string;
  readonly section: string;
  readonly scope: WritableSettingScope;
  readonly operation: SettingOperation;
  readonly preview: SettingsChangePreview;
  readonly requiresRestart: boolean;
}

export interface SettingsApplyPlan {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  readonly planId: string;
  readonly changes: readonly PlannedSettingChange[];
  readonly confirmations: readonly RequiredConfirmation[];
  readonly requiresRestart: boolean;
}

export interface AppliedSettingReceipt {
  readonly settingId: string;
  readonly scope: WritableSettingScope;
  readonly summary?: string;
}

export interface RollbackOutcome {
  readonly settingId: string;
  readonly scope: WritableSettingScope;
  readonly status: "rolled_back" | "rollback_failed";
  readonly error?: string;
}

export type ApplyFailureKind =
  | "confirmation_required"
  | "invalid_plan"
  | "apply_failed"
  | "cancelled"
  | "compensation_failed";

export interface ApplyFailure {
  readonly kind: ApplyFailureKind;
  readonly message: string;
  readonly settingId?: string;
  readonly missingConfirmations?: readonly RequiredConfirmation[];
}

export interface SettingsBatchReceipt {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  readonly planId: string;
  readonly status: "applied" | "rejected" | "cancelled" | "rolled_back" | "compensation_failed";
  readonly completedAt: string;
  readonly applied: readonly AppliedSettingReceipt[];
  readonly rollbacks: readonly RollbackOutcome[];
  readonly requiresRestart: boolean;
  readonly failure?: ApplyFailure;
}

export interface ApplyOptions {
  /** Exact confirmation phrases presented by the plan. */
  readonly confirmations?: readonly string[];
  /** Cancels an in-flight apply. Known mutations are compensated before the
   * returned receipt settles. */
  readonly signal?: AbortSignal;
}

export type CancelReceipt =
  | {
      readonly status: "cancelled";
      readonly discardedChanges: number;
      readonly mutated: false;
    }
  | {
      readonly status: "cancelling";
      readonly discardedChanges: number;
      readonly mutated: "unknown";
    }
  | {
      readonly status: "settled";
      readonly discardedChanges: number;
      readonly mutated: true | "unknown";
      readonly applyStatus: "applied" | "compensation_failed";
    };

export interface SettingsCancellationReceipt {
  readonly cancellation: CancelReceipt;
  /** Present when apply had already started or had terminalized. */
  readonly apply: SettingsBatchReceipt | null;
}

interface AnyDefinition extends SettingDefinition<SettingValue> {}

interface InternalStagedChange {
  readonly definition: AnyDefinition;
  readonly change: SettingChange;
  readonly confirmations: readonly RequiredConfirmation[];
}

interface SuccessfulApply {
  readonly definition: AnyDefinition;
  readonly change: PlannedSettingChange;
  readonly receipt: AdapterApplyReceipt;
}

interface InternalPlannedSettingChange extends PlannedSettingChange {
  readonly adapterPlan: unknown;
}

interface IssuedPlan {
  readonly planId: string;
  readonly changes: readonly InternalPlannedSettingChange[];
  readonly confirmations: readonly RequiredConfirmation[];
  readonly requiresRestart: boolean;
}

interface TransactionHost {
  definition(id: string): AnyDefinition | undefined;
  issue(plan: SettingsApplyPlan, internal: IssuedPlan): void;
  revoke(plan: SettingsApplyPlan): void;
  apply(plan: SettingsApplyPlan, options?: ApplyOptions): Promise<SettingsBatchReceipt>;
  readonly operationTimeoutMs: number;
  readonly operationTimer: SettingsOperationTimer;
}

const UNKNOWN_HEALTH: SettingHealth = {
  state: "unknown",
  summary: "health not checked",
};

const DEFAULT_OPERATION_TIMER: SettingsOperationTimer = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

class SettingsOperationBoundaryError extends Error {
  readonly kind: "cancelled" | "timed_out";
  readonly timeoutMs?: number;

  constructor(kind: "cancelled" | "timed_out", message: string, timeoutMs?: number) {
    super(message);
    this.name = "SettingsOperationBoundaryError";
    this.kind = kind;
    if (timeoutMs !== undefined) this.timeoutMs = timeoutMs;
  }
}

interface SettingsOperationDeadline {
  readonly signal: AbortSignal;
  dispose(): void;
}

function boundedOperationTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_SETTINGS_OPERATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_SETTINGS_OPERATION_TIMEOUT_MS) {
    throw new TypeError(
      `settings operation timeout must be an integer from 1 to ${MAX_SETTINGS_OPERATION_TIMEOUT_MS} ms`,
    );
  }
  return timeout;
}

function operationDeadline(
  label: string,
  timeoutMs: number,
  timer: SettingsOperationTimer,
  parent?: AbortSignal,
): SettingsOperationDeadline {
  const controller = new AbortController();
  const onParentAbort = (): void => {
    controller.abort(new SettingsOperationBoundaryError("cancelled", `${label} was cancelled`));
  };
  let handle: unknown;
  let scheduled = false;
  let disposed = false;
  if (parent?.aborted) {
    onParentAbort();
  } else {
    parent?.addEventListener("abort", onParentAbort, { once: true });
    try {
      handle = timer.schedule(() => {
        controller.abort(new SettingsOperationBoundaryError(
          "timed_out",
          `${label} timed out after ${timeoutMs} ms`,
          timeoutMs,
        ));
      }, timeoutMs);
      scheduled = true;
    } catch (error) {
      parent?.removeEventListener("abort", onParentAbort);
      throw error;
    }
  }
  return {
    signal: controller.signal,
    dispose() {
      if (disposed) return;
      disposed = true;
      parent?.removeEventListener("abort", onParentAbort);
      if (scheduled) {
        try { timer.cancel(handle); } catch { /* cleanup must not replace the operation result */ }
      }
    },
  };
}

function boundaryError(signal: AbortSignal): SettingsOperationBoundaryError {
  return signal.reason instanceof SettingsOperationBoundaryError
    ? signal.reason
    : new SettingsOperationBoundaryError("cancelled", "settings operation was cancelled");
}

/** Race read-only adapter work against its operation signal. Late settlement
 * stays observed to avoid unhandled rejections, but cannot mutate registry
 * state after this promise has terminalized. JavaScript cannot preempt a
 * blocking or signal-ignoring adapter, so the trusted adapter contract still
 * requires read/doctor/plan to be side-effect free and to release resources
 * when signalled. Mutation-bearing apply/rollback uses the stricter wait-for-
 * compensation boundary instead of this helper. */
function awaitReadOnlyOperation<T>(signal: AbortSignal, start: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    const succeed = (value: T): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = (): void => fail(boundaryError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      Promise.resolve(start()).then(succeed, fail);
    } catch (error) {
      fail(error);
    }
  });
}

function boundarySummary(error: unknown, fallback: string): string {
  return error instanceof SettingsOperationBoundaryError ? error.message : fallback;
}

const READ_ONLY_SCOPE = new Set<SettingScope>(["default", "env", "server_policy"]);
const WRITABLE_SCOPE = new Set<SettingScope>(WRITABLE_SETTING_SCOPES);
const OPAQUE_SECRET_VALUE = /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[opusr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,}|npm_[A-Za-z0-9]{8,}|pypi-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/gi;

function redactSettingsText(value: string): string {
  return redactForBundle(value, {}).replace(OPAQUE_SECRET_VALUE, "[REDACTED]");
}

function issue(code: string, message: string): ValidationIssue {
  return { code, message };
}

function validationFailure(code: string, message: string): ValidationResult<never> {
  return { ok: false, issues: [issue(code, message)] };
}

export function booleanValidator(value: unknown): ValidationResult<boolean> {
  return typeof value === "boolean"
    ? { ok: true, value }
    : validationFailure("type.boolean", "expected a boolean");
}

export function finiteNumberValidator(value: unknown): ValidationResult<number> {
  return typeof value === "number" && Number.isFinite(value)
    ? { ok: true, value }
    : validationFailure("type.number", "expected a finite number");
}

export function stringValidator(value: unknown): ValidationResult<string> {
  return typeof value === "string"
    ? { ok: true, value }
    : validationFailure("type.string", "expected a string");
}

export function pathValidator(value: unknown): ValidationResult<string> {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("\0")
    ? { ok: true, value }
    : validationFailure("type.path", "expected a non-empty path without NUL bytes");
}

export function enumValidator<const T extends string>(
  choices: readonly T[],
): (value: unknown) => ValidationResult<T> {
  const allowed = new Set<string>(choices);
  return (value: unknown): ValidationResult<T> =>
    typeof value === "string" && allowed.has(value)
      ? { ok: true, value: value as T }
      : {
          ok: false,
          issues: [issue("type.enum", `expected one of: ${choices.join(", ")}`)],
        };
}

export function secretReference(provider: string, name: string): SecretReference {
  const candidate: SecretReference = { kind: "secret_ref", provider, name };
  const validated = secretReferenceValidator(candidate);
  if (!validated.ok) throw new TypeError(validated.issues.map((item) => item.message).join("; "));
  return validated.value;
}

export function secretReferenceValidator(value: unknown): ValidationResult<SecretReference> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return validationFailure("type.secret_ref", "expected a secret reference, never raw secret material");
  }
  const record = value as Record<string, unknown>;
  const provider = record["provider"];
  const name = record["name"];
  if (record["kind"] !== "secret_ref" || typeof provider !== "string" || typeof name !== "string") {
    return validationFailure("type.secret_ref", "expected { kind: 'secret_ref', provider, name }");
  }
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(provider)) {
    return validationFailure("secret_ref.provider", "secret reference provider is invalid");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,255}$/.test(name)) {
    return validationFailure("secret_ref.name", "secret reference name is invalid");
  }
  return { ok: true, value: { kind: "secret_ref", provider, name } };
}

function valueMatchesType(valueType: SettingValueType, value: SettingValue): boolean {
  switch (valueType) {
    case "boolean": return typeof value === "boolean";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "string":
    case "enum":
    case "path": return typeof value === "string";
    case "secret_ref": return secretReferenceValidator(value).ok;
  }
}

function validateWithDefinition(
  definition: AnyDefinition,
  rawValue: unknown,
): ValidationResult<SettingValue> {
  let validated: ValidationResult<SettingValue>;
  try {
    validated = definition.validate(rawValue);
  } catch {
    return validationFailure("validator.threw", "setting validator failed");
  }
  if (!validated.ok) return validated;
  if (!valueMatchesType(definition.valueType, validated.value)) {
    return validationFailure(
      "validator.type_mismatch",
      `validator returned a value incompatible with ${definition.valueType}`,
    );
  }
  const unsafe = unsafeSettingValueReason(definition.id, validated.value);
  if (unsafe) {
    return validationFailure(
      "value.secret_material",
      `${definition.id} rejected: ${unsafe}; use a secret_ref or the owning credential flow`,
    );
  }
  return validated;
}

function unsafeSettingValueReason(id: string, value: SettingValue): string | null {
  if (typeof value === "object") return null; // validated structural secret_ref
  if (typeof value !== "string") return null;
  if (SENSITIVE_KEY.test(id)) return "raw values are forbidden for credential-named settings";
  OPAQUE_SECRET_VALUE.lastIndex = 0;
  const opaque = OPAQUE_SECRET_VALUE.test(value);
  OPAQUE_SECRET_VALUE.lastIndex = 0;
  if (opaque || scanForSecrets(value).length > 0) return "credential-shaped value";
  try {
    const url = new URL(value);
    if (url.username || url.password) return "URL embeds credentials";
    for (const name of url.searchParams.keys()) {
      if (SENSITIVE_KEY.test(name)) return "URL contains a credential query parameter";
    }
  } catch {
    // Ordinary strings are not URLs.
  }
  return null;
}

function scopeRank(scope: SettingScope): number {
  return SETTING_SCOPE_PRECEDENCE.indexOf(scope);
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolveSetting(
  definition: AnyDefinition,
  read: SettingReadResult,
  health: SettingHealth = read.health ?? UNKNOWN_HEALTH,
): EffectiveSetting {
  const grouped = new Map<SettingScope, SettingLayer[]>();
  for (const layer of read.layers) {
    const existing = grouped.get(layer.scope) ?? [];
    existing.push(layer);
    grouped.set(layer.scope, existing);
  }

  const precedence: EffectiveLayer[] = [];
  for (const scope of SETTING_SCOPE_PRECEDENCE) {
    const candidates = grouped.get(scope);
    if (!candidates?.length) continue;
    if (candidates.length > 1) {
      const ordered = [...candidates].sort((left, right) => stableCompare(left.source, right.source));
      precedence.push({
        state: "unknown",
        scope,
        source: ordered.map((candidate) => candidate.source).join(", "),
        rank: scopeRank(scope),
        rawValue: ordered.map((candidate) => ({ source: candidate.source, value: candidate.value })),
        issues: [issue("scope.duplicate", `multiple ${scope} values have equal precedence`)],
      });
      continue;
    }

    const candidate = candidates[0];
    if (!candidate) continue;
    if (!definition.scopes.includes(scope)) {
      precedence.push({
        state: "unknown",
        scope,
        source: candidate.source,
        rank: scopeRank(scope),
        rawValue: candidate.value,
        issues: [issue("scope.unsupported", `${definition.id} does not declare ${scope} scope`)],
      });
      continue;
    }
    const validated = validateWithDefinition(definition, candidate.value);
    if (validated.ok) {
      precedence.push({
        state: "known",
        scope,
        source: candidate.source,
        rank: scopeRank(scope),
        value: validated.value,
      });
    } else {
      precedence.push({
        state: "unknown",
        scope,
        source: candidate.source,
        rank: scopeRank(scope),
        rawValue: candidate.value,
        issues: validated.issues,
      });
    }
  }
  precedence.sort((left, right) => right.rank - left.rank);

  const base = {
    id: definition.id,
    section: definition.section,
    valueType: definition.valueType,
    precedence,
    health,
    extensions: read.extensions ?? {},
  };
  const effective = precedence[0];
  if (!effective) return { ...base, state: "unset" };
  if (effective.state === "known") {
    return {
      ...base,
      state: "known",
      value: effective.value,
      scope: effective.scope,
      source: effective.source,
    };
  }
  return {
    ...base,
    state: "unknown",
    rawValue: effective.rawValue,
    scope: effective.scope,
    source: effective.source,
    issues: effective.issues,
  };
}

function readResultFromEffective(setting: EffectiveSetting): SettingReadResult {
  return {
    layers: setting.precedence.map((layer): SettingLayer => ({
      scope: layer.scope,
      source: layer.source,
      value: layer.state === "known" ? layer.value : layer.rawValue,
    })),
    health: setting.health,
    extensions: setting.extensions,
  };
}

function replaceLayer(
  setting: EffectiveSetting,
  scope: WritableSettingScope,
  value: SettingValue | undefined,
): SettingReadResult {
  const layers = readResultFromEffective(setting).layers.filter((layer) => layer.scope !== scope);
  if (value !== undefined) {
    layers.push({ scope, source: `${scope}:staged`, value });
  }
  return {
    layers,
    health: setting.health,
    extensions: setting.extensions,
  };
}

function layerAt(setting: EffectiveSetting, scope: SettingScope): EffectiveLayer | undefined {
  return setting.precedence.find((layer) => layer.scope === scope);
}

function confirmationsFor(
  definition: AnyDefinition,
  change: SettingChange,
): readonly RequiredConfirmation[] {
  if (!definition.confirmation) return [];
  const resolved = typeof definition.confirmation === "function"
    ? definition.confirmation(change)
    : definition.confirmation;
  if (!resolved) return [];
  const values = Array.isArray(resolved) ? resolved : [resolved];
  const confirmations = values.map((entry) => ({ ...entry, settingId: definition.id }));
  for (const confirmation of confirmations) {
    if (!confirmation.phrase.trim() || !confirmation.reason.trim()) {
      throw new TypeError(`setting ${definition.id} has incomplete confirmation metadata`);
    }
  }
  return Object.freeze(confirmations.map((confirmation) => Object.freeze({ ...confirmation })));
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "setting operation failed";
  return redactSettingsText(message);
}

function redactUnknown(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (/^secret_?ref$/i.test(key)) return undefined;
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactSettingsText(value);
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value === "object"
    && !Array.isArray(value)
    && (value as Record<string, unknown>)["kind"] === "secret_ref"
  ) {
    return "[SECRET_REFERENCE]";
  }
  if (typeof value === "object" && seen.has(value)) return "[CIRCULAR]";
  if (Array.isArray(value)) {
    seen.add(value);
    const output = value.map((item) => redactUnknown(item, "", seen)).filter((item) => item !== undefined);
    seen.delete(value);
    return output;
  }
  if (typeof value !== "object") return String(value);
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const name of Object.keys(value as Record<string, unknown>).sort()) {
    const redacted = redactUnknown((value as Record<string, unknown>)[name], name, seen);
    if (redacted !== undefined) output[name] = redacted;
  }
  seen.delete(value);
  return output;
}

function redactIssues(issues: readonly ValidationIssue[]): readonly ValidationIssue[] {
  return issues.map((entry) => ({
    code: redactSettingsText(entry.code),
    message: redactSettingsText(entry.message),
  }));
}

function redactLayer(definition: AnyDefinition, layer: EffectiveLayer | undefined): RedactedLayer | null {
  if (!layer) return null;
  const base = {
    state: layer.state,
    scope: layer.scope,
    source: redactSettingsText(layer.source),
    rank: layer.rank,
  } as const;
  if (layer.state === "unknown") {
    const value = redactedSettingValue(definition, layer.rawValue);
    return {
      ...base,
      ...(value === undefined ? {} : { value }),
      issues: redactIssues(layer.issues),
    };
  }
  const value = redactedSettingValue(definition, layer.value);
  return {
    ...base,
    ...(value === undefined ? {} : { value }),
  };
}

function redactEffective(definition: AnyDefinition, setting: EffectiveSetting): RedactedEffectiveValue {
  if (setting.state === "unset") return { state: "unset" };
  if (setting.state === "unknown") {
    const value = redactedSettingValue(definition, setting.rawValue);
    return {
      state: "unknown",
      scope: setting.scope,
      source: redactSettingsText(setting.source),
      ...(value === undefined ? {} : { value }),
      issues: redactIssues(setting.issues),
    };
  }
  const value = redactedSettingValue(definition, setting.value);
  return {
    state: "known",
    scope: setting.scope,
    source: redactSettingsText(setting.source),
    ...(value === undefined ? {} : { value }),
  };
}

function redactConfirmation(confirmation: RequiredConfirmation): RequiredConfirmation {
  return {
    settingId: confirmation.settingId,
    impact: confirmation.impact,
    phrase: redactSettingsText(confirmation.phrase),
    reason: redactSettingsText(confirmation.reason),
    ...(confirmation.approvalFlag
      ? { approvalFlag: redactSettingsText(confirmation.approvalFlag) }
      : {}),
  };
}

function cloneFrozenConfirmations(
  confirmations: readonly RequiredConfirmation[],
  redact: boolean,
): readonly RequiredConfirmation[] {
  return Object.freeze(confirmations.map((confirmation) => Object.freeze(
    redact ? redactConfirmation(confirmation) : { ...confirmation },
  )));
}

/** Apply plans are capability objects keyed by identity. Runtime readonly must
 * match their TypeScript shape: callers cannot rewrite a phrase (or a nested
 * preview phrase) after it was shown and thereby influence later behavior. */
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function redactedSettingValue(definition: AnyDefinition, value: unknown): unknown {
  if (definition.valueType === "secret_ref") return undefined;
  return definition.sensitive ? "[REDACTED]" : redactUnknown(value);
}

function previewFor(staged: InternalStagedChange): SettingsChangePreview {
  const { definition, change } = staged;
  return {
    settingId: definition.id,
    section: definition.section,
    scope: change.scope,
    operation: change.operation,
    before: redactEffective(definition, change.before),
    after: redactEffective(definition, change.after),
    beforeAtScope: redactLayer(definition, change.beforeAtScope),
    afterAtScope: redactLayer(definition, change.afterAtScope),
    requiresRestart: definition.requiresRestart ?? false,
    confirmations: staged.confirmations.map(redactConfirmation),
  };
}

function stableCanonical(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") throw new TypeError("bigint is not a JSON setting value");
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (typeof value === "object" && seen.has(value)) {
    throw new TypeError("cannot serialize cyclic settings data");
  }
  if (Array.isArray(value)) {
    seen.add(value);
    const result = value.map((item) => stableCanonical(item, seen) ?? null);
    seen.delete(value);
    return result;
  }
  if (typeof value !== "object") return String(value);
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const canonical = stableCanonical((value as Record<string, unknown>)[key], seen);
    if (canonical !== undefined) result[key] = canonical;
  }
  seen.delete(value);
  return result;
}

/** JSON with recursively sorted object keys. Arrays retain semantic order. */
export function stableJsonStringify(value: unknown, space = 2): string {
  return JSON.stringify(stableCanonical(value), null, space);
}

/** Recursively redact arbitrary settings-facing diagnostics before they enter
 * JSON, terminal output, or an evidence artifact. */
export function redactSettingsArtifact(value: unknown): unknown {
  return redactUnknown(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableJsonStringify(left, 0) === stableJsonStringify(right, 0);
}

function planFingerprint(changes: readonly InternalStagedChange[]): string {
  // Fingerprint only the complete, redacted public semantics. Opaque adapter
  // payloads remain bound to the issued object identity and never enter logs.
  const material = changes.map(previewFor);
  return createHash("sha256").update(stableJsonStringify(material, 0)).digest("hex").slice(0, 20);
}

function validateDefinition(definition: AnyDefinition): void {
  if (!definition.id.trim()) throw new TypeError("setting id must not be empty");
  if (!definition.section.trim()) throw new TypeError(`setting ${definition.id} section must not be empty`);
  if (!definition.label.trim()) throw new TypeError(`setting ${definition.id} label must not be empty`);
  if (!definition.description.trim()) throw new TypeError(`setting ${definition.id} description must not be empty`);
  if (definition.scopes.length === 0) throw new TypeError(`setting ${definition.id} must declare a scope`);
  if (new Set(definition.scopes).size !== definition.scopes.length) {
    throw new TypeError(`setting ${definition.id} declares a duplicate scope`);
  }
}

export class SettingsRegistry {
  readonly #definitions = new Map<string, AnyDefinition>();
  readonly #issuedPlans = new WeakMap<object, IssuedPlan>();
  readonly #consumedPlans = new WeakSet<object>();
  readonly #unknownSettings: Readonly<Record<string, unknown>>;
  readonly #extensions: Readonly<Record<string, unknown>>;
  readonly #now: () => string;
  readonly #operationTimeoutMs: number;
  readonly #operationTimer: SettingsOperationTimer;

  constructor(options: SettingsRegistryOptions = {}) {
    this.#unknownSettings = options.unknownSettings ?? {};
    this.#extensions = options.extensions ?? {};
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#operationTimeoutMs = boundedOperationTimeout(options.operationTimeoutMs);
    this.#operationTimer = options.operationTimer ?? DEFAULT_OPERATION_TIMER;
  }

  register<T extends SettingValue>(definition: SettingDefinition<T>): this {
    const erased = definition as unknown as AnyDefinition;
    validateDefinition(erased);
    if (this.#definitions.has(definition.id)) {
      throw new TypeError(`duplicate setting id: ${definition.id}`);
    }
    this.#definitions.set(definition.id, erased);
    return this;
  }

  ids(): readonly string[] {
    return [...this.#definitions.keys()].sort();
  }

  descriptors(): readonly SettingDescriptor[] {
    return this.ids().flatMap((id) => {
      const definition = this.#definitions.get(id);
      if (!definition) return [];
      return [{
        id: definition.id,
        section: redactSettingsText(definition.section),
        label: redactSettingsText(definition.label),
        description: redactSettingsText(definition.description),
        valueType: definition.valueType,
        sensitive: definition.sensitive === true || definition.valueType === "secret_ref",
        requiresRestart: definition.requiresRestart === true,
        scopes: [...definition.scopes],
      }];
    });
  }

  async snapshot(options: SnapshotOptions = {}): Promise<SettingsSnapshot> {
    const settings: Record<string, EffectiveSetting> = {};
    const deadline = operationDeadline(
      "settings snapshot",
      this.#operationTimeoutMs,
      this.#operationTimer,
      options.signal,
    );
    try {
      for (const id of this.ids()) {
        const definition = this.#definitions.get(id);
        if (!definition) continue;
        let read: SettingReadResult;
        try {
          read = await awaitReadOnlyOperation(
            deadline.signal,
            () => definition.read({ signal: deadline.signal }),
          );
        } catch (error) {
          if (error instanceof SettingsOperationBoundaryError && error.kind === "cancelled") throw error;
          settings[id] = resolveSetting(definition, { layers: [] }, {
            state: "unavailable",
            summary: boundarySummary(error, "setting read failed"),
          });
          continue;
        }

        let health = read.health ?? UNKNOWN_HEALTH;
        if (options.doctor && definition.doctor) {
          try {
            health = await awaitReadOnlyOperation(
              deadline.signal,
              () => definition.doctor?.({ signal: deadline.signal }) as Promise<SettingHealth>,
            );
          } catch (error) {
            if (error instanceof SettingsOperationBoundaryError && error.kind === "cancelled") throw error;
            health = {
              state: "unavailable",
              summary: boundarySummary(error, "setting doctor failed"),
            };
          }
        }
        settings[id] = resolveSetting(definition, read, health);
      }
    } finally {
      deadline.dispose();
    }
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings,
      unknownSettings: this.#unknownSettings,
      extensions: this.#extensions,
    };
  }

  async begin(options: SnapshotOptions = {}): Promise<SettingsTransaction> {
    const snapshot = await this.snapshot(options);
    const host: TransactionHost = {
      definition: (id) => this.#definitions.get(id),
      issue: (plan, internal) => this.#issuedPlans.set(plan as object, internal),
      revoke: (plan) => {
        this.#issuedPlans.delete(plan as object);
        this.#consumedPlans.add(plan as object);
      },
      apply: async (plan, applyOptions) => this.apply(plan, applyOptions),
      operationTimeoutMs: this.#operationTimeoutMs,
      operationTimer: this.#operationTimer,
    };
    return new SettingsTransaction(host, snapshot);
  }

  async apply(plan: SettingsApplyPlan, options: ApplyOptions = {}): Promise<SettingsBatchReceipt> {
    const issued = this.#issuedPlans.get(plan as object);
    const baseReceipt = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      planId: issued?.planId ?? plan.planId,
      applied: [] as AppliedSettingReceipt[],
      rollbacks: [] as RollbackOutcome[],
      requiresRestart: issued?.requiresRestart ?? false,
    } as const;
    const completeReceipt = () => ({ ...baseReceipt, completedAt: this.#now() });

    if (!issued || this.#consumedPlans.has(plan as object)) {
      return {
        ...completeReceipt(),
        status: "rejected",
        failure: { kind: "invalid_plan", message: "plan is foreign or already consumed" },
      };
    }

    const approved = new Set(options.confirmations ?? []);
    const missing = issued.confirmations.filter((confirmation) => !approved.has(confirmation.phrase));
    if (missing.length > 0) {
      return {
        ...completeReceipt(),
        status: "rejected",
        failure: {
          kind: "confirmation_required",
          message: "explicit confirmation is required before settings can be applied",
          missingConfirmations: missing.map(redactConfirmation),
        },
      };
    }

    this.#consumedPlans.add(plan as object);
    const applySignal = options.signal ?? new AbortController().signal;
    if (applySignal.aborted) {
      return {
        ...completeReceipt(),
        status: "cancelled",
        failure: { kind: "cancelled", message: "settings apply was cancelled before mutation" },
      };
    }
    const successful: SuccessfulApply[] = [];
    let failedChange: PlannedSettingChange | undefined;
    let failedDefinition: AnyDefinition | undefined;
    let failureMessage = "setting apply failed";
    let failingCompensation: AdapterApplyReceipt | undefined;
    let applyThrew = false;
    let cancelled = false;

    for (const change of issued.changes) {
      if (applySignal.aborted) {
        cancelled = true;
        failedChange = change;
        failureMessage = "settings apply was cancelled before the next mutation";
        break;
      }
      const definition = this.#definitions.get(change.settingId);
      if (!definition) {
        failedChange = change;
        failureMessage = `setting disappeared after planning: ${change.settingId}`;
        break;
      }
      failedDefinition = definition;
      try {
        const result = await definition.apply(change.adapterPlan, { signal: applySignal });
        if (!result.ok) {
          failedChange = change;
          cancelled = applySignal.aborted;
          failureMessage = cancelled
            ? "settings apply was cancelled while the adapter was running"
            : redactSettingsText(result.error);
          failingCompensation = result.compensationReceipt;
          break;
        }
        successful.push({ definition, change, receipt: result.receipt });
        if (applySignal.aborted) {
          cancelled = true;
          failedChange = change;
          failureMessage = "settings apply was cancelled; compensating the completed mutation";
          break;
        }
      } catch (error) {
        failedChange = change;
        failureMessage = safeError(error);
        applyThrew = true;
        cancelled = applySignal.aborted;
        break;
      }
      failedDefinition = undefined;
    }

    if (!failedChange) {
      return {
        ...completeReceipt(),
        status: "applied",
        applied: successful.map(({ change, receipt }) => ({
          settingId: change.settingId,
          scope: change.scope,
          ...(receipt.summary ? { summary: redactSettingsText(receipt.summary) } : {}),
        })),
      };
    }

    const rollbackQueue: SuccessfulApply[] = [...successful].reverse();
    if (failingCompensation && failedDefinition) {
      rollbackQueue.unshift({
        definition: failedDefinition,
        change: failedChange,
        receipt: failingCompensation,
      });
    }

    const rollbacks: RollbackOutcome[] = applyThrew && failedDefinition
      ? [{
          settingId: failedChange.settingId,
          scope: failedChange.scope,
          status: "rollback_failed",
          error: "adapter threw; mutation state is unknown",
        }]
      : [];
    for (const entry of rollbackQueue) {
      if (!entry.definition.rollback) {
        rollbacks.push({
          settingId: entry.change.settingId,
          scope: entry.change.scope,
          status: "rollback_failed",
          error: "adapter does not provide rollback",
        });
        continue;
      }
      try {
        await entry.definition.rollback(entry.receipt, { signal: new AbortController().signal });
        rollbacks.push({
          settingId: entry.change.settingId,
          scope: entry.change.scope,
          status: "rolled_back",
        });
      } catch (error) {
        rollbacks.push({
          settingId: entry.change.settingId,
          scope: entry.change.scope,
          status: "rollback_failed",
          error: safeError(error),
        });
      }
    }

    const compensationFailed = rollbacks.some((rollback) => rollback.status === "rollback_failed");
    return {
      ...completeReceipt(),
      status: compensationFailed ? "compensation_failed" : cancelled ? "cancelled" : "rolled_back",
      applied: successful.map(({ change, receipt }) => ({
        settingId: change.settingId,
        scope: change.scope,
        ...(receipt.summary ? { summary: redactSettingsText(receipt.summary) } : {}),
      })),
      rollbacks,
      failure: {
        kind: compensationFailed ? "compensation_failed" : cancelled ? "cancelled" : "apply_failed",
        message: compensationFailed && cancelled
          ? "settings cancellation could not prove that every mutation was compensated"
          : failureMessage,
        settingId: failedChange.settingId,
      },
    };
  }
}

export class SettingsTransaction {
  readonly #host: TransactionHost;
  readonly #snapshot: SettingsSnapshot;
  readonly #staged = new Map<string, InternalStagedChange>();
  readonly #issuedPlans = new Set<SettingsApplyPlan>();
  #revision = 0;
  #activePlanning?: {
    readonly controller: AbortController;
    readonly promise: Promise<SettingsApplyPlan>;
  };
  #activeApply?: {
    readonly controller: AbortController;
    readonly promise: Promise<SettingsBatchReceipt>;
  };
  #lastApplyReceipt?: SettingsBatchReceipt;

  constructor(host: TransactionHost, snapshot: SettingsSnapshot) {
    this.#host = host;
    this.#snapshot = snapshot;
  }

  get snapshot(): SettingsSnapshot {
    return this.#snapshot;
  }

  stage(id: string, scope: SettingScope, rawValue: unknown): StageResult {
    const definition = this.#host.definition(id);
    if (!definition) {
      return { ok: false, issues: [issue("setting.unknown", `unknown setting: ${id}`)] };
    }
    const scopeIssue = this.#validateWritableScope(definition, scope);
    if (scopeIssue) return { ok: false, issues: [scopeIssue] };
    const validated = validateWithDefinition(definition, rawValue);
    if (!validated.ok) return validated;
    return this.#store(definition, scope as WritableSettingScope, "set", validated.value);
  }

  unset(id: string, scope: SettingScope): StageResult {
    const definition = this.#host.definition(id);
    if (!definition) {
      return { ok: false, issues: [issue("setting.unknown", `unknown setting: ${id}`)] };
    }
    const scopeIssue = this.#validateWritableScope(definition, scope);
    if (scopeIssue) return { ok: false, issues: [scopeIssue] };
    return this.#store(definition, scope as WritableSettingScope, "unset", undefined);
  }

  preview(): readonly SettingsChangePreview[] {
    return this.#orderedStaged().map(previewFor);
  }

  cancel(): CancelReceipt {
    const discardedChanges = this.#staged.size;
    this.#revision += 1;
    this.#activePlanning?.controller.abort(new Error("settings transaction cancelled"));
    this.#revokeIssued();
    this.#staged.clear();
    if (this.#activeApply) {
      this.#activeApply.controller.abort(new Error("settings transaction cancelled"));
      return { status: "cancelling", discardedChanges, mutated: "unknown" };
    }
    if (this.#lastApplyReceipt?.status === "applied") {
      return {
        status: "settled",
        discardedChanges,
        mutated: true,
        applyStatus: "applied",
      };
    }
    if (this.#lastApplyReceipt?.status === "compensation_failed") {
      return {
        status: "settled",
        discardedChanges,
        mutated: "unknown",
        applyStatus: "compensation_failed",
      };
    }
    return { status: "cancelled", discardedChanges, mutated: false };
  }

  /** Abort mutation and wait until the registry has either compensated it or
   * returned an explicitly truthful terminal receipt. */
  async cancelAndWait(): Promise<SettingsCancellationReceipt> {
    const cancellation = this.cancel();
    const planning = this.#activePlanning?.promise;
    const applying = this.#activeApply?.promise;
    if (planning) {
      try { await planning; } catch { /* read-only planning was cancelled or timed out */ }
    }
    return {
      cancellation,
      apply: applying ? await applying : this.#lastApplyReceipt ?? null,
    };
  }

  createPlan(options: SettingsPlanOptions = {}): Promise<SettingsApplyPlan> {
    if (this.#activeApply) throw new Error("settings apply is already in progress");
    if (this.#activePlanning) throw new Error("settings planning is already in progress");
    const controller = new AbortController();
    const externalSignal = options.signal;
    const forwardAbort = (): void => controller.abort(new Error("settings planning cancelled"));
    if (externalSignal?.aborted) forwardAbort();
    else externalSignal?.addEventListener("abort", forwardAbort, { once: true });
    const deadline = operationDeadline(
      "settings planning",
      this.#host.operationTimeoutMs,
      this.#host.operationTimer,
      controller.signal,
    );
    let operation!: Promise<SettingsApplyPlan>;
    operation = (async () => {
      try {
        return await this.#createPlanWithin(deadline.signal);
      } finally {
        deadline.dispose();
        externalSignal?.removeEventListener("abort", forwardAbort);
        if (this.#activePlanning?.promise === operation) this.#activePlanning = undefined;
      }
    })();
    this.#activePlanning = { controller, promise: operation };
    return operation;
  }

  async #createPlanWithin(signal: AbortSignal): Promise<SettingsApplyPlan> {
    if (signal.aborted) throw boundaryError(signal);
    this.#revokeIssued();
    const revision = this.#revision;
    const staged = this.#orderedStaged();
    if (staged.length > 1) {
      const irreversible = staged.find((entry) => !entry.definition.rollback);
      if (irreversible) {
        throw new Error(
          `atomic multi-setting plan requires rollback support: ${irreversible.definition.id}`,
        );
      }
    }

    const confirmations = staged
      .flatMap((entry) => entry.confirmations)
      .sort((left, right) =>
        stableCompare(
          `${left.settingId}\0${left.impact}\0${left.phrase}`,
          `${right.settingId}\0${right.impact}\0${right.phrase}`,
        ));
    if (new Set(confirmations.map((entry) => entry.phrase)).size !== confirmations.length) {
      throw new Error("confirmation phrases must be unique within a plan");
    }

    const planContext: SettingPlanContext = Object.freeze({
      batchKey: Object.freeze({}),
      signal,
    });
    const internalChanges: InternalPlannedSettingChange[] = [];
    for (const entry of staged) {
      let adapterPlan: unknown;
      try {
        adapterPlan = await awaitReadOnlyOperation(
          signal,
          () => entry.definition.plan(entry.change, planContext),
        );
      } catch (error) {
        if (revision !== this.#revision) throw new Error("settings planning was cancelled or changed");
        throw new Error(`could not plan ${entry.definition.id}: ${safeError(error)}`);
      }
      if (revision !== this.#revision) throw new Error("settings planning was cancelled or changed");
      internalChanges.push({
        settingId: entry.definition.id,
        section: entry.definition.section,
        scope: entry.change.scope,
        operation: entry.change.operation,
        preview: previewFor(entry),
        requiresRestart: entry.definition.requiresRestart ?? false,
        adapterPlan,
      });
    }

    const publicConfirmations = cloneFrozenConfirmations(confirmations, true);
    const internalConfirmations = cloneFrozenConfirmations(confirmations, false);
    const plan: SettingsApplyPlan = deepFreeze({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      planId: `settings-${planFingerprint(staged)}`,
      changes: internalChanges.map(({ adapterPlan: _adapterPlan, ...change }) => change),
      confirmations: publicConfirmations,
      requiresRestart: internalChanges.some((change) => change.requiresRestart),
    });
    if (revision !== this.#revision) throw new Error("settings planning was cancelled or changed");
    if (signal.aborted) throw boundaryError(signal);
    this.#host.issue(plan, {
      planId: plan.planId,
      changes: internalChanges,
      confirmations: internalConfirmations,
      requiresRestart: plan.requiresRestart,
    });
    this.#issuedPlans.add(plan);
    return plan;
  }

  async apply(options: ApplyOptions = {}): Promise<SettingsBatchReceipt> {
    const plan = await this.createPlan({ signal: options.signal });
    return this.applyPlan(plan, options);
  }

  /** Apply the exact issued object the caller previewed. This is distinct from
   * apply(), which is the one-shot convenience that creates its own plan. */
  applyPlan(plan: SettingsApplyPlan, options: ApplyOptions = {}): Promise<SettingsBatchReceipt> {
    if (this.#activeApply) throw new Error("settings apply is already in progress");
    const controller = new AbortController();
    const externalSignal = options.signal;
    const forwardAbort = (): void => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) forwardAbort();
    else externalSignal?.addEventListener("abort", forwardAbort, { once: true });

    let operation!: Promise<SettingsBatchReceipt>;
    operation = (async () => {
      try {
        const receipt = await this.#host.apply(plan, { ...options, signal: controller.signal });
        this.#lastApplyReceipt = receipt;
        if (receipt.status === "applied") {
          this.#staged.clear();
          this.#issuedPlans.clear();
        } else if (receipt.failure?.kind !== "confirmation_required") {
          this.#issuedPlans.delete(plan);
        }
        return receipt;
      } finally {
        externalSignal?.removeEventListener("abort", forwardAbort);
        if (this.#activeApply?.promise === operation) this.#activeApply = undefined;
      }
    })();
    this.#activeApply = { controller, promise: operation };
    return operation;
  }

  exportRedactedObject(): RedactedSettingsExport {
    const settings: Record<string, RedactedSetting> = {};
    const excludedSecretRefs: string[] = [];
    for (const id of Object.keys(this.#snapshot.settings).sort()) {
      const definition = this.#host.definition(id);
      const effective = this.#snapshot.settings[id];
      if (!definition || !effective) continue;
      if (definition.valueType === "secret_ref") {
        excludedSecretRefs.push(id);
        continue;
      }
      const redacted = redactEffective(definition, effective);
      settings[id] = {
        section: definition.section,
        valueType: definition.valueType,
        ...redacted,
        precedence: effective.precedence.map((layer) => redactLayer(definition, layer)).filter(
          (layer): layer is RedactedLayer => layer !== null,
        ),
        health: redactUnknown(effective.health) as SettingHealth,
      };
    }
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings,
      excludedSecretRefs,
      unknownSettings: redactUnknown(this.#snapshot.unknownSettings) as Readonly<Record<string, unknown>>,
      extensions: redactUnknown(this.#snapshot.extensions) as Readonly<Record<string, unknown>>,
      staged: this.preview(),
    };
  }

  exportRedacted(space = 2): string {
    return stableJsonStringify(this.exportRedactedObject(), space);
  }

  #validateWritableScope(definition: AnyDefinition, scope: SettingScope): ValidationIssue | undefined {
    if (READ_ONLY_SCOPE.has(scope)) {
      return issue("scope.read_only", `${scope} values are visible but cannot be overwritten locally`);
    }
    if (!WRITABLE_SCOPE.has(scope)) {
      return issue("scope.invalid", `unsupported writable scope: ${scope}`);
    }
    if (!definition.scopes.includes(scope)) {
      return issue("scope.unsupported", `${definition.id} does not support ${scope} scope`);
    }
    return undefined;
  }

  #store(
    definition: AnyDefinition,
    scope: WritableSettingScope,
    operation: SettingOperation,
    value: SettingValue | undefined,
  ): StageResult {
    const before = this.#snapshot.settings[definition.id];
    if (!before) {
      return { ok: false, issues: [issue("setting.unreadable", `setting is unavailable: ${definition.id}`)] };
    }
    const beforeAtScope = layerAt(before, scope);
    const isNoop = operation === "unset"
      ? beforeAtScope === undefined
      : beforeAtScope?.state === "known" && sameValue(beforeAtScope.value, value);
    this.#activePlanning?.controller.abort(new Error("settings staging changed"));
    if (isNoop) {
      this.#revision += 1;
      this.#lastApplyReceipt = undefined;
      this.#revokeIssued();
      this.#staged.delete(definition.id);
      return { ok: true, changed: false };
    }

    const after = resolveSetting(definition, replaceLayer(before, scope, value), before.health);
    const afterAtScope = layerAt(after, scope);
    const change: SettingChange = {
      settingId: definition.id,
      scope,
      operation,
      before,
      after,
      ...(beforeAtScope ? { beforeAtScope } : {}),
      ...(afterAtScope?.state === "known" ? { afterAtScope } : {}),
    };
    const staged: InternalStagedChange = {
      definition,
      change,
      confirmations: confirmationsFor(definition, change),
    };
    this.#revision += 1;
    this.#lastApplyReceipt = undefined;
    this.#revokeIssued();
    this.#staged.set(definition.id, staged);
    return { ok: true, changed: true, preview: previewFor(staged) };
  }

  #orderedStaged(): InternalStagedChange[] {
    return [...this.#staged.values()].sort((left, right) =>
      stableCompare(left.definition.id, right.definition.id),
    );
  }

  #revokeIssued(): void {
    for (const plan of this.#issuedPlans) this.#host.revoke(plan);
    this.#issuedPlans.clear();
  }
}

/** Serialize a plan without opaque adapter payloads or secret-reference values. */
export function settingsPlanToRedactedJson(plan: SettingsApplyPlan, space = 2): string {
  return stableJsonStringify(redactUnknown({
    schemaVersion: plan.schemaVersion,
    planId: plan.planId,
    changes: plan.changes,
    confirmations: plan.confirmations,
    requiresRestart: plan.requiresRestart,
  }), space);
}
