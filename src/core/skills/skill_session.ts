// Per-run skill session assembly: discover → resolve → load → packet → policy.
// The one entry point the command layer calls; everything visible (header line,
// context summary) is produced here so every surface renders the same truth.

import { discoverSkills } from "./skill_discovery.js";
import { resolveExplicit, resolveAutomatic } from "./skill_resolver.js";
import { loadSkillBody } from "./skill_loader.js";
import { calculateSkillPolicy } from "./skill_policy.js";
import { buildSkillContextPacket, approximateTokens, type SkillContextPacket } from "./context_packet.js";
import { SkillError } from "./skill_errors.js";
import { SKILL_BOUNDS } from "./skill_bounds.js";
import { resolveInstructionGraph, buildInstructionContextPacket, type InstructionContextPacket } from "../instructions/instruction_resolver.js";
import type { InstructionGraph } from "../instructions/instruction_types.js";
import type { LoadedSkill, SkillPolicy } from "./skill_types.js";
import { recordWhy } from "../why_log.js";

export interface SkillSessionOptions {
  projectRoot: string;
  prompt: string;
  /** --skill <id> explicit invocation (id, short name, or command alias). */
  explicitSkill?: string;
  /** --no-skills: skip skills AND skill context entirely (deliberate). */
  noSkills?: boolean;
  /** Injected for tests. */
  builtinRoot?: string;
}

export interface SkillSession {
  loaded: readonly LoadedSkill[];
  policies: readonly SkillPolicy[];
  packet: SkillContextPacket | null;
  instructionPacket: InstructionContextPacket | null;
  instructionGraph: InstructionGraph;
  /** One-line run header, e.g. "Skills  aether/fix-ci@1.1.0 · 3.4k tokens". */
  headerLines: readonly string[];
}

/**
 * Assemble the skill + instruction context for one run. Throws SkillError with
 * a stable code on any refusal (untrusted, ambiguous, budget, ...) — the
 * command layer renders refusal + guidance and exits nonzero; it never
 * downgrades a refusal into a silent skill-free run.
 */
export function prepareSkillSession(options: SkillSessionOptions): SkillSession {
  const instructionGraph = resolveInstructionGraph(options.projectRoot);
  const instructionPacket = buildInstructionContextPacket(instructionGraph.sources, null);

  if (options.noSkills) {
    return {
      loaded: [],
      policies: [],
      packet: null,
      instructionPacket: instructionPacket.sources.length ? instructionPacket : null,
      instructionGraph,
      headerLines: headerFor([], instructionGraph),
    };
  }

  const index = discoverSkills({
    projectRoot: options.projectRoot,
    ...(options.builtinRoot ? { builtinRoot: options.builtinRoot } : {}),
  });

  const loaded: LoadedSkill[] = [];
  if (options.explicitSkill) {
    const resolved = resolveExplicit(index, options.explicitSkill);
    // Dependencies load under the same explicit invocation as their target.
    for (const descriptor of resolved.loadOrder) {
      loaded.push(loadSkillBody(descriptor, "explicit"));
    }
    recordWhy("skill-selection", resolved.candidate.descriptor.id + "@" + resolved.candidate.descriptor.version + " — " + resolved.candidate.reason);
  }
  // Automatic candidates fill remaining slots; a skill already loaded
  // explicitly is not loaded twice.
  const loadedIds = new Set(loaded.map((skill) => skill.descriptor.id));
  for (const match of resolveAutomatic(index, options.prompt)) {
    if (loadedIds.has(match.candidate.descriptor.id)) continue;
    if (loaded.length >= SKILL_BOUNDS.maxSkillsPerTurn) break;
    loaded.push(loadSkillBody(match.candidate.descriptor, "automatic"));
    loadedIds.add(match.candidate.descriptor.id);
    recordWhy("skill-selection", match.candidate.descriptor.id + " (automatic) — " + match.candidate.reason + " · confidence " + match.candidate.confidence.toFixed(2));
  }

  const packet = loaded.length ? buildSkillContextPacket(loaded) : null;
  const policies = loaded.map((skill) => calculateSkillPolicy(skill));
  return {
    loaded,
    policies,
    packet,
    instructionPacket: instructionPacket.sources.length ? instructionPacket : null,
    instructionGraph,
    headerLines: headerFor(loaded, instructionGraph),
  };
}

function headerFor(loaded: readonly LoadedSkill[], graph: InstructionGraph): string[] {
  const lines: string[] = [];
  if (loaded.length) {
    const names = loaded.map((skill) => skill.descriptor.id + "@" + skill.descriptor.version).join(" · ");
    const bytes = loaded.reduce((sum, skill) => sum + skill.loadedBytes, 0);
    const tokens = approximateTokens(bytes);
    const display = tokens >= 1000 ? (tokens / 1000).toFixed(1) + "k" : String(tokens);
    lines.push("Skills  " + names);
    lines.push("Context " + display + " tokens · " + graph.sources.length + " instruction source" + (graph.sources.length === 1 ? "" : "s"));
  } else if (graph.sources.length) {
    lines.push("Rules   " + graph.sources.map((source) => source.displayPath).join(" + "));
  }
  for (const conflict of graph.conflicts) {
    lines.push("Conflict " + conflict.topic + " — effective: " + conflict.effective + " (" + conflict.reason + ")");
    recordWhy("instruction-conflict", conflict.topic + ": effective '" + conflict.effective + "' — " + conflict.reason);
  }
  return lines;
}

export { SkillError };
