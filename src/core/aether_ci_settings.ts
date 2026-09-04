// Safe, dependency-free settings port for the portable AETHER-CLOUD
// `.aether-ci.yml` v1 contract. JSON is deliberately the only accepted input
// syntax here: canonical JSON is a YAML subset accepted by the authoritative
// js-yaml parser, while refusing general YAML avoids a second YAML parser and
// makes every Agent-authored byte deterministic.

import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { scanForSecrets } from "./redaction.js";
import {
  readBoundedRegularFile,
  withSettingsFileLock,
} from "./settings_file_authority.js";
import {
  booleanValidator,
  enumValidator,
  finiteNumberValidator,
  stringValidator,
  type AdapterApplyResult,
  type ConfirmationMetadata,
  type SettingDefinition,
  type SettingHealth,
  type SettingLayer,
  type SettingPlanContext,
  type SettingsRegistry,
  type ValidationResult,
} from "./settings_registry.js";

export const AETHER_CI_CONFIG_SCHEMA_VERSION = 1;
export const AETHER_CI_CONFIG_MAX_BYTES = 64 * 1024;
export const AETHER_CI_CONFIG_MAX_CHECKS = 100;
export const AETHER_CI_CHECK_NAME_MAX_CHARS = 120;
export const AETHER_CI_CHECK_RUN_MAX_CHARS = 4_096;
export const AETHER_CI_CONTRACT_COMMIT = "ee60ab47f881b52e1779e7831282525b6c90c84d";
export const AETHER_CI_CONTRACT_SHA256 = "18c718d6359ae421ef18990bd4570af03901b581fe7bb3819c7189945d16d69c";

