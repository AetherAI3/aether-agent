// Versioned, scoped persistence for settings that have no older domain-owned
// store. Existing config/MCP/skill stores remain authoritative for their data.

import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { scanForSecrets, SENSITIVE_KEY } from "./redaction.js";
import {
  readBoundedRegularFile,
  withSettingsFileLock,
} from "./settings_file_authority.js";
import {
  secretReferenceValidator,
  stableJsonStringify,
  type SecretReference,
  type SettingValue,
  type SettingValueType,
  type WritableSettingScope,
} from "./settings_registry.js";

export const SETTINGS_STORE_SCHEMA_VERSION = 1;
export const SETTINGS_STORE_MAX_BYTES = 1_048_576;

export interface SettingsStorePaths {
  readonly global: string;
  readonly project: string;
  readonly session: string;
}

export type SettingsStoreStatus =
  | "missing"
  | "ok"
  | "corrupt"
  | "unreadable"
  | "unsupported_version"
  | "unsafe"
  | "oversize";

export interface SettingsStoreInspection {
  readonly scope: WritableSettingScope;
  readonly path: string;
  readonly status: SettingsStoreStatus;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly unknownFields: Readonly<Record<string, unknown>>;
  readonly detail?: string;
  readonly schemaVersion?: number;
  /** Opaque process-scoped revision token used only for compare-and-swap. */
  readonly digest?: string;
}

export interface SettingsStorePlan {
  readonly schemaVersion: typeof SETTINGS_STORE_SCHEMA_VERSION;
  readonly scope: WritableSettingScope;
  readonly path: string;
  readonly operation: "set" | "unset";
  readonly settingId: string;
  readonly valueType: SettingValueType;
  readonly value?: SettingValue;
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly beforeValue?: unknown;
  readonly afterValue?: SettingValue;
  /** Present only on plans coalesced under one registry-issued batch key. */
  readonly batched?: true;
  /** Complete forward-compatible document retained privately by the adapter. */
  readonly document: Readonly<Record<string, unknown>>;
}

export interface SettingsStoreRollbackToken {
  readonly receiptId: string;
  readonly scope: WritableSettingScope;
  readonly path: string;
  readonly settingId: string;
  readonly operation: "set" | "unset";
  readonly previouslyExisted: boolean;
  readonly backupPath: string | null;
  readonly beforeDigest: string;
  readonly afterDigest: string;
}

export interface SettingsStoreApplyReceipt {
  readonly schemaVersion: typeof SETTINGS_STORE_SCHEMA_VERSION;
  readonly summary: string;
  readonly rollbackToken: SettingsStoreRollbackToken;
  /** Exactly one member performs the atomic write; later members acknowledge it. */
  readonly performedWrite: boolean;
}

export interface SettingsStoreRollbackReceipt {
  readonly status: "rolled_back";
  readonly receiptId: string;
  readonly restoredDigest: string;
}

export interface SettingsStoreOptions {
  /** Injected to make backup names and receipts deterministic in tests. */
  readonly nextId?: () => string;
}

interface SettingsStoreBatchMutation {
  readonly settingId: string;
  readonly operation: "set" | "unset";
  readonly valueType: SettingValueType;
  readonly value?: SettingValue;
}

interface SettingsStoreBatch {
  readonly scope: WritableSettingScope;
  readonly path: string;
  readonly beforeDigest: string;
  readonly previouslyExisted: boolean;
  readonly unknownFields: Readonly<Record<string, unknown>>;
  readonly settingIds: Set<string>;
  readonly plans: Set<SettingsStorePlan>;
  readonly mutations: SettingsStoreBatchMutation[];
  settings: Record<string, unknown>;
  afterDigest: string;
  sealed: boolean;
  receipt?: SettingsStoreApplyReceipt;
}

let receiptSequence = 0;
const SETTINGS_REVISION_KEY = randomBytes(32);

function defaultReceiptId(): string {
  receiptSequence += 1;
  return `${Date.now()}-${process.pid}-${receiptSequence}`;
}

