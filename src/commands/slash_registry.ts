// src/commands/slash_registry.ts — the single source of truth for every slash
// command: name, usage, one-line summary, help section. /help, `/help <cmd>`,
// Tab completion, and did-you-mean suggestions all read THIS table, so a new
// command added here is automatically discoverable everywhere. A test asserts
// the table stays in sync with the handleSlash switch.

import {
  commandNames,
  completeCommand,
  findRegisteredCommand,
  suggestRegisteredCommand,
  validateCommandRegistry,
} from "../core/command_registry.js";

export interface SlashCommand {
  name: string;
  /** Argument shape shown in help, e.g. "<n|id>". Empty = no args. */
  args?: string;
  summary: string;
  section: string;
  /** Aliases dispatched by the same case (shown inline in help). */
  aliases?: string[];
  /** Listed only in `/help <cmd>`, not the main help (niche/legacy). */
  hidden?: boolean;
}

export const SLASH_SECTIONS = [
  "Session",
  "Agent Modes",
  "Steering",
  "Context & Limits",
  "Goals & Workflows",
  "Vault",
  "Orchestra",
  "UVT Tools",
  "Media",
  "HUD",
] as const;

export const SLASH_COMMANDS: SlashCommand[] = [
  // ── Session ──
  { name: "help", args: "[command]", summary: "this help, or detail for one command", section: "Session" },
  { name: "models", summary: "interactive model picker", section: "Session" },
  { name: "model", args: "<n|id>", summary: "switch model (no arg → picker)", section: "Session" },
  { name: "agent", args: "<n|id>", summary: "switch orchestrator (or picker)", section: "Session" },
  { name: "agents", summary: "active agent sessions + UVT", section: "Session" },
  { name: "tier", summary: "plan tier + default model", section: "Session" },
  // effort tier persists to config and rides TaskCommand.effort into every
  // `aether code` run — see setEffort() in slash.ts for the wire contract.
  { name: "effort", args: "[tier|1-5]", summary: "effort dial (LOW to CODEPRO), drives aether code", section: "Session" },
  { name: "audit", args: "[n]", summary: "recent audit trail", section: "Session" },
  { name: "doctor", args: "[deep]", summary: "structured runtime diagnostics", section: "Session" },
  { name: "clear", summary: "clear screen", section: "Session" },
  { name: "exit", aliases: ["quit"], summary: "leave the REPL", section: "Session" },
  { name: "mcp", args: "[list|doctor|repair]", summary: "manage and diagnose MCP servers", section: "Session" },

  // ── Agent Modes (prompt rewrites) ──
  { name: "autonomous-execution", args: "<task>", summary: "execute without asking", section: "Agent Modes" },
  { name: "subagent-driven-execution", args: "<task>", summary: "decompose + delegate", section: "Agent Modes" },
  { name: "self-review", summary: "review your own recent work", section: "Agent Modes" },
  { name: "recon", args: "<topic>", summary: "deep reconnaissance", section: "Agent Modes" },
  { name: "plan", args: "<topic>", summary: "write implementation plan", section: "Agent Modes" },
  { name: "research", args: "<topic>", summary: "research-gather-summarize", section: "Agent Modes" },
  { name: "review", summary: "full project review + summary", section: "Agent Modes" },
  { name: "code-review", summary: "sweep: clean up + simplify", section: "Agent Modes" },
  { name: "writing-skills", summary: "author reusable skills", section: "Agent Modes" },
  { name: "writing-plans", args: "<topic>", summary: "write plan to .hermes/plans/", section: "Agent Modes" },

  // ── Steering ──
  { name: "queue", args: "<task>", summary: "queue a task (runs when current finishes)", section: "Steering" },
  { name: "steer", args: "<guidance>", summary: "mid-task steering for the next turn", section: "Steering" },
  { name: "btw", args: "<note>", summary: "contextual side note (accumulates)", section: "Steering" },

  // ── Context & Limits ──
  { name: "pin", args: "<path> [reason]", summary: "force file into persistent context (pin list)", section: "Context & Limits" },
  { name: "drop", args: "<path>", summary: "evict file from context", section: "Context & Limits" },
  { name: "snapshot", args: "[resume <id>]", summary: "save session state / reload a snapshot", section: "Context & Limits" },
  { name: "limit", args: "<uvt>", summary: "cap UVT spend for this session", section: "Context & Limits" },
  { name: "token-budget", args: "<uvt>", summary: "alias for /limit", section: "Context & Limits", hidden: true },
  { name: "audit-receipt", args: "[n]", summary: "verified log of tool calls + UVT", section: "Context & Limits" },
  { name: "rollback", args: "[n]", summary: "revert last n filesystem changes", section: "Context & Limits" },
  { name: "logs-view", aliases: ["logs"], summary: "interactive session log browser", section: "Context & Limits" },

  // ── Goals & Workflows ──
  { name: "goal", args: "<desc|view|start|pause|resume|cancel|complete|note>", summary: "create/manage a goal (agent plans phases)", section: "Goals & Workflows" },
  { name: "goals", args: "[id]", summary: "list saved goals / view one", section: "Goals & Workflows" },
  { name: "memory", args: "[status|inspect|forget|prune]", summary: "inspect and manage scoped memory", section: "Goals & Workflows" },
  { name: "workflow", summary: "workflow status", section: "Goals & Workflows" },
  { name: "workflow-templates", summary: "list workflow templates", section: "Goals & Workflows" },
  { name: "workflow-template", args: "<n>", summary: "load a workflow template", section: "Goals & Workflows" },

  // ── Vault ──
  { name: "vault", summary: "vault status", section: "Vault" },
  { name: "vault-context", summary: "load vault context into the session", section: "Vault" },
  { name: "vault-search", args: "<q>", summary: "search notes", section: "Vault" },
  { name: "vault-recent", args: "[n]", summary: "recent notes", section: "Vault" },
  { name: "vault-project", args: "<name>", summary: "project notes", section: "Vault" },
  { name: "vault-tag", args: "<tag>", summary: "notes by tag", section: "Vault" },
  { name: "vault-tree", summary: "vault folder tree", section: "Vault" },

  // ── Orchestra ──
  { name: "delegate", args: "<model> <task>", summary: "delegate a sub-task to a worker model", section: "Orchestra" },
  { name: "tree", summary: "live orchestration hierarchy", section: "Orchestra" },
  { name: "broadcast", args: '"<msg>"', summary: "inject a directive to all sub-agents", section: "Orchestra" },
  { name: "gather", args: "<id|all>", summary: "merge completed work to staging", section: "Orchestra" },

  // ── UVT Tools ──
  { name: "scaffold", args: "<type> <name>", summary: "generate boilerplate (component|route|module)", section: "UVT Tools" },
  { name: "port", args: "<file> <lang>", summary: "translate code to another language", section: "UVT Tools" },
  { name: "test-drive", args: '"<target>"', summary: "auto-test: generate, run, fix, repeat", section: "UVT Tools" },
  { name: "bench", args: "<target>", summary: "profile & optimize code", section: "UVT Tools" },
  { name: "purge", summary: "flush transient context & temp files", section: "UVT Tools" },
  { name: "stage-diff", summary: "unified diff + commit message", section: "UVT Tools" },
  { name: "revert", args: "<file|step>", summary: "surgical rollback", section: "UVT Tools" },

  // ── Media ──
  { name: "photogen", args: "<prompt> [--model --aspect]", summary: "generate images", section: "Media" },
  { name: "frame", args: "<prompt>", summary: "generate a single styled frame", section: "Media" },
  { name: "re-frame", args: "<prompt>", summary: "re-run the last image with a new prompt", section: "Media" },
  { name: "videogen", args: "<prompt> [--model --duration]", summary: "generate video", section: "Media" },
  { name: "sequence", args: "<prompt>", summary: "cinematic multi-shot video", section: "Media" },
  { name: "animate", args: "<prompt>", summary: "animate the last image", section: "Media" },
  { name: "re-cut", args: "<prompt>", summary: "re-edit the last video", section: "Media" },
  { name: "output", args: "[open|clean|list]", summary: "manage generated media files", section: "Media" },
  { name: "storyboard", args: "<title>", summary: "multi-scene storyboard pipeline", section: "Media" },

  // ── HUD ──
  { name: "add", args: "<element>", summary: "add a HUD overlay (context-bar, timer, tools, help, health, status)", section: "HUD" },
  { name: "hud", args: "remove|list|clear", summary: "manage HUD overlay elements", section: "HUD" },
];
const registryErrors = validateCommandRegistry(SLASH_COMMANDS, SLASH_SECTIONS);
if (registryErrors.length) throw new Error(`Invalid slash registry: ${registryErrors.join("; ")}`);

/** Every dispatchable name (canonical + aliases). */
export function allCommandNames(): string[] {
  return commandNames(SLASH_COMMANDS);
}

export function findCommand(name: string): SlashCommand | undefined {
  return findRegisteredCommand(SLASH_COMMANDS, name);
}

/**
 * Tab completion for a partial slash input ("/mod" → "/model…").
 * Returns the longest unambiguous completion plus all matches; `completed`
 * includes a trailing space when exactly one command matches.
 */
export function completeSlash(input: string): { completed: string | null; matches: string[] } {
  if (!input.startsWith("/") || /\s/.test(input)) return { completed: null, matches: [] };
  const partial = input.slice(1).toLowerCase();
  const result = completeCommand(partial, allCommandNames());
  const completed = result.completed ? "/" + result.completed : null;
  return { completed, matches: result.matches };
}

/** Did-you-mean for an unknown command (edit distance ≤ 2, closest first). */
export function suggestCommand(name: string): string | null {
  return suggestRegisteredCommand(name, allCommandNames());
}
