// aether.skill/v1 — strict manifest schema for Agent Skills.
//
// Strict JSON only (zero-runtime-dependency repo: no YAML). Unknown keys,
// malformed fields, and unsafe paths are hard errors with actionable messages —
// nothing is silently discarded. Validation here is pure and filesystem-free;
// path EXISTENCE and symlink safety are checked later by the resource loader.

import { TOOLS } from "../brain_protocol.js";
import {
  isPermissionName,
  SKILL_UNDECLARABLE_PERMISSIONS,
  type PermissionName,
} from "./permission_vocabulary.js";
import { SKILL_BOUNDS } from "./skill_bounds.js";

export const SKILL_SCHEMA_VERSION = 1;

/** `builtin/<name>`, `user/<name>`, `project/<name>` — or reserved `aether/<name>`. */
export type SkillScope = "builtin" | "user" | "project";

export interface SkillTriggers {
  commands: readonly string[];
  phrases: readonly string[];
  automatic: boolean;
}

export interface SkillToolPolicy {
  allowed: readonly string[];
  required: readonly string[];
  denied: readonly string[];
}

export interface SkillPermissionPolicy {
  requires: readonly PermissionName[];
  mayRequest: readonly PermissionName[];
  forbids: readonly PermissionName[];
}

export interface SkillContextSpec {
  maxTokens: number;
  maxResources: number;
  resources: readonly string[];
}

export interface SkillOutputSpec {
  kinds: readonly string[];
  verification: readonly string[];
}

export interface SkillCompatibility {
  minAgentVersion: string;
  capabilityContract: number;
}

export interface SkillManifest {
  schemaVersion: number;
  id: string;
  version: string;
  name: string;
  description: string;
  entrypoint: string;
  triggers: SkillTriggers;
  tools: SkillToolPolicy;
  permissions: SkillPermissionPolicy;
  context: SkillContextSpec;
  outputs: SkillOutputSpec;
  dependencies: { skills: readonly string[] };
  compatibility: SkillCompatibility;
  health: { evalManifest: string | null };
}

export type ManifestValidation =
  | { ok: true; manifest: SkillManifest }
  | { ok: false; errors: readonly string[] };

const ID_PATTERN = /^(aether|builtin|user|project)\/[a-z0-9][a-z0-9-]{0,63}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMAND_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

const TOP_KEYS = new Set([
  "$schema", "schema_version", "id", "version", "name", "description",
  "entrypoint", "triggers", "tools", "permissions", "context", "outputs",
  "dependencies", "compatibility", "health",
]);

const TOOL_SET: ReadonlySet<string> = new Set(TOOLS);

/** Relative, normalized, inside-root path — no `..`, no absolute, no URL, no backslash. */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 512) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  const parts = path.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(
  value: unknown, label: string, errors: string[],
  maxItems: number, maxChars: number,
): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) { errors.push(label + " must be an array"); return []; }
  if (value.length > maxItems) errors.push(label + " exceeds " + maxItems + " entries");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) { errors.push(label + " entries must be non-empty strings"); continue; }
    if (item.length > maxChars) { errors.push(label + " entry exceeds " + maxChars + " chars: " + item.slice(0, 40)); continue; }
    if (seen.has(item)) { errors.push(label + " has duplicate entry: " + item); continue; }
    seen.add(item);
    out.push(item);
  }
  return out;
}

function unknownKeys(record: Record<string, unknown>, allowed: readonly string[], label: string, errors: string[]): void {
  const set = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!set.has(key)) errors.push(label + " has unknown key: " + key);
  }
}

/**
 * Validate one parsed skill.json value against aether.skill/v1.
 * `scope` is where the skill was FOUND — the id's declared scope must agree,
 * and `aether/*` is reserved for signed built-ins.
 */
