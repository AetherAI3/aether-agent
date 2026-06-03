// Autonomy / permission gating. Mirrors Aether Code desktop "skip-perms" +
// "auto-apply" so the terminal and the IDE enforce edits identically.
//
//   ask  → every edit/shell action prompts the user
//   auto → actions allowed; prompt only when autoApply is off
//   skip → fully autonomous, no prompts (skip-perms)
//
// Pure function — unit tested. The actual prompt I/O lives in the command layer.

import type { PermissionMode } from "../types.js";

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
