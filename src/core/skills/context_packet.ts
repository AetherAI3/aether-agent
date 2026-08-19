// Typed skill context packet — what actually rides to the brain (local or
// hosted). Bounded, sanitized for transport, inspectable before delegation.
// Instruction/resource CONTENT is never logged (session_log scrubbing applies).

import { SKILL_BOUNDS } from "./skill_bounds.js";
import { SkillError } from "./skill_errors.js";
import type { LoadedSkill } from "./skill_types.js";

export const SKILL_CONTEXT_CONTRACT_VERSION = 1;

export interface SkillContextResource {
  name: string;
  digest: string;
  content: string;
}

export interface SkillContextEntry {
  id: string;
  version: string;
  digest: string;
  scope: string;
  invocation: "explicit" | "automatic";
  instructions: string;
  resources: readonly SkillContextResource[];
  tool_policy: { allowed: readonly string[] };
  permission_policy: { requires: readonly string[] };
}

export interface SkillContextPacket {
  contract_version: number;
  skills: readonly SkillContextEntry[];
}

/** Rough token estimate: 4 bytes per token, the standard planning heuristic. */
export function approximateTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

/**
 * Build the packet from loaded skills. Enforces the per-turn skill count and
 * aggregate token budget — exceeding either refuses rather than clipping
 * silently (an explicit override raises the budget upstream, not here).
 */
export function buildSkillContextPacket(skills: readonly LoadedSkill[]): SkillContextPacket {
  if (skills.length > SKILL_BOUNDS.maxSkillsPerTurn) {
    throw new SkillError({
      code: "skill.context_budget_exceeded",
      detail: skills.length + " skills exceed the per-turn limit of " + SKILL_BOUNDS.maxSkillsPerTurn,
    });
  }
  let totalBytes = 0;
  const entries: SkillContextEntry[] = skills.map((skill) => {
    totalBytes += skill.loadedBytes;
    return {
      id: skill.descriptor.id,
      version: skill.descriptor.version,
      digest: "sha256:" + skill.descriptor.sha256,
      scope: skill.descriptor.scope,
      invocation: skill.invocation,
      instructions: sanitizeForTransport(skill.instructions),
      resources: skill.resources.map((resource) => ({
        name: resource.name,
        digest: "sha256:" + resource.sha256,
        content: sanitizeForTransport(resource.content),
      })),
      tool_policy: { allowed: skill.descriptor.manifest.tools.allowed },
      permission_policy: { requires: skill.descriptor.manifest.permissions.requires },
    };
  });
  const totalTokens = approximateTokens(totalBytes);
  if (totalTokens > SKILL_BOUNDS.maxLoadedSkillTokens) {
    throw new SkillError({
      code: "skill.context_budget_exceeded",
      detail: "~" + totalTokens + " tokens of skill context exceed the budget of " + SKILL_BOUNDS.maxLoadedSkillTokens,
    });
  }
  return { contract_version: SKILL_CONTEXT_CONTRACT_VERSION, skills: entries };
}

/** Strip control characters that could corrupt SSE/JSON transport; keep \n and \t. */
export function sanitizeForTransport(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}
