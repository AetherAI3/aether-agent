// Typed boundary for skill discovery, resolution, and loading.
// No anonymous object bags cross this boundary (spec §5).

import type { SkillManifest, SkillScope } from "./skill_schema.js";
import type { PermissionName } from "./permission_vocabulary.js";

export type SkillTrustState =
  | "trusted"          // digest matches a recorded trust decision (or signed built-in)
  | "untrusted"        // project skill with no trust record
  | "changed"          // trust record exists for a DIFFERENT digest — review required
  | "builtin";         // shipped inside the signed package artifact

export interface SkillDescriptor {
  /** Fully qualified id, e.g. "project/review-pr" or "aether/fix-ci". */
  id: string;
  version: string;
  name: string;
  description: string;
  scope: SkillScope;
  /** Absolute skill root on disk (or package resource root for built-ins). */
  root: string;
  /** Canonical content digest — sha256 hex. */
  sha256: string;
  trust: SkillTrustState;
  enabled: boolean;
  /** Enabled for bounded automatic selection (requires trust). */
  automatic: boolean;
  /** Approximate context cost if loaded (from manifest.context.maxTokens). */
  approxTokens: number;
  manifest: SkillManifest;
}

/** A skill that failed validation — indexed so `skills list` can show WHY, never loadable. */
export interface SkillIndexError {
  root: string;
  scope: SkillScope;
  errors: readonly string[];
}

export interface SkillIndex {
  skills: readonly SkillDescriptor[];
  errors: readonly SkillIndexError[];
  generatedAt: string;
}

export type SkillInvocationKind = "explicit" | "automatic";

export interface SkillCandidate {
  descriptor: SkillDescriptor;
  invocation: SkillInvocationKind;
  /** Why the resolver matched it — shown to the user, never empty. */
  reason: string;
  /** 0..1 resolver confidence; explicit invocation is always 1. */
  confidence: number;
}

export interface ResolvedSkill {
  candidate: SkillCandidate;
  /** Dependency-ordered descriptors, dependencies first, target last. */
  loadOrder: readonly SkillDescriptor[];
}

export interface LoadedSkillResource {
  name: string;
  sha256: string;
  content: string;
}

export interface LoadedSkill {
  descriptor: SkillDescriptor;
  invocation: SkillInvocationKind;
  instructions: string;
  resources: readonly LoadedSkillResource[];
  /** Bytes actually loaded (instructions + resources). */
  loadedBytes: number;
}

/** The effective, already-intersected policy the host enforces per tool call. */
export interface SkillPolicy {
  skillId: string;
  allowedTools: readonly string[];
  requiredPermissions: readonly PermissionName[];
  forbiddenPermissions: readonly PermissionName[];
}
