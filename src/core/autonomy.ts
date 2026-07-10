// Autonomy / permission gating. Mirrors Aether Agent desktop "skip-perms" +
// "auto-apply" so the terminal and the IDE enforce edits identically.
//
//   ask  → every edit/shell action prompts the user
//   auto → actions allowed; prompt only when autoApply is off
//   skip → fully autonomous, no prompts (skip-perms)
//
// Pure function — unit tested. The actual prompt I/O lives in the command layer.

import type { PermissionMode } from "../types.js";
import { toolDefinition } from "./tool_registry.js";

export type GateAction = "edit" | "shell" | "write";

export interface GateDecision {
  allowed: boolean;
  needsPrompt: boolean;
  reason: string;
}

export function evaluate(
  action: GateAction,
  mode: PermissionMode,
  autoApply: boolean,
): GateDecision {
  switch (mode) {
    case "skip":
      return { allowed: true, needsPrompt: false, reason: "skip-perms" };
    case "auto":
      return { allowed: true, needsPrompt: !autoApply, reason: `auto:${action}` };
    case "ask":
    default:
      return { allowed: true, needsPrompt: true, reason: `ask:${action}` };
  }
}

/**
 * Map a tool name to the gate action it requires, or null when the tool is
 * read-only and never needs approval. `run_tests` runs the HOST's own grounding
 * command (operator-supplied, not brain-chosen) so it is intentionally ungated;
 * only the brain-driven mutating/arbitrary-exec tools are gated.
 */
export function gateActionFor(tool: string): GateAction | null {
  const effect = toolDefinition(tool)?.sideEffect;
  if (effect === "write") return "write";
  if (effect === "shell" || effect === "git") return "shell";
  return null;
}

export type GateOutcome = "allow" | "deny" | "prompt";

/** Runtime context the gate decision needs beyond the static mode/autoApply. */
export interface GateEnv {
  /** `--yes` / auto-confirm was passed. */
  yes: boolean;
  /** stdin is a TTY, so an interactive y/N prompt is possible. */
  isTty: boolean;
}

/**
 * Decide what to do with one brain-emitted tool call. Pure — the caller performs
 * the actual prompt I/O when this returns "prompt".
 *
 *  - read-only tool                       → allow
 *  - mode/autoApply says no prompt needed → allow (skip, or auto+autoApply)
 *  - --yes                                → allow (operator pre-approved)
 *  - prompt needed but no TTY to ask on   → deny  (FAIL CLOSED — an unattended
 *      session must not be driven into shell/edit execution it never approved)
 *  - otherwise                            → prompt
 */
export function decideGate(
  tool: string,
  mode: PermissionMode,
  autoApply: boolean,
  env: GateEnv,
): GateOutcome {
  const action = gateActionFor(tool);
  if (!action) return "allow";
  if (!evaluate(action, mode, autoApply).needsPrompt) return "allow";
  if (env.yes) return "allow";
  if (!env.isTty) return "deny";
  return "prompt";
}
