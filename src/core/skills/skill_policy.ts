// Effective policy calculation and per-call enforcement.
//
// The effective authority is an INTERSECTION — a skill can only narrow, never
// widen. Enforced in the host immediately before tool execution; a request for
// an undeclared tool returns a structured refusal, never execute-then-explain.

import { TOOLS, type ToolName } from "../brain_protocol.js";
import { SkillError, type SkillRefusal } from "./skill_errors.js";
import { TOOL_PERMISSIONS, type PermissionName } from "./permission_vocabulary.js";
import type { LoadedSkill, SkillPolicy } from "./skill_types.js";

/**
 * Permissions live in the current operator session, derived from mode/flags —
 * calculated by the caller (host loop) from PermissionMode + autoApply + any
 * explicit grants. Skills never contribute to this set.
 */
export type PermissionEnvelope = ReadonlySet<PermissionName>;

/**
 * The skill's own narrowing of the tool surface. Operator-envelope checks
 * happen per call in refuseUndeclaredToolCall — this stays envelope-free so a
 * cached policy can never go stale against a mode change mid-session.
 */
export function calculateSkillPolicy(skill: LoadedSkill): SkillPolicy {
  const manifest = skill.descriptor.manifest;
  const allowed: string[] = [];
  for (const tool of manifest.tools.allowed) {
    const needed = TOOL_PERMISSIONS[tool as ToolName];
    // A tool whose permission is forbidden by the skill itself is never
    // effective, regardless of the operator envelope.
    if (needed && manifest.permissions.forbids.includes(needed)) continue;
    allowed.push(tool);
  }
  return {
    skillId: skill.descriptor.id,
    allowedTools: allowed,
    requiredPermissions: manifest.permissions.requires,
    forbiddenPermissions: manifest.permissions.forbids,
  };
}

/**
 * Refuse when a required permission is missing from the operator envelope.
 * Called once at invocation time — a skill that cannot get what it REQUIRES
 * does not run at all (may_request permissions degrade gracefully instead).
 */
export function assertRequiredPermissions(
  policy: SkillPolicy,
  envelope: PermissionEnvelope,
): void {
  for (const permission of policy.requiredPermissions) {
    if (!envelope.has(permission)) {
      throw new SkillError({
        code: "skill.permission_unavailable",
        skillId: policy.skillId,
        detail: "required permission not in the active envelope: " + permission,
        context: { permission },
      });
    }
  }
}

/**
 * Per-tool-call gate. Returns null when the call may proceed, otherwise the
 * structured refusal to send back to the brain. Checks, in order:
 *   1. tool is a known canonical tool
 *   2. tool is declared allowed by every active skill policy
 *   3. the tool's permission is not forbidden by any active skill
 *   4. the tool's permission is present in the operator envelope
 */
export function refuseUndeclaredToolCall(
  tool: string,
  policies: readonly SkillPolicy[],
  envelope: PermissionEnvelope,
): SkillRefusal | null {
  if (!(TOOLS as readonly string[]).includes(tool)) {
    return { code: "skill.tool_not_declared", detail: "unknown tool: " + tool };
  }
  const needed = TOOL_PERMISSIONS[tool as ToolName];
  for (const policy of policies) {
    if (!policy.allowedTools.includes(tool)) {
      return {
        code: "skill.tool_not_declared",
        skillId: policy.skillId,
        detail: "tool '" + tool + "' is not declared by " + policy.skillId,
        context: { tool, effective_allowed_tools: policy.allowedTools },
      };
    }
    if (policy.forbiddenPermissions.includes(needed)) {
      return {
        code: "skill.permission_denied",
        skillId: policy.skillId,
        detail: "permission '" + needed + "' is forbidden by " + policy.skillId,
        context: { tool, permission: needed },
      };
    }
  }
  if (policies.length > 0 && !envelope.has(needed)) {
    return {
      code: "skill.permission_unavailable",
      detail: "permission '" + needed + "' is not in the active envelope",
      context: { tool, permission: needed },
    };
  }
  return null;
}
