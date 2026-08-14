// InstructionResolver — precedence, per-file applicability, conflict detection.
// Pure over discovered sources; no filesystem access here.

import { INSTRUCTION_PRECEDENCE, type InstructionConflict, type InstructionGraph, type InstructionSource } from "./instruction_types.js";
import { discoverInstructionSources } from "./instruction_discovery.js";

/** Cursor-subset glob → RegExp ( ** , * , ? only — discovery rejected the rest). */
function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") { pattern += ".*"; index++; }
      else pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else if (char != null) {
      pattern += char.replace(/[.+^${}()|[\]\\]/, "\\$&");
    }
  }
  return new RegExp("^" + pattern + "$");
}

/** Does one source apply to a project-relative file path (posix separators)? */
export function sourceAppliesTo(source: InstructionSource, relativePath: string | null): boolean {
  if (source.parseStatus === "unsupported-syntax") return false;
  if (relativePath == null) {
    // No active file: subtree- or glob-scoped sources do not apply globally.
    return source.scopeDir === "" && source.globs == null;
  }
  if (source.scopeDir !== "" && relativePath !== source.scopeDir && !relativePath.startsWith(source.scopeDir + "/")) {
    return false;
  }
  if (source.globs != null) {
    return source.globs.some((glob) => globToRegExp(glob).test(relativePath));
  }
  return true;
}

/** Applicable sources for a path, highest precedence first; nearer nested AGENTS.md outranks farther. */
export function applicableSources(
  sources: readonly InstructionSource[],
  relativePath: string | null,
): InstructionSource[] {
  return sources
    .filter((source) => sourceAppliesTo(source, relativePath))
    .sort((a, b) => {
      const rank = INSTRUCTION_PRECEDENCE[b.kind] - INSTRUCTION_PRECEDENCE[a.kind];
      if (rank !== 0) return rank;
      // Deeper nested scope is "nearer" and wins between two nested AGENTS.md.
      return b.scopeDir.length - a.scopeDir.length;
    });
}

const TEST_COMMAND_PATTERN =
  /(?:^|[`\s])((?:npm|pnpm|yarn)\s+(?:run\s+)?[\w:.-]*test[\w:.-]*|pytest[\w ./-]*|go\s+test[\w ./-]*|cargo\s+test[\w -]*)/gim;

/** Extract declared test commands — the highest-signal conflict class. */
export function extractTestCommands(content: string): string[] {
  const commands = new Set<string>();
  for (const match of content.matchAll(TEST_COMMAND_PATTERN)) {
    const command = match[1]?.trim().replace(/[`.,;]+$/, "");
    if (command) commands.add(command);
  }
  return [...commands];
}

export function detectConflicts(ordered: readonly InstructionSource[]): InstructionConflict[] {
  const conflicts: InstructionConflict[] = [];
  const entries: { source: InstructionSource; value: string }[] = [];
  for (const source of ordered) {
    for (const command of extractTestCommands(source.content)) {
      entries.push({ source, value: command });
    }
  }
  const distinct = new Set(entries.map((entry) => entry.value));
  if (distinct.size > 1 && entries.length > 1) {
    const winner = entries[0];
    if (winner) {
      conflicts.push({
        topic: "test command",
        entries,
        effective: winner.value,
        reason: sourceLabel(winner.source) + " has higher precedence",
      });
    }
  }
  return conflicts;
}

export function sourceLabel(source: InstructionSource): string {
  switch (source.kind) {
    case "aether-project": return "canonical Aether project instruction (" + source.displayPath + ")";
    case "agents-root": return "root AGENTS.md";
    case "agents-nested": return "nested " + source.displayPath;
    case "aether-user": return "user-level Aether instruction";
    default: return "compatibility import (" + source.displayPath + ")";
  }
}

/** Build the full graph for a project: discovery + global-scope conflict pass. */
export function resolveInstructionGraph(projectRoot: string): InstructionGraph {
  const { sources, skipped } = discoverInstructionSources(projectRoot);
  const ordered = applicableSources(sources, null);
  return { sources, conflicts: detectConflicts(ordered), skipped };
}

export const INSTRUCTION_CONTEXT_CONTRACT_VERSION = 1;

export interface InstructionContextSource {
  kind: string;
  path: string;
  scope: string;
  digest: string;
  content: string;
}

export interface InstructionContextPacket {
  contract_version: number;
  sources: readonly InstructionContextSource[];
}

/**
 * Transport packet for the brain. Provenance rides with every source so the
 * model and the UI can attribute guidance; content is data, not system policy.
 */
export function buildInstructionContextPacket(
  sources: readonly InstructionSource[],
  relativePath: string | null,
): InstructionContextPacket {
  return {
    contract_version: INSTRUCTION_CONTEXT_CONTRACT_VERSION,
    sources: applicableSources(sources, relativePath).map((source) => ({
      kind: source.kind,
      path: source.displayPath,
      scope: source.scopeDir === "" ? "project" : source.scopeDir,
      digest: "sha256:" + source.sha256,
      content: source.content,
    })),
  };
}