function revisionDigest(value: string): string {
  return createHmac("sha256", SETTINGS_REVISION_KEY)
    .update("aether.settings.revision.v1\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSecretReference(value: unknown): value is SecretReference {
  if (!isRecord(value)) return false;
  const checked = secretReferenceValidator(value);
  if (!checked.ok) return false;
  const keys = Object.keys(value);
  return keys.length === 3 && keys.every((key) => key === "kind" || key === "provider" || key === "name");
}

function unsafeSecretReason(value: unknown, key = "", seen = new WeakSet<object>()): string | null {
  if (isSecretReference(value)) return null;
  if (typeof value === "string") {
    if (SENSITIVE_KEY.test(key)) return `raw secret value at ${key || "value"}`;
    if (scanForSecrets(value, {}).length > 0) return "credential-shaped string";
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
  if (value == null || typeof value === "boolean" || typeof value === "number") return null;
  if (typeof value !== "object") return null;
  if (seen.has(value)) return "cyclic value";
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const reason = unsafeSecretReason(item, key, seen);
      if (reason) return reason;
    }
  } else {
    for (const [name, item] of Object.entries(value)) {
      const reason = unsafeSecretReason(item, name, seen);
      if (reason) return reason;
    }
  }
  seen.delete(value);
  return null;
}

function assertSettingId(id: string): void {
  if (!id.trim() || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new TypeError("setting id must be a non-empty, bounded printable string");
  }
}

function normalizeStoredValue(id: string, valueType: SettingValueType, value: SettingValue): SettingValue {
  if (valueType === "secret_ref") {
    const checked = secretReferenceValidator(value);
    if (!checked.ok) throw new TypeError("secret settings accept references only, never raw values");
    if (!isSecretReference(value)) {
      throw new TypeError("secret references must contain only kind, provider, and name");
    }
    return checked.value;
  }
  if (typeof value === "object") {
    throw new TypeError(`${id} must be stored as a scalar ${valueType} value`);
  }
  const validType = valueType === "boolean"
    ? typeof value === "boolean"
    : valueType === "number"
      ? typeof value === "number" && Number.isFinite(value)
      : typeof value === "string";
  if (!validType) throw new TypeError(`${id} does not match declared ${valueType} type`);
  const reason = unsafeSecretReason(value, id);
  if (reason) throw new TypeError(`${id} rejected: ${reason}; store a secret_ref instead`);
  return value;
}

function sourceBytes(document: Readonly<Record<string, unknown>>): string {
  return stableJsonStringify(document) + "\n";
}

function boundedId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 96);
  if (!sanitized) throw new Error("settings receipt id is empty after sanitization");
  return sanitized;
}