const GATES = ["commit", "push", "agent"] as const;
const CHECK_TYPES = ["test", "lint", "typecheck", "build", "format-check", "custom-script"] as const;
const TOP_KEYS = new Set(["version", "gates", "checks", "project"]);
const GATE_KEYS = new Set<string>(GATES);
const CHECK_KEYS = new Set(["name", "type", "run"]);
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const PROJECT_RE = /^prj_[0-9a-f]{16}$/;
const RAW_SECRET_RE = /\b(?:aek_[A-Za-z0-9._-]{8,}|sk-[A-Za-z0-9_-]{8,}|gh[opusr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,}|npm_[A-Za-z0-9]{8,}|pypi-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|Bearer\s+[A-Za-z0-9._~+/-]{8,})\b/i;
const CREDENTIAL_URL_RE = /(?:[?&](?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|password|passwd|secret|signature|sig)=)[^&#\s$][^&#\s]*/i;
const CREDENTIAL_ASSIGNMENT_RE = /(?:--(?:password|passwd|token|api[_-]?key|secret)(?:=|\s+)|\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL)[A-Za-z0-9_]*\s*=\s*)(?!["']?\$)[^\s,;]+/i;

export type AetherCiGate = (typeof GATES)[number];
export type AetherCiCheckType = (typeof CHECK_TYPES)[number];
export type AetherCiConfigStatus =
  | "missing"
  | "ok"
  | "unsupported_yaml"
  | "malformed"
  | "unsupported_version"
  | "unsafe"
  | "oversize"
  | "unreadable";

export interface AetherCiCheck {
  readonly name: string;
  readonly type: AetherCiCheckType;
  readonly run: string;
}

export interface AetherCiConfig {
  readonly version: typeof AETHER_CI_CONFIG_SCHEMA_VERSION;
  readonly gates: Readonly<Record<AetherCiGate, boolean>>;
  readonly checks: readonly AetherCiCheck[];
  readonly project: string | null;
}

export type AetherCiParseResult =
  | { readonly ok: true; readonly config: AetherCiConfig }
  | {
      readonly ok: false;
      readonly status: "malformed" | "unsupported_version" | "unsafe";
      readonly detail: string;
    };

export interface AetherCiConfigInspection {
  readonly path: string;
  readonly status: AetherCiConfigStatus;
  readonly config?: AetherCiConfig;
  readonly digest?: string;
  /** Raw bytes are adapter-private input for exact rollback, never a setting value. */
  readonly raw?: string;
  readonly detail?: string;
}

export interface AetherCiGatePlan {
  readonly kind: "aether_ci_gate";
  readonly gate: AetherCiGate;
  readonly value: boolean;
  readonly path: string;
  readonly beforeDigest: string;
}

export interface AetherCiRollbackToken {
  readonly receiptId: string;
  readonly path: string;
  readonly previouslyExisted: boolean;
  readonly beforeDigest: string;
  readonly afterDigest: string;
  /** Opaque adapter receipt data; registries never expose rollback tokens. */
  readonly previousRaw: string | null;
}

export interface AetherCiApplyReceipt {
  readonly performedWrite: boolean;
  readonly summary: string;
  readonly rollbackToken: AetherCiRollbackToken;
}

export interface AetherCiSettingsFileOptions {
  /** Deterministic seam for tests; production uses a process-unique id. */
  readonly nextId?: () => string;
}

interface AetherCiBatch {
  readonly path: string;
  readonly beforeDigest: string;
  readonly previouslyExisted: boolean;
  readonly previousRaw: string | null;
  readonly plans: Set<AetherCiGatePlan>;
  readonly gates: Set<AetherCiGate>;
  readonly config: {
    version: 1;
    gates: Record<AetherCiGate, boolean>;
    checks: AetherCiCheck[];
    project: string | null;
  };
  sealed: boolean;
  afterDigest: string;
  receipt?: AetherCiApplyReceipt;
}

interface AetherCiAdapterRollback {
  readonly kind: "aether_ci_apply";
  readonly required: boolean;
  readonly token: AetherCiRollbackToken;
}

let receiptSequence = 0;

function nextReceiptId(): string {
  receiptSequence += 1;
  return `${Date.now()}-${process.pid}-${receiptSequence}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(
  status: "malformed" | "unsupported_version" | "unsafe",
  detail: string,
): AetherCiParseResult {
  return { ok: false, status, detail };
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function stringSafety(value: string, label: string, maxLength: number): string | null {
  if (!value.trim()) return `${label} must be non-empty`;
  if (value.length > maxLength) return `${label} exceeds its ${maxLength}-character limit`;
  if (CONTROL_RE.test(value)) return `${label} contains terminal/control characters`;
  if (
    RAW_SECRET_RE.test(value)
    || CREDENTIAL_URL_RE.test(value)
    || CREDENTIAL_ASSIGNMENT_RE.test(value)
    || scanForSecrets(value).length > 0
  ) {
    return `${label} contains credential-shaped content`;
  }
  return null;
}

/** JSON.parse intentionally accepts duplicate keys, while the Cloud YAML
 * authority rejects ambiguous mappings. This bounded scanner closes that
 * semantic gap without introducing a YAML or JSON dependency. */
function hasDuplicateObjectKeys(raw: string): boolean {
  let index = 0;
  let duplicate = false;
  const whitespace = () => {
    while (index < raw.length && /\s/.test(raw[index]!)) index += 1;
  };
  const stringToken = (): string => {
    const start = index;
    index += 1;
    while (index < raw.length) {
      const character = raw[index]!;
      index += 1;
      if (character === "\\") index += 1;
      else if (character === "\"") break;
    }
    return JSON.parse(raw.slice(start, index)) as string;
  };
  const value = (): void => {
    whitespace();
    const character = raw[index];
    if (character === "{") {
      object();
      return;
    }
    if (character === "[") {
      array();
      return;
    }
    if (character === "\"") {
      stringToken();
      return;
    }
    while (index < raw.length && !/[\s,\]}]/.test(raw[index]!)) index += 1;
  };
  const object = (): void => {
    index += 1;
    whitespace();
    const keys = new Set<string>();
    if (raw[index] === "}") {
      index += 1;
      return;
    }
    while (index < raw.length) {
      whitespace();
      const key = stringToken();
      if (keys.has(key)) duplicate = true;
      keys.add(key);
      whitespace();
      index += 1; // colon; JSON.parse already proved syntax.
      value();
      whitespace();
      if (raw[index] === "}") {
        index += 1;
        return;
      }
      index += 1; // comma
    }
  };
  const array = (): void => {
    index += 1;
    whitespace();
    if (raw[index] === "]") {
      index += 1;
      return;
    }
    while (index < raw.length) {
      value();
      whitespace();
      if (raw[index] === "]") {
        index += 1;
        return;
      }
      index += 1; // comma
    }
  };
  try {
    value();
    return duplicate;
  } catch {
    // The caller already ran JSON.parse. A scanner disagreement must fail
    // closed instead of silently accepting an ambiguous document.
    return true;
  }
}

function freezeConfig(config: {
  version: 1;
  gates: Record<AetherCiGate, boolean>;
  checks: AetherCiCheck[];
  project: string | null;
}): AetherCiConfig {
  return Object.freeze({
    version: 1,
    gates: Object.freeze({ ...config.gates }),
    checks: Object.freeze(config.checks.map((check) => Object.freeze({ ...check }))),
    project: config.project,
  });
}

/** Validate the closed v1 data model mirrored from AETHER-CLOUD's
 * desktop/lib/ci/ci-config.cjs at AETHER_CI_CONTRACT_COMMIT. */
export function parseAetherCiJson(raw: string): AetherCiParseResult {
  if (Buffer.byteLength(raw, "utf8") > AETHER_CI_CONFIG_MAX_BYTES) {
    return fail("malformed", "configuration exceeds the bounded input limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("malformed", "configuration is not valid JSON");
  }
  if (hasDuplicateObjectKeys(raw)) return fail("malformed", "configuration contains a duplicate object key");
  if (!isRecord(parsed)) return fail("malformed", "configuration must be a JSON object");
  if (!hasOnlyKeys(parsed, TOP_KEYS)) return fail("malformed", "configuration contains an unknown top-level key");
  if (parsed["version"] !== AETHER_CI_CONFIG_SCHEMA_VERSION) {
    return fail("unsupported_version", "configuration version must be 1");
  }

  const gates: Record<AetherCiGate, boolean> = { commit: false, push: false, agent: false };
  const rawGates = parsed["gates"];
  if (rawGates !== undefined && rawGates !== null) {
    if (!isRecord(rawGates) || !hasOnlyKeys(rawGates, GATE_KEYS)) {
      return fail("malformed", "gates must be a closed mapping");
    }
    for (const gate of GATES) {
      const value = rawGates[gate];
      if (value !== undefined && typeof value !== "boolean") {
        return fail("malformed", `gate ${gate} must be true/false`);
      }
      if (typeof value === "boolean") gates[gate] = value;
    }
  }

  const rawChecks = parsed["checks"] ?? [];
  if (!Array.isArray(rawChecks)) return fail("malformed", "checks must be a list");
  if (rawChecks.length > AETHER_CI_CONFIG_MAX_CHECKS) {
    return fail("malformed", `checks exceed the ${AETHER_CI_CONFIG_MAX_CHECKS}-entry limit`);
  }
  const checks: AetherCiCheck[] = [];
  for (const rawCheck of rawChecks) {
    if (!isRecord(rawCheck) || !hasOnlyKeys(rawCheck, CHECK_KEYS)) {
      return fail("malformed", "each check must be a closed mapping");
    }
    const name = rawCheck["name"];
    const type = rawCheck["type"];
    const run = rawCheck["run"];
    if (typeof name !== "string" || typeof run !== "string" || typeof type !== "string") {
      return fail("malformed", "each check requires string name, type, and run fields");
    }
    if (!CHECK_TYPES.includes(type as AetherCiCheckType)) {
      return fail("malformed", "check type is outside the v1 allowlist");
    }
    const nameProblem = stringSafety(name, "check.name", AETHER_CI_CHECK_NAME_MAX_CHARS);
    const runProblem = stringSafety(run, "check.run", AETHER_CI_CHECK_RUN_MAX_CHARS);
    if (nameProblem || runProblem) return fail("unsafe", nameProblem ?? runProblem ?? "unsafe check");
    checks.push({ name, type: type as AetherCiCheckType, run: run.trim() });
  }

  const rawProject = parsed["project"];
  let project: string | null = null;
  if (rawProject !== undefined && rawProject !== null) {
    if (typeof rawProject !== "string" || !PROJECT_RE.test(rawProject)) {
      return fail("malformed", "project must be a gateway project id (prj_ + 16 hex)");
    }
    project = rawProject;
  }
  const config = freezeConfig({ version: 1, gates, checks, project });
  if (scanForSecrets(canonicalAetherCiJson(config)).length > 0) {
    return fail("unsafe", "configuration contains credential-shaped content");
  }
  return { ok: true, config };
}

export function canonicalAetherCiJson(config: AetherCiConfig): string {
  return JSON.stringify({
    version: 1,
    gates: {
      commit: config.gates.commit,
      push: config.gates.push,
      agent: config.gates.agent,
    },
    checks: config.checks.map((check) => ({ name: check.name, type: check.type, run: check.run })),
    project: config.project,
  }, null, 2) + "\n";
}

export function inspectAetherCiConfig(path: string): AetherCiConfigInspection {
  const target = resolve(path);
  const read = readBoundedRegularFile(target, AETHER_CI_CONFIG_MAX_BYTES);
  if (read.status === "missing") return { path: target, status: "missing" };
  if (read.status !== "ok") {
    return { path: target, status: read.status, detail: read.detail };
  }
  const raw = read.bytes;
  const digest = sha256(raw);
  if (!raw.trimStart().startsWith("{")) {
    return {
      path: target,
      status: "unsupported_yaml",
      digest,
      detail: "existing YAML syntax is supported by AETHER-CLOUD but is read-only in Agent; convert it to JSON explicitly",
    };
  }
  const parsed = parseAetherCiJson(raw);
  if (!parsed.ok) return { path: target, status: parsed.status, digest, detail: parsed.detail };
  return { path: target, status: "ok", config: parsed.config, digest, raw };
}

function boundedReceiptId(value: string): string {
  const result = value.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 96);
  if (!result) throw new Error("CI settings receipt id is empty after sanitization");
  return result;
}

function durableWrite(path: string, bytes: string, suffix: string): void {
  const parent = dirname(path);
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
    try { chmodSync(temporary, 0o600); } catch { /* Windows ACLs are authoritative. */ }
    renameSync(temporary, path);
    try {
      const directory = openSync(parent, "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } catch {
      // Directory fsync is not available on every Windows filesystem.
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
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch {
    // Best effort where directory handles cannot be synced.
  }
}

class PostWriteVerificationError extends Error {
  readonly receipt: AetherCiApplyReceipt;

  constructor(receipt: AetherCiApplyReceipt) {
    super("CI configuration changed during post-write verification");
    this.name = "PostWriteVerificationError";
    this.receipt = receipt;
  }
}

export class AetherCiSettingsFile {
  readonly path: string;
  readonly #nextId: () => string;
  readonly #planningBatches = new WeakMap<object, AetherCiBatch>();
  readonly #planBatches = new WeakMap<object, AetherCiBatch>();
  readonly #rollbackTokens = new WeakSet<object>();
  readonly #rolledBack = new WeakSet<object>();

  constructor(path: string, options: AetherCiSettingsFileOptions = {}) {
    this.path = resolve(path);
    if (basename(this.path) !== ".aether-ci.yml") {
      throw new TypeError("Aether CI settings path must end in .aether-ci.yml");
    }
    this.#nextId = options.nextId ?? nextReceiptId;
  }

  inspect(): AetherCiConfigInspection {
    return inspectAetherCiConfig(this.path);
  }

  plan(gate: AetherCiGate, value: boolean, batchKey: object): AetherCiGatePlan {
    if (!GATE_KEYS.has(gate)) throw new TypeError("unknown Aether CI gate");
    if (typeof value !== "boolean") throw new TypeError("Aether CI gate must be boolean");
    let batch = this.#planningBatches.get(batchKey);
    if (!batch) {
      const inspection = this.inspect();
      if (inspection.status !== "ok" && inspection.status !== "missing") {
        throw new Error(`${inspection.status}: ${inspection.detail ?? "CI configuration is not safely editable"}`);
      }
      const initial = inspection.config ?? freezeConfig({
        version: 1,
        gates: { commit: false, push: false, agent: false },
        checks: [],
        project: null,
      });
      const beforeDigest = inspection.digest ?? sha256("");
      batch = {
        path: this.path,
        beforeDigest,
        previouslyExisted: inspection.status === "ok",
        previousRaw: inspection.raw ?? null,
        plans: new Set(),
        gates: new Set(),
        config: {
          version: 1,
          gates: { ...initial.gates },
          checks: initial.checks.map((check) => ({ ...check })),
          project: initial.project,
        },
        sealed: false,
        afterDigest: beforeDigest,
      };
      this.#planningBatches.set(batchKey, batch);
    }
    if (batch.sealed) throw new Error("Aether CI settings batch was already sealed");
    if (batch.gates.has(gate)) throw new Error(`duplicate Aether CI gate in batch: ${gate}`);
    batch.config.gates[gate] = value;
    const bytes = canonicalAetherCiJson(freezeConfig(batch.config));
    batch.afterDigest = sha256(bytes);
    const plan: AetherCiGatePlan = Object.freeze({
      kind: "aether_ci_gate",
      gate,
      value,
      path: this.path,
      beforeDigest: batch.beforeDigest,
    });
    batch.gates.add(gate);
    batch.plans.add(plan);
    this.#planBatches.set(plan as object, batch);
    return plan;
  }

  apply(plan: AetherCiGatePlan): AetherCiApplyReceipt {
    const batch = this.#planBatches.get(plan as object);
    if (!batch || !batch.plans.has(plan) || plan.kind !== "aether_ci_gate") {
      throw new Error("Aether CI settings plan is foreign or was forged");
    }
    if (plan.path !== this.path || plan.beforeDigest !== batch.beforeDigest || !batch.gates.has(plan.gate)) {
      throw new Error("Aether CI settings plan does not match its file batch");
    }
    if (batch.receipt) {
      if (this.#rolledBack.has(batch.receipt.rollbackToken as object)) {
        throw new Error("Aether CI settings batch was already rolled back");
      }
      return {
        ...batch.receipt,
        performedWrite: false,
        summary: "atomic Aether CI gate batch already committed",
      };
    }
    batch.sealed = true;
    return withSettingsFileLock(this.path, () => {
      const current = this.inspect();
      if (current.status !== "ok" && current.status !== "missing") {
        throw new Error(`Aether CI configuration became ${current.status}; refusing stale apply`);
      }
      const currentDigest = current.digest ?? sha256("");
      if (currentDigest !== batch.beforeDigest) {
        throw new Error("Aether CI configuration changed after preview; create a new plan");
      }
      const config = freezeConfig(batch.config);
      const checked = parseAetherCiJson(canonicalAetherCiJson(config));
      if (!checked.ok) throw new Error(`Aether CI plan failed closed validation: ${checked.detail}`);
      const bytes = canonicalAetherCiJson(checked.config);
      if (sha256(bytes) !== batch.afterDigest) throw new Error("Aether CI batch content digest mismatch");

      const receiptId = boundedReceiptId(this.#nextId());
      durableWrite(this.path, bytes, `${receiptId}.apply`);
      const token: AetherCiRollbackToken = Object.freeze({
        receiptId,
        path: this.path,
        previouslyExisted: batch.previouslyExisted,
        beforeDigest: batch.beforeDigest,
        afterDigest: batch.afterDigest,
        previousRaw: batch.previousRaw,
      });
      this.#rollbackTokens.add(token as object);
      const receipt: AetherCiApplyReceipt = Object.freeze({
        performedWrite: true,
        summary: `atomically applied ${batch.gates.size} Aether CI gate change(s)`,
        rollbackToken: token,
      });
      batch.receipt = receipt;
      const verified = this.inspect();
      if (verified.status !== "ok" || verified.digest !== batch.afterDigest) {
        throw new PostWriteVerificationError(receipt);
      }
      return receipt;
    });
  }

  rollback(token: AetherCiRollbackToken): void {
    if (!this.#rollbackTokens.has(token as object)) throw new Error("Aether CI rollback token is foreign or was forged");
    if (this.#rolledBack.has(token as object)) return;
    if (token.path !== this.path) throw new Error("Aether CI rollback path does not match this adapter");
    withSettingsFileLock(this.path, () => {
      const current = this.inspect();
      if (current.status === "missing" || current.digest !== token.afterDigest) {
        throw new Error("Aether CI configuration changed after apply; refusing to overwrite newer state");
      }
      if (token.previouslyExisted) {
        if (token.previousRaw === null || sha256(token.previousRaw) !== token.beforeDigest) {
          throw new Error("Aether CI rollback source digest mismatch");
        }
        durableWrite(this.path, token.previousRaw, `${token.receiptId}.rollback`);
      } else {
        removeDurably(this.path);
      }
      this.#rolledBack.add(token as object);
    });
  }
}

function healthFor(inspection: AetherCiConfigInspection, doctor = false): SettingHealth {
  switch (inspection.status) {
    case "missing":
      return { state: "unconfigured", summary: `no .aether-ci.yml at ${inspection.path}` };
    case "ok":
      return {
        state: doctor ? "verified" : "configured",
        summary: `JSON-subset v1 validated against Cloud contract ${AETHER_CI_CONTRACT_COMMIT.slice(0, 12)}; checks were not executed`,
      };
    case "unsupported_yaml":
      return { state: "unavailable", summary: "existing YAML syntax is read-only in Agent; convert it to canonical JSON explicitly" };
    case "malformed":
      return { state: "degraded", summary: "Aether CI JSON is malformed or outside the closed v1 schema" };
    case "unsupported_version":
      return { state: "unavailable", summary: "Aether CI configuration version is not supported by this Agent" };
    case "unsafe":
      return { state: "degraded", summary: "Aether CI configuration was rejected as unsafe; no value will be overwritten" };
    case "oversize":
      return { state: "unavailable", summary: `Aether CI configuration exceeds ${AETHER_CI_CONFIG_MAX_BYTES} bytes` };
    case "unreadable":
      return { state: "unavailable", summary: "Aether CI configuration cannot be read safely" };
  }
}

function unknownLayer(inspection: AetherCiConfigInspection): SettingLayer {
  return {
    scope: "project",
    source: inspection.path,
    value: { aether_ci_status: inspection.status },
  };
}

function isGatePlan(value: unknown, gate: AetherCiGate): value is AetherCiGatePlan {
  return isRecord(value) && value["kind"] === "aether_ci_gate" && value["gate"] === gate;
}

function isAdapterRollback(value: unknown): value is AetherCiAdapterRollback {
  return isRecord(value) && value["kind"] === "aether_ci_apply" &&
    typeof value["required"] === "boolean" && isRecord(value["token"]);
}

function gateConfirmation(gate: AetherCiGate): ConfirmationMetadata {
  const label = gate.toUpperCase();
  return {
    impact: "destructive",
    phrase: `ENABLE CI ${label} GATE`,
    reason: gate === "agent"
      ? "the agent may request execution of project-owned CI commands"
      : `${gate} operations will be blocked on project-owned CI commands`,
    approvalFlag: "--approve destructive",
  };
}

function gateDefinition(file: AetherCiSettingsFile, gate: AetherCiGate): SettingDefinition<boolean> {
  const id = `actions.ci_gate_${gate}`;
  return {
    id,
    section: "Aether Actions / CI",
    label: `${gate[0]!.toUpperCase()}${gate.slice(1)} gate`,
    description: `Project-owned ${gate} gate from the closed .aether-ci.yml v1 contract. This setting never executes checks or exposes check.run.`,
    valueType: "boolean",
    scopes: ["default", "project"],
    confirmation: (change) => change.afterAtScope?.state === "known" && change.afterAtScope.value
      ? gateConfirmation(gate)
      : undefined,
    async read() {
      const inspection = file.inspect();
      const layers: SettingLayer[] = [{ scope: "default", source: "Aether CI v1 default", value: false }];
      if (inspection.status === "ok" && inspection.config) {
        layers.push({ scope: "project", source: inspection.path, value: inspection.config.gates[gate] });
      } else if (inspection.status !== "missing") {
        layers.push(unknownLayer(inspection));
      }
      return { layers, health: healthFor(inspection) };
    },
    validate: booleanValidator,
    async plan(change, context: SettingPlanContext) {
      if (change.scope !== "project") throw new Error("Aether CI gates are project-scoped only");
      const value = change.operation === "set" ? change.afterAtScope?.value : false;
      if (typeof value !== "boolean") throw new Error("validated Aether CI gate value is missing");
      return file.plan(gate, value, context.batchKey);
    },
    async apply(plan): Promise<AdapterApplyResult> {
      if (!isGatePlan(plan, gate)) return { ok: false, error: "invalid Aether CI gate plan" };
      try {
        const receipt = file.apply(plan);
        return {
          ok: true,
          receipt: {
            summary: receipt.summary,
            rollbackToken: {
              kind: "aether_ci_apply",
              required: receipt.performedWrite,
              token: receipt.rollbackToken,
            } satisfies AetherCiAdapterRollback,
          },
        };
      } catch (error) {
        if (error instanceof PostWriteVerificationError) {
          return {
            ok: false,
            error: error.message,
            compensationReceipt: {
              rollbackToken: {
                kind: "aether_ci_apply",
                required: true,
                token: error.receipt.rollbackToken,
              } satisfies AetherCiAdapterRollback,
            },
          };
        }
        return { ok: false, error: error instanceof Error ? error.message : "Aether CI settings write failed" };
      }
    },
    async rollback(receipt) {
      if (!isAdapterRollback(receipt.rollbackToken)) throw new Error("invalid Aether CI rollback receipt");
      if (receipt.rollbackToken.required) file.rollback(receipt.rollbackToken.token);
    },
    async doctor() { return healthFor(file.inspect(), true); },
  };
}

function readOnlyDefinition<T extends string | number>(args: {
  id: string;
  label: string;
  description: string;
  valueType: "string" | "number";
  defaultValue: T;
  validate: (value: unknown) => ValidationResult<T>;
  value: (config: AetherCiConfig) => T;
  file: AetherCiSettingsFile;
}): SettingDefinition<T> {
  const read = async () => {
    const inspection = args.file.inspect();
    const source = inspection.status === "missing" ? "Aether CI v1 default" : inspection.path;
    const value = inspection.status === "ok" && inspection.config
      ? args.value(inspection.config)
      : inspection.status === "missing"
        ? args.defaultValue
        : { aether_ci_status: inspection.status };
    return { layers: [{ scope: "default" as const, source, value }], health: healthFor(inspection) };
  };
  return {
    id: args.id,
    section: "Aether Actions / CI",
    label: args.label,
    description: args.description,
    valueType: args.valueType,
    scopes: ["default"],
    validate: args.validate,
    read,
    async plan() { throw new Error(`${args.id} is read-only`); },
    async apply() { return { ok: false, error: `${args.id} is read-only` }; },
    async doctor() { return healthFor(args.file.inspect(), true); },
  };
}

/** Register only bounded, non-command CI leaves. `checks[].run` remains inside
 * the opaque file adapter and can neither be supplied nor returned by the
 * terminal settings registry. */
export function registerAetherCiSettings(registry: SettingsRegistry, file: AetherCiSettingsFile): void {
  registry.register(readOnlyDefinition({
    id: "actions.ci_config",
    label: "Aether CI configuration",
    description: "Validation state for the JSON-subset .aether-ci.yml v1 contract; this row is read-only.",
    valueType: "string",
    defaultValue: "missing",
    validate: stringValidator,
    value: () => "validated_json",
    file,
  }));
  for (const gate of GATES) registry.register(gateDefinition(file, gate));
  registry.register(readOnlyDefinition({
    id: "actions.ci_check_count",
    label: "Configured check count",
    description: "Read-only number of validated checks. Check commands are never exposed or editable through settings.",
    valueType: "number",
    defaultValue: 0,
    validate: finiteNumberValidator,
    value: (config) => config.checks.length,
    file,
  }));
  registry.register(readOnlyDefinition({
    id: "actions.ci_check_names",
    label: "Configured check names",
    description: "Read-only validated check names; check.run remains opaque and cannot be executed by settings.",
    valueType: "string",
    defaultValue: "[none]",
    validate: stringValidator,
    value: (config) => config.checks.length ? config.checks.map((check) => check.name).join(", ") : "[none]",
    file,
  }));
  registry.register(readOnlyDefinition({
    id: "actions.ci_project_binding",
    label: "Project binding",
    description: "Read-only bound/unbound status for the canonical gateway project id; the identifier is not editable here.",
    valueType: "string",
    defaultValue: "unbound",
    validate: enumValidator(["bound", "unbound"] as const),
    value: (config) => config.project ? "bound" : "unbound",
    file,
  }));
}