export function validateSkillManifest(raw: unknown, scope: SkillScope): ManifestValidation {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["skill.json must be a JSON object"] };

  unknownKeys(raw, [...TOP_KEYS], "manifest", errors);

  const schemaVersion = raw["schema_version"];
  if (schemaVersion !== SKILL_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        "unsupported schema_version " + String(schemaVersion) +
        " — this agent supports aether.skill/v" + SKILL_SCHEMA_VERSION +
        "; upgrade the agent or re-author the skill against the supported schema",
      ],
    };
  }

  const id = typeof raw["id"] === "string" ? raw["id"] : "";
  if (!ID_PATTERN.test(id)) {
    errors.push("id must match <scope>/<kebab-name> with scope aether|builtin|user|project, lowercase");
  } else {
    const declaredScope = id.split("/")[0] ?? "";
    if (declaredScope === "aether" && scope !== "builtin") {
      errors.push("the aether/* namespace is reserved for signed built-in skills");
    } else if (declaredScope !== "aether" && declaredScope !== scope) {
      errors.push("id scope '" + declaredScope + "' does not match discovery scope '" + scope + "'");
    }
  }

  const version = typeof raw["version"] === "string" ? raw["version"] : "";
  if (!SEMVER_PATTERN.test(version)) errors.push("version must be strict semver MAJOR.MINOR.PATCH");

  const name = typeof raw["name"] === "string" ? raw["name"].trim() : "";
  if (!name || name.length > SKILL_BOUNDS.maxNameChars) {
    errors.push("name is required, at most " + SKILL_BOUNDS.maxNameChars + " chars");
  }
  const description = typeof raw["description"] === "string" ? raw["description"].trim() : "";
  if (!description || description.length > SKILL_BOUNDS.maxDescriptionChars) {
    errors.push("description is required, at most " + SKILL_BOUNDS.maxDescriptionChars + " chars");
  }

  const entrypoint = typeof raw["entrypoint"] === "string" ? raw["entrypoint"] : "SKILL.md";
  if (!isSafeRelativePath(entrypoint)) errors.push("entrypoint must be a safe relative path inside the skill root");

  // triggers
  let triggers: SkillTriggers = { commands: [], phrases: [], automatic: false };
  const rawTriggers = raw["triggers"];
  if (rawTriggers != null) {
    if (!isRecord(rawTriggers)) errors.push("triggers must be an object");
    else {
      unknownKeys(rawTriggers, ["commands", "phrases", "automatic"], "triggers", errors);
      const commands = stringList(rawTriggers["commands"], "triggers.commands", errors, SKILL_BOUNDS.maxCommandAliases, 40);
      for (const command of commands) {
        if (!COMMAND_PATTERN.test(command)) errors.push("triggers.commands entry must be lowercase kebab: " + command);
      }
      const automatic = rawTriggers["automatic"];
      if (automatic != null && typeof automatic !== "boolean") errors.push("triggers.automatic must be a boolean");
      triggers = {
        commands,
        phrases: stringList(rawTriggers["phrases"], "triggers.phrases", errors, SKILL_BOUNDS.maxTriggerPhrases, SKILL_BOUNDS.maxTriggerPhraseChars),
        automatic: automatic === true,
      };
    }
  }

  // tools
  let tools: SkillToolPolicy = { allowed: [], required: [], denied: [] };
  const rawTools = raw["tools"];
  if (rawTools != null) {
    if (!isRecord(rawTools)) errors.push("tools must be an object");
    else {
      unknownKeys(rawTools, ["allowed", "required", "denied"], "tools", errors);
      const allowed = stringList(rawTools["allowed"], "tools.allowed", errors, TOOLS.length, 60);
      const required = stringList(rawTools["required"], "tools.required", errors, TOOLS.length, 60);
      const denied = stringList(rawTools["denied"], "tools.denied", errors, TOOLS.length, 60);
      for (const list of [allowed, required, denied]) {
        for (const tool of list) {
          if (!TOOL_SET.has(tool)) errors.push("unknown tool name: " + tool);
        }
      }
      const allowedSet = new Set(allowed);
      for (const tool of required) {
        if (!allowedSet.has(tool)) errors.push("tools.required must be a subset of tools.allowed: " + tool);
      }
      for (const tool of denied) {
        if (allowedSet.has(tool)) errors.push("tools.denied must not intersect tools.allowed: " + tool);
      }
      tools = { allowed, required, denied };
    }
  }

  // permissions
  let permissions: SkillPermissionPolicy = { requires: [], mayRequest: [], forbids: [] };
  const rawPermissions = raw["permissions"];
  if (rawPermissions != null) {
    if (!isRecord(rawPermissions)) errors.push("permissions must be an object");
    else {
      unknownKeys(rawPermissions, ["requires", "may_request", "forbids"], "permissions", errors);
      const parse = (key: string): PermissionName[] => {
        const names = stringList(rawPermissions[key], "permissions." + key, errors, 24, 60);
        const out: PermissionName[] = [];
        for (const value of names) {
          if (!isPermissionName(value)) { errors.push("unknown permission name: " + value); continue; }
          out.push(value);
        }
        return out;
      };
      const requires = parse("requires");
      const mayRequest = parse("may_request");
      const forbids = parse("forbids");
      for (const permission of [...requires, ...mayRequest]) {
        if (SKILL_UNDECLARABLE_PERMISSIONS.includes(permission)) {
          errors.push("permission '" + permission + "' cannot be declared by a skill");
        }
        if (forbids.includes(permission)) {
          errors.push("permission '" + permission + "' is both requested and forbidden");
        }
      }
      permissions = { requires, mayRequest, forbids };
    }
  }

  // context
  let context: SkillContextSpec = { maxTokens: 4000, maxResources: SKILL_BOUNDS.maxResources, resources: [] };
  const rawContext = raw["context"];
  if (rawContext != null) {
    if (!isRecord(rawContext)) errors.push("context must be an object");
    else {
      unknownKeys(rawContext, ["max_tokens", "max_resources", "resources"], "context", errors);
      const maxTokens = rawContext["max_tokens"];
      if (maxTokens != null && (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > SKILL_BOUNDS.maxLoadedSkillTokens)) {
        errors.push("context.max_tokens must be an integer from 1 to " + SKILL_BOUNDS.maxLoadedSkillTokens);
      }
      const resources = stringList(rawContext["resources"], "context.resources", errors, SKILL_BOUNDS.maxResources, 512);
      for (const resource of resources) {
        if (!isSafeRelativePath(resource)) errors.push("context.resources entry must be a safe relative path: " + resource);
      }
      context = {
        maxTokens: typeof maxTokens === "number" ? maxTokens : 4000,
        maxResources: SKILL_BOUNDS.maxResources,
        resources,
      };
    }
  }

  // outputs
  let outputs: SkillOutputSpec = { kinds: [], verification: [] };
  const rawOutputs = raw["outputs"];
  if (rawOutputs != null) {
    if (!isRecord(rawOutputs)) errors.push("outputs must be an object");
    else {
      unknownKeys(rawOutputs, ["kinds", "verification"], "outputs", errors);
      outputs = {
        kinds: stringList(rawOutputs["kinds"], "outputs.kinds", errors, 8, 60),
        verification: stringList(rawOutputs["verification"], "outputs.verification", errors, 8, 120),
      };
    }
  }

  // dependencies
  let dependencySkills: string[] = [];
  const rawDependencies = raw["dependencies"];
  if (rawDependencies != null) {
    if (!isRecord(rawDependencies)) errors.push("dependencies must be an object");
    else {
      unknownKeys(rawDependencies, ["skills"], "dependencies", errors);
      dependencySkills = stringList(rawDependencies["skills"], "dependencies.skills", errors, SKILL_BOUNDS.maxDependencies, 80);
      for (const dependency of dependencySkills) {
        if (!ID_PATTERN.test(dependency)) errors.push("dependencies.skills entry must be a fully qualified skill id: " + dependency);
        if (dependency === id) errors.push("a skill cannot depend on itself");
      }
    }
  }

  // compatibility
  let compatibility: SkillCompatibility = { minAgentVersion: "0.1.0", capabilityContract: 1 };
  const rawCompatibility = raw["compatibility"];
  if (rawCompatibility != null) {
    if (!isRecord(rawCompatibility)) errors.push("compatibility must be an object");
    else {
      unknownKeys(rawCompatibility, ["min_agent_version", "capability_contract"], "compatibility", errors);
      const minAgentVersion = rawCompatibility["min_agent_version"];
      if (minAgentVersion != null && (typeof minAgentVersion !== "string" || !SEMVER_PATTERN.test(minAgentVersion))) {
        errors.push("compatibility.min_agent_version must be strict semver");
      }
      const capabilityContract = rawCompatibility["capability_contract"];
      if (capabilityContract != null && (typeof capabilityContract !== "number" || !Number.isInteger(capabilityContract) || capabilityContract < 1)) {
        errors.push("compatibility.capability_contract must be a positive integer");
      }
      compatibility = {
        minAgentVersion: typeof minAgentVersion === "string" ? minAgentVersion : "0.1.0",
        capabilityContract: typeof capabilityContract === "number" ? capabilityContract : 1,
      };
    }
  }

  // health
  let evalManifest: string | null = null;
  const rawHealth = raw["health"];
  if (rawHealth != null) {
    if (!isRecord(rawHealth)) errors.push("health must be an object");
    else {
      unknownKeys(rawHealth, ["eval_manifest"], "health", errors);
      const manifest = rawHealth["eval_manifest"];
      if (manifest != null) {
        if (typeof manifest !== "string" || !isSafeRelativePath(manifest)) {
          errors.push("health.eval_manifest must be a safe relative path");
        } else {
          evalManifest = manifest;
        }
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      schemaVersion: SKILL_SCHEMA_VERSION,
      id, version, name, description, entrypoint,
      triggers, tools, permissions, context, outputs,
      dependencies: { skills: dependencySkills },
      compatibility,
      health: { evalManifest },
    },
  };
}

/** Compare two strict-semver strings: negative when a < b. */
export function compareSemver(a: string, b: string): number {
  const parse = (value: string): number[] => value.split(".").map((part) => Number(part));
  const [aMajor = 0, aMinor = 0, aPatch = 0] = parse(a);
  const [bMajor = 0, bMinor = 0, bPatch = 0] = parse(b);
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}