function durableWrite(path: string, bytes: string, suffix: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${suffix}.tmp`;
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    created = true;
    writeFileSync(descriptor, bytes, { encoding: "utf8" });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    try {
      chmodSync(temporary, 0o600);
    } catch {
      // Windows ACLs are authoritative.
    }
    renameSync(temporary, path);
    try {
      const directory = openSync(parent, "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch {
      // Directory fsync is not supported on every Windows filesystem.
    }
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* preserve original failure */ }
    }
    try {
      if (created && existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

function removeDurably(path: string): void {
  unlinkSync(path);
  try {
    const directory = openSync(dirname(path), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } catch {
    // Directory fsync is best-effort where the platform does not expose it.
  }
}

export class VersionedSettingsStore {
  readonly #paths: SettingsStorePaths;
  readonly #nextId: () => string;
  readonly #rolledBack = new Set<string>();
  readonly #planningBatches = new WeakMap<object, Map<WritableSettingScope, SettingsStoreBatch>>();
  readonly #planBatches = new WeakMap<object, SettingsStoreBatch>();

  constructor(paths: SettingsStorePaths, options: SettingsStoreOptions = {}) {
    this.#paths = {
      global: resolve(paths.global),
      project: resolve(paths.project),
      session: resolve(paths.session),
    };
    this.#nextId = options.nextId ?? defaultReceiptId;
  }

  path(scope: WritableSettingScope): string {
    return this.#paths[scope];
  }

  inspect(scope: WritableSettingScope): SettingsStoreInspection {
    const path = this.path(scope);
    const read = readBoundedRegularFile(path, SETTINGS_STORE_MAX_BYTES);
    if (read.status === "missing") {
      return { scope, path, status: "missing", settings: {}, unknownFields: {} };
    }
    if (read.status !== "ok") {
      return {
        scope,
        path,
        status: read.status,
        settings: {},
        unknownFields: {},
        detail: read.detail,
      };
    }
    const bytes = read.bytes;
    let raw: unknown;
    try {
      raw = JSON.parse(bytes);
    } catch {
      return {
        scope,
        path,
        status: "corrupt",
        settings: {},
        unknownFields: {},
        detail: "settings file is not valid JSON",
        digest: revisionDigest(bytes),
      };
    }
    if (!isRecord(raw) || !isRecord(raw["settings"])) {
      return {
        scope,
        path,
        status: "corrupt",
        settings: {},
        unknownFields: {},
        detail: "settings file must contain an object-valued settings field",
        digest: revisionDigest(bytes),
      };
    }
    const version = raw["schema_version"];
    if (version !== SETTINGS_STORE_SCHEMA_VERSION) {
      return {
        scope,
        path,
        status: "unsupported_version",
        settings: {},
        unknownFields: {},
        detail: `settings schema ${String(version)} is not supported; expected ${SETTINGS_STORE_SCHEMA_VERSION}`,
        ...(typeof version === "number" ? { schemaVersion: version } : {}),
        digest: revisionDigest(bytes),
      };
    }
    const reason = unsafeSecretReason(raw);
    if (reason) {
      return {
        scope,
        path,
        status: "unsafe",
        settings: {},
        unknownFields: {},
        detail: `settings file contains ${reason}; replace raw credentials with secret_ref`,
        schemaVersion: SETTINGS_STORE_SCHEMA_VERSION,
        digest: revisionDigest(bytes),
      };
    }
    const unknownFields = Object.fromEntries(
      Object.entries(raw).filter(([key]) => key !== "schema_version" && key !== "settings"),
    );
    return {
      scope,
      path,
      status: "ok",
      settings: { ...(raw["settings"] as Record<string, unknown>) },
      unknownFields,
      schemaVersion: SETTINGS_STORE_SCHEMA_VERSION,
      digest: revisionDigest(bytes),
    };
  }

  read(id: string): { layers: Array<{ scope: WritableSettingScope; source: string; value: unknown }>; inspections: SettingsStoreInspection[] } {
    assertSettingId(id);
    const inspections = (["global", "project", "session"] as const).map((scope) => this.inspect(scope));
    const layers: Array<{ scope: WritableSettingScope; source: string; value: unknown }> = [];
    for (const inspection of inspections) {
      if (inspection.status !== "ok") continue;
      if (!Object.prototype.hasOwnProperty.call(inspection.settings, id)) continue;
      layers.push({ scope: inspection.scope, source: inspection.path, value: inspection.settings[id] });
    }
    return { layers, inspections };
  }

  plan(
    scope: WritableSettingScope,
    operation: "set" | "unset",
    settingId: string,
    valueType: SettingValueType,
    value?: SettingValue,
    batchKey?: object,
  ): SettingsStorePlan {
    if (batchKey) return this.#planBatched(batchKey, scope, operation, settingId, valueType, value);
    assertSettingId(settingId);
    let normalizedValue = value;
    if (operation === "set") {
      if (value === undefined) throw new TypeError("set operation requires a value");
      normalizedValue = normalizeStoredValue(settingId, valueType, value);
      if (typeof normalizedValue === "object") Object.freeze(normalizedValue);
    } else if (value !== undefined) {
      throw new TypeError("unset operation must not carry a value");
    }
    const inspection = this.inspect(scope);
    if (inspection.status !== "ok" && inspection.status !== "missing") {
      throw new Error(`${scope} settings are ${inspection.status}: ${inspection.detail ?? "repair required"}`);
    }
    const beforeDigest = inspection.digest ?? revisionDigest("");
    const settings = { ...inspection.settings };
    const hadBefore = Object.prototype.hasOwnProperty.call(settings, settingId);
    const beforeValue = settings[settingId];
    if (operation === "set") settings[settingId] = normalizedValue;
    else delete settings[settingId];
    const document: Record<string, unknown> = {
      ...inspection.unknownFields,
      schema_version: SETTINGS_STORE_SCHEMA_VERSION,
      settings,
    };
    const afterBytes = sourceBytes(document);
    return {
      schemaVersion: SETTINGS_STORE_SCHEMA_VERSION,
      scope,
      path: inspection.path,
      operation,
      settingId,
      valueType,
      ...(normalizedValue === undefined ? {} : { value: normalizedValue }),
      beforeDigest,
      afterDigest: revisionDigest(afterBytes),
      ...(hadBefore ? { beforeValue } : {}),
      ...(operation === "set" && normalizedValue !== undefined ? { afterValue: normalizedValue } : {}),
      document,
    };
  }

  #planBatched(
    batchKey: object,
    scope: WritableSettingScope,
    operation: "set" | "unset",
    settingId: string,
    valueType: SettingValueType,
    value?: SettingValue,
  ): SettingsStorePlan {
    assertSettingId(settingId);
    let normalizedValue = value;
    if (operation === "set") {
      if (value === undefined) throw new TypeError("set operation requires a value");
      normalizedValue = normalizeStoredValue(settingId, valueType, value);
      if (typeof normalizedValue === "object") Object.freeze(normalizedValue);
    } else if (value !== undefined) {
      throw new TypeError("unset operation must not carry a value");
    }

    let scopes = this.#planningBatches.get(batchKey);
    if (!scopes) {
      scopes = new Map();
      this.#planningBatches.set(batchKey, scopes);
    }
    let batch = scopes.get(scope);
    if (!batch) {
      const inspection = this.inspect(scope);
      if (inspection.status !== "ok" && inspection.status !== "missing") {
        throw new Error(`${scope} settings are ${inspection.status}: ${inspection.detail ?? "repair required"}`);
      }
      const baseSettings = { ...inspection.settings };
      batch = {
        scope,
        path: inspection.path,
        beforeDigest: inspection.digest ?? revisionDigest(""),
        previouslyExisted: inspection.status === "ok",
        unknownFields: { ...inspection.unknownFields },
        settingIds: new Set(),
        plans: new Set(),
        mutations: [],
        settings: { ...baseSettings },
        afterDigest: inspection.digest ?? revisionDigest(""),
        sealed: false,
      };
      scopes.set(scope, batch);
    }
    if (batch.sealed) throw new Error("settings batch was already sealed for apply");
    if (batch.settingIds.has(settingId)) throw new Error(`duplicate setting in scoped batch: ${settingId}`);

    const hadBefore = Object.prototype.hasOwnProperty.call(batch.settings, settingId);
    const beforeValue = batch.settings[settingId];
    if (operation === "set") batch.settings[settingId] = normalizedValue;
    else delete batch.settings[settingId];
    const document: Record<string, unknown> = {
      ...batch.unknownFields,
      schema_version: SETTINGS_STORE_SCHEMA_VERSION,
      settings: { ...batch.settings },
    };
    const afterDigest = revisionDigest(sourceBytes(document));
    const plan: SettingsStorePlan = Object.freeze({
      schemaVersion: SETTINGS_STORE_SCHEMA_VERSION,
      scope,
      path: batch.path,
      operation,
      settingId,
      valueType,
      ...(normalizedValue === undefined ? {} : { value: normalizedValue }),
      beforeDigest: batch.beforeDigest,
      afterDigest,
      ...(hadBefore ? { beforeValue } : {}),
      ...(operation === "set" && normalizedValue !== undefined ? { afterValue: normalizedValue } : {}),
      batched: true,
      document,
    });
    batch.settingIds.add(settingId);
    batch.mutations.push({
      settingId,
      operation,
      valueType,
      ...(normalizedValue === undefined ? {} : { value: normalizedValue }),
    });
    batch.afterDigest = afterDigest;
    batch.plans.add(plan);
    this.#planBatches.set(plan as object, batch);
    return plan;
  }

  apply(plan: SettingsStorePlan): SettingsStoreApplyReceipt {
    if (plan.schemaVersion !== SETTINGS_STORE_SCHEMA_VERSION) {
      throw new Error("unsupported settings plan schema");
    }
    if (this.path(plan.scope) !== resolve(plan.path)) {
      throw new Error("settings plan path does not match the configured scope");
    }
    if (plan.batched) {
      const batch = this.#planBatches.get(plan as object);
      if (!batch || !batch.plans.has(plan)) throw new Error("settings batch plan is foreign or was forged");
      return this.#applyBatch(batch);
    }
    const target = this.path(plan.scope);
    return withSettingsFileLock(target, () => {
      const current = this.inspect(plan.scope);
      if (current.status !== "ok" && current.status !== "missing") {
        throw new Error(`${plan.scope} settings became ${current.status}; refusing stale apply`);
      }
      const currentDigest = current.digest ?? revisionDigest("");
      if (currentDigest !== plan.beforeDigest) {
        throw new Error("settings changed after preview; create a new plan");
      }
      assertSettingId(plan.settingId);
      const settings = { ...current.settings };
      if (plan.operation === "set") {
        if (plan.value === undefined) throw new Error("settings set plan is missing its value");
        settings[plan.settingId] = normalizeStoredValue(plan.settingId, plan.valueType, plan.value);
      } else if (plan.operation === "unset") {
        if (plan.value !== undefined) throw new Error("settings unset plan must not carry a value");
        delete settings[plan.settingId];
      } else {
        throw new Error("unsupported settings plan operation");
      }
      const expectedDocument: Record<string, unknown> = {
        ...current.unknownFields,
        schema_version: SETTINGS_STORE_SCHEMA_VERSION,
        settings,
      };
      const bytes = sourceBytes(expectedDocument);
      if (sourceBytes(plan.document) !== bytes || revisionDigest(bytes) !== plan.afterDigest) {
        throw new Error("settings plan content or digest mismatch");
      }

      const receiptId = boundedId(this.#nextId());
      const previouslyExisted = current.status === "ok";
      let backupPath: string | null = null;
      if (previouslyExisted) {
        const originalRead = readBoundedRegularFile(target, SETTINGS_STORE_MAX_BYTES);
        if (originalRead.status !== "ok" || revisionDigest(originalRead.bytes) !== currentDigest) {
          throw new Error("settings changed while preparing rollback; refusing stale apply");
        }
        backupPath = `${target}.bak-${receiptId}`;
        if (existsSync(backupPath)) throw new Error("settings rollback backup id already exists");
        durableWrite(backupPath, originalRead.bytes, `${receiptId}.backup`);
      }
      durableWrite(target, bytes, `${receiptId}.apply`);
      return {
        schemaVersion: SETTINGS_STORE_SCHEMA_VERSION,
        summary: `${plan.operation} ${plan.settingId} in ${plan.scope} settings`,
        performedWrite: true,
        rollbackToken: {
          receiptId,
          scope: plan.scope,
          path: target,
          settingId: plan.settingId,
          operation: plan.operation,
          previouslyExisted,
          backupPath,
          beforeDigest: plan.beforeDigest,
          afterDigest: plan.afterDigest,
        },
      };
    });
  }

  #applyBatch(batch: SettingsStoreBatch): SettingsStoreApplyReceipt {
    if (batch.receipt) {
      if (this.#rolledBack.has(batch.receipt.rollbackToken.receiptId)) {
        throw new Error("settings batch was already rolled back");
      }
      return {
        ...batch.receipt,
        performedWrite: false,
        summary: `atomic ${batch.scope} settings batch already committed`,
      };
    }
    const target = this.path(batch.scope);
    batch.sealed = true;
    return withSettingsFileLock(target, () => {
      const current = this.inspect(batch.scope);
      if (current.status !== "ok" && current.status !== "missing") {
        throw new Error(`${batch.scope} settings became ${current.status}; refusing stale apply`);
      }
      const currentDigest = current.digest ?? revisionDigest("");
      if (currentDigest !== batch.beforeDigest) {
        throw new Error("settings changed after preview; create a new plan");
      }

      // Reconstruct from the proven current document and copied mutation
      // semantics. No caller-owned plan.document participates in the write.
      const settings = { ...current.settings };
      for (const mutation of batch.mutations) {
        assertSettingId(mutation.settingId);
        if (mutation.operation === "set") {
          if (mutation.value === undefined) throw new Error("settings set plan is missing its value");
          settings[mutation.settingId] = normalizeStoredValue(
            mutation.settingId,
            mutation.valueType,
            mutation.value,
          );
        } else {
          delete settings[mutation.settingId];
        }
      }
      const expectedDocument: Record<string, unknown> = {
        ...current.unknownFields,
        schema_version: SETTINGS_STORE_SCHEMA_VERSION,
        settings,
      };
      const bytes = sourceBytes(expectedDocument);
      if (revisionDigest(bytes) !== batch.afterDigest) {
        throw new Error("settings batch content or digest mismatch");
      }

      const receiptId = boundedId(this.#nextId());
      let backupPath: string | null = null;
      if (batch.previouslyExisted) {
        const originalRead = readBoundedRegularFile(target, SETTINGS_STORE_MAX_BYTES);
        if (originalRead.status !== "ok" || revisionDigest(originalRead.bytes) !== currentDigest) {
          throw new Error("settings changed while preparing rollback; refusing stale apply");
        }
        backupPath = `${target}.bak-${receiptId}`;
        if (existsSync(backupPath)) throw new Error("settings rollback backup id already exists");
        durableWrite(backupPath, originalRead.bytes, `${receiptId}.backup`);
      }
      durableWrite(target, bytes, `${receiptId}.apply`);
      const first = batch.mutations[0];
      if (!first) throw new Error("settings batch is empty");
      const receipt: SettingsStoreApplyReceipt = {
        schemaVersion: SETTINGS_STORE_SCHEMA_VERSION,
        summary: `atomically applied ${batch.mutations.length} change(s) in ${batch.scope} settings`,
        performedWrite: true,
        rollbackToken: {
          receiptId,
          scope: batch.scope,
          path: target,
          settingId: first.settingId,
          operation: first.operation,
          previouslyExisted: batch.previouslyExisted,
          backupPath,
          beforeDigest: batch.beforeDigest,
          afterDigest: batch.afterDigest,
        },
      };
      batch.receipt = receipt;
      return receipt;
    });
  }

  rollback(token: SettingsStoreRollbackToken): SettingsStoreRollbackReceipt {
    if (this.#rolledBack.has(token.receiptId)) throw new Error("settings receipt was already rolled back");
    if (this.path(token.scope) !== resolve(token.path)) {
      throw new Error("rollback path does not match the configured scope");
    }
    const target = this.path(token.scope);
    return withSettingsFileLock(target, () => {
      const currentRead = readBoundedRegularFile(target, SETTINGS_STORE_MAX_BYTES);
      if (currentRead.status !== "ok") {
        throw new Error("settings target is not a readable regular file; rollback cannot prove current state");
      }
      if (revisionDigest(currentRead.bytes) !== token.afterDigest) {
        throw new Error("settings changed after apply; refusing to overwrite newer state");
      }

      if (token.previouslyExisted) {
        if (!token.backupPath) throw new Error("settings rollback backup is missing");
        const backupRead = readBoundedRegularFile(token.backupPath, SETTINGS_STORE_MAX_BYTES);
        if (backupRead.status !== "ok") throw new Error("settings rollback backup is not a readable regular file");
        if (revisionDigest(backupRead.bytes) !== token.beforeDigest) {
          throw new Error("settings rollback backup digest mismatch");
        }
        durableWrite(target, backupRead.bytes, `${boundedId(this.#nextId())}.rollback`);
      } else {
        removeDurably(target);
      }
      this.#rolledBack.add(token.receiptId);
      return { status: "rolled_back", receiptId: token.receiptId, restoredDigest: token.beforeDigest };
    });
  }

  permissions(scope: WritableSettingScope): "owner_only" | "broad" | "unknown" | "missing" {
    const path = this.path(scope);
    if (!existsSync(path)) return "missing";
    if (process.platform === "win32") return "unknown";
    try {
      return (statSync(path).mode & 0o077) === 0 ? "owner_only" : "broad";
    } catch {
      return "unknown";
    }
  }
}
