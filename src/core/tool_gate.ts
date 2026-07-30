// tool_gate.ts — the single permission gate every brain-emitted tool call passes
// through before the host executes it.
//
// This lived inline in commands/code.ts, which meant `code` enforced it and the
// local `chat` turn did not: the same ToolExecutor.run -> spawnSync sink was
// reachable ungated from one caller and gated from the other. A guard that only
// some callers apply is not a guard, so the construction lives here and both
// commands import it.
//
// Policy is unchanged — decideGate (core/autonomy.ts) remains the single source of
// truth for the decision, and this module only performs the prompt I/O it asks for:
//
//   interactive terminal      -> y/N prompt before the command runs
//   --yes / permissionMode    -> explicit operator opt-out, no prompt
//   non-interactive terminal  -> FAIL CLOSED, the call is refused

import { decideGate } from "./autonomy.js";
import type { PermissionMode } from "../types.js";

export type ToolGate = (call: {
  name: string;
  args: Record<string, unknown>;
}) => Promise<boolean>;

export interface ToolGateOptions {
  permissionMode: PermissionMode;
  autoApply: boolean;
  /** `--yes` / auto-confirm was passed. */
  yes: boolean;
  /** Host prompt; returns true when the operator approves. */
  confirm: (question: string) => Promise<boolean>;
  /** Overridable for tests; defaults to the real stdin TTY check. */
  isTty?: boolean;
}

const MAX_SHOWN = 200;

/** The argument most worth showing the operator when asking about a call. */
function detailOf(args: Record<string, unknown>): string {
  const detail = String(args["command"] ?? args["path"] ?? args["message"] ?? "");
  return detail.length > MAX_SHOWN ? detail.slice(0, MAX_SHOWN - 3) + "…" : detail;
}

export function makeToolGate(opts: ToolGateOptions): ToolGate {
  return async ({ name, args }) => {
    const isTty = opts.isTty ?? Boolean(process.stdin.isTTY);
    const outcome = decideGate(name, opts.permissionMode, opts.autoApply, {
      yes: opts.yes,
      isTty,
    });
    if (outcome === "allow") return true;
    if (outcome === "deny") {
      process.stderr.write(
        `✗ blocked ${name} — permission mode "${opts.permissionMode}" needs confirmation but there is no TTY.\n` +
          `  re-run with --yes, or set a less strict mode: aether config set permissionMode skip\n`,
      );
      return false;
    }
    const shown = detailOf(args);
    return opts.confirm(`\n⚠ ${name}${shown ? ` ${shown}` : ""} — run it? [y/N] `);
  };
}

/** The result fed back to the brain when a call is refused, so the turn continues honestly. */
export function deniedResult(name: string): { output: string; exitCode: number } {
  return { output: `[denied: ${name} not approved by user]`, exitCode: 1 };
}
