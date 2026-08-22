// Per-run skill session assembly: discover -> resolve -> load -> packet -> policy.
// The one entry point the command layer calls; everything visible (header line,
// context summary) is produced here so every surface renders the same truth.

import { createHash } from "node:crypto";
import { discoverSkills } from "./skill_discovery.js";
import { resolveExplicit, resolveAutomatic } from "./skill_resolver.js";
import { loadSkillBody } from "./skill_loader.js";
import { calculateSkillPolicy } from "./skill_policy.js";
import { buildSkillContextPacket, approximateTokens, type SkillContextPacket } from "./context_packet.js";
import { SkillError } from "./skill_errors.js";
import { SKILL_BOUNDS } from "./skill_bounds.js";
import { compareLock, projectLockPath, readSkillLock, userLockPath } from "./skill_lock.js";
import { resolveInstructionGraph, buildRunInstructionContextPacket, type InstructionContextPacket } from "../instructions/instruction_resolver.js";
import type { InstructionGraph } from "../instructions/instruction_types.js";
import type { LoadedSkill, SkillDescriptor, SkillInvocationKind, SkillPolicy, SkillTrustState } from "./skill_types.js";
import { AGENT_CONTEXT_CONTRACT_VERSION, type AgentContextPacket } from "../brain_protocol.js";
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

/** Whether a loaded skill's digest is pinned by a committed lock file. */
export type SkillLockState =
  | "builtin"    // shipped in the signed package; the artifact is the pin
  | "locked"     // lock file pins this exact digest
  | "unlocked"   // no lock entry for this skill
  | "drifted"    // lock pins a DIFFERENT digest than the one loaded
  | "unknown";   // the lock file exists but could not be read

/** One selection decision, kept so the header and the manifest can say WHY. */
export interface SkillSelection {
  id: string;
  version: string;
  digest: string;
  scope: string;
  invocation: SkillInvocationKind;
  trust: SkillTrustState;
  lock: SkillLockState;
  /** Resolver reason, e.g. "prompt contains trigger phrase 'fix the build'". */
  reason: string;
  /** 0..1; explicit invocation is always 1. */
  confidence: number;
  approxTokens: number;
}

/** What the session manifest and the portable handoff persist about this run. */
export interface SkillSessionProvenance {
  skills: readonly SkillSelection[];
  instructionSources: readonly string[];
  /** sha256 over the ordered source digests - one value that changes if any do. */
  instructionGraphDigest: string;
  conflicts: readonly string[];
  approxSkillTokens: number;
  approxInstructionTokens: number;
}

export interface SkillSession {
  loaded: readonly LoadedSkill[];
  policies: readonly SkillPolicy[];
  packet: SkillContextPacket | null;
  instructionPacket: InstructionContextPacket | null;
  instructionGraph: InstructionGraph;
  selections: readonly SkillSelection[];
  provenance: SkillSessionProvenance;
  /** True when --no-skills was passed: instructions still apply, skills do not. */
  skillsDisabled: boolean;
  /**
   * Everything the run should be told that is NOT a loaded skill: a manifest
   * that would not parse, a candidate dropped at the per-turn ceiling, a skill
   * whose digest no longer matches its lock. Empty means nothing was withheld,
   * so it must never be used to carry ordinary status.
   */
  notices: readonly string[];
  /** One-line run header, e.g. "Skills  aether/fix-ci@1.1.0 - 3.4k tokens". */
  headerLines: readonly string[];
}

/**
 * Assemble the skill + instruction context for one run. Throws SkillError with
 * a stable code on any refusal (untrusted, ambiguous, budget, ...) - the
 * command layer renders refusal + guidance and exits nonzero; it never
 * downgrades a refusal into a silent skill-free run.
 */
export function prepareSkillSession(options: SkillSessionOptions): SkillSession {
  const instructionGraph = resolveInstructionGraph(options.projectRoot);
  // The instruction graph is resolved even under --no-skills: AGENTS.md is the
  // PROJECT's rules, not a skill, and turning skills off must not silently turn
  // a project's own instructions off with them. The rules budget is applied
  // where the brief is composed (run_session.composeRules), which drops whole
  // low-precedence sources and names them rather than refusing the run.
  const instructionPacket = buildRunInstructionContextPacket(instructionGraph.sources);

  if (options.noSkills) {
    return {
      loaded: [],
      policies: [],
      packet: null,
      instructionPacket: instructionPacket.sources.length ? instructionPacket : null,
      instructionGraph,
      selections: [],
      provenance: buildProvenance([], instructionGraph, instructionPacket),
      skillsDisabled: true,
      notices: [],
      headerLines: headerFor([], instructionGraph, instructionPacket, true),
    };
  }

  const index = discoverSkills({
    projectRoot: options.projectRoot,
    ...(options.builtinRoot ? { builtinRoot: options.builtinRoot } : {}),
  });

  // Everything discovery knew but the run will not be using. Collected as it
  // happens, so the header states each omission instead of implying a clean
  // sweep of the skill tree.
  const notices: string[] = [];
  for (const error of index.errors) {
    notices.push(
      error.scope + " skill at " + error.root + " was NOT indexed: " + (error.errors[0] ?? "manifest invalid"),
    );
  }
  for (const descriptor of index.skills) {
    if (descriptor.scope !== "project") continue;
    if (descriptor.trust === "untrusted") {
      notices.push(descriptor.id + " is untrusted and was not eligible — review it: aether skills inspect " + descriptor.id);
    } else if (descriptor.trust === "changed") {
      notices.push(descriptor.id + " changed since it was trusted and was not eligible — re-review it: aether skills inspect " + descriptor.id);
    }
  }

  const loaded: LoadedSkill[] = [];
  // Reason/confidence are carried out of the resolver rather than re-derived:
  // the header, the why-log and the session manifest must all quote the SAME
  // sentence the resolver actually decided on.
  const decisions = new Map<string, { reason: string; confidence: number }>();
  if (options.explicitSkill) {
    const resolved = resolveExplicit(index, options.explicitSkill);
    // Dependencies load under the same explicit invocation as their target.
    for (const descriptor of resolved.loadOrder) {
      loaded.push(loadSkillBody(descriptor, "explicit"));
      decisions.set(
        descriptor.id,
        descriptor.id === resolved.candidate.descriptor.id
          ? { reason: resolved.candidate.reason, confidence: resolved.candidate.confidence }
          : { reason: "dependency of " + resolved.candidate.descriptor.id, confidence: 1 },
      );
    }
    recordWhy("skill-selection", resolved.candidate.descriptor.id + "@" + resolved.candidate.descriptor.version + " - " + resolved.candidate.reason);
  }
  // Automatic candidates fill remaining slots; a skill already loaded
  // explicitly is not loaded twice.
  const loadedIds = new Set(loaded.map((skill) => skill.descriptor.id));
  for (const match of resolveAutomatic(index, options.prompt)) {
    if (loadedIds.has(match.candidate.descriptor.id)) continue;
    if (loaded.length >= SKILL_BOUNDS.maxSkillsPerTurn) {
      // A candidate that matched and did not fit is not the same as one that
      // did not match. Say which happened.
      notices.push(
        match.candidate.descriptor.id +
          " matched (" +
          match.candidate.reason +
          ") but the per-turn ceiling of " +
          SKILL_BOUNDS.maxSkillsPerTurn +
          " was already full — it was NOT loaded",
      );
      continue;
    }
    loaded.push(loadSkillBody(match.candidate.descriptor, "automatic"));
    loadedIds.add(match.candidate.descriptor.id);
    decisions.set(match.candidate.descriptor.id, {
      reason: match.candidate.reason,
      confidence: match.candidate.confidence,
    });
    recordWhy("skill-selection", match.candidate.descriptor.id + " (automatic) - " + match.candidate.reason + " - confidence " + match.candidate.confidence.toFixed(2));
  }

  const packet = loaded.length ? buildSkillContextPacket(loaded) : null;
  const policies = loaded.map((skill) => calculateSkillPolicy(skill));
  const lockStates = resolveLockStates(options.projectRoot, loaded);
  const selections = loaded.map((skill) =>
    selectionFor(skill, decisions.get(skill.descriptor.id), lockStates.get(skill.descriptor.id) ?? "unknown"),
  );
  for (const selection of selections) {
    if (selection.lock === "drifted") {
      notices.push(selection.id + " digest does not match the lock file — re-lock it: aether skills lock");
    } else if (selection.lock === "unknown") {
      notices.push(selection.id + " lock state is UNKNOWN — the lock file exists but could not be read");
    }
  }
  return {
    loaded,
    policies,
    packet,
    instructionPacket: instructionPacket.sources.length ? instructionPacket : null,
    instructionGraph,
    selections,
    provenance: buildProvenance(selections, instructionGraph, instructionPacket),
    skillsDisabled: false,
    notices,
    headerLines: headerFor(loaded, instructionGraph, instructionPacket, false, selections),
  };
}

/**
 * The typed packet that rides to the brain. Returns null when there is nothing
 * to send - an empty packet and "no packet" must not be distinguishable by the
 * receiver, because they mean the same thing.
 *
 * Refuses (never truncates) when the serialized packet exceeds the wire bound:
 * a silently clipped instruction file is a rule the user believes is in force
 * and is not.
 */
export function buildAgentContextPacket(session: SkillSession): AgentContextPacket | null {
  if (!session.packet && !session.instructionPacket) return null;
  const packet: AgentContextPacket = {
    contract_version: AGENT_CONTEXT_CONTRACT_VERSION,
    skills: session.packet,
    instructions: session.instructionPacket,
  };
  const bytes = Buffer.byteLength(JSON.stringify(packet), "utf8");
  if (bytes > SKILL_BOUNDS.maxContextPacketBytes) {
    throw new SkillError({
      code: "skill.context_budget_exceeded",
      detail:
        "context packet is " +
        bytes +
        " bytes, over the " +
        SKILL_BOUNDS.maxContextPacketBytes +
        "-byte wire limit - load fewer skills, or trim the instruction sources",
      context: { bytes, limit: SKILL_BOUNDS.maxContextPacketBytes },
    });
  }
  return packet;
}

function selectionFor(
  skill: LoadedSkill,
  decision: { reason: string; confidence: number } | undefined,
  lock: SkillLockState,
): SkillSelection {
  const d: SkillDescriptor = skill.descriptor;
  return {
    id: d.id,
    version: d.version,
    digest: "sha256:" + d.sha256,
    scope: d.scope,
    invocation: skill.invocation,
    trust: d.trust,
    lock,
    // An empty reason would be a fabricated certainty; say so instead.
    reason: decision?.reason ?? "reason not recorded by the resolver",
    confidence: decision?.confidence ?? 0,
    approxTokens: approximateTokens(skill.loadedBytes),
  };
}

/**
 * Lock state per loaded skill. A lock file that exists but cannot be parsed
 * yields "unknown" - never "unlocked", which would read as a decision nobody
 * made.
 */
function resolveLockStates(
  projectRoot: string,
  loaded: readonly LoadedSkill[],
): Map<string, SkillLockState> {
  const states = new Map<string, SkillLockState>();
  const byScope = new Map<string, LoadedSkill[]>();
  for (const skill of loaded) {
    if (skill.descriptor.scope === "builtin") {
      states.set(skill.descriptor.id, "builtin");
      continue;
    }
    const bucket = byScope.get(skill.descriptor.scope) ?? [];
    bucket.push(skill);
    byScope.set(skill.descriptor.scope, bucket);
  }
  for (const [scope, skills] of byScope) {
    const path = scope === "project" ? projectLockPath(projectRoot) : userLockPath();
    const read = readSkillLock(path);
    if (!read.ok) {
      // A missing lock file is a real answer (nothing is pinned). A lock file
      // that exists and will not parse is NOT: reporting it as "unlocked"
      // would render an unreadable pin as a deliberate absence of one.
      const state: SkillLockState = read.missing ? "unlocked" : "unknown";
      for (const skill of skills) states.set(skill.descriptor.id, state);
      continue;
    }
    const discovered = new Map(skills.map((skill) => [skill.descriptor.id, skill.descriptor.sha256]));
    const drift = compareLock(read.lock, discovered);
    for (const skill of skills) {
      const id = skill.descriptor.id;
      states.set(id, drift.changed.includes(id) ? "drifted" : drift.unlocked.includes(id) ? "unlocked" : "locked");
    }
  }
  return states;
}

function buildProvenance(
  selections: readonly SkillSelection[],
  graph: InstructionGraph,
  instructionPacket: InstructionContextPacket,
): SkillSessionProvenance {
  return {
    skills: selections,
    instructionSources: instructionPacket.sources.map((source) => source.path),
    instructionGraphDigest: instructionGraphDigest(instructionPacket),
    conflicts: graph.conflicts.map((conflict) => conflict.topic + "=" + conflict.effective),
    approxSkillTokens: selections.reduce((sum, selection) => sum + selection.approxTokens, 0),
    approxInstructionTokens: approximateTokens(instructionBytesOf(instructionPacket)),
  };
}

/**
 * One digest over the whole instruction graph, in applicable order. Resume
 * compares this: if any source changed, moved, or was added, the value moves,
 * and the session is no longer running under the rules it was started with.
 */
export function instructionGraphDigest(packet: InstructionContextPacket): string {
  const hash = createHash("sha256");
  hash.update(String(packet.contract_version));
  for (const source of packet.sources) {
    hash.update(" " + source.kind + " " + source.path + " " + source.digest);
  }
  return "sha256:" + hash.digest("hex");
}

function headerFor(
  loaded: readonly LoadedSkill[],
  graph: InstructionGraph,
  instructionPacket: InstructionContextPacket,
  skillsDisabled: boolean,
  selections: readonly SkillSelection[] = [],
): string[] {
  const lines: string[] = [];
  if (skillsDisabled) {
    // --no-skills is a deliberate choice, so say what it did AND did not turn
    // off; a silent header here reads as "no skills matched".
    lines.push("Skills  off (--no-skills) - project instructions still apply");
  } else if (loaded.length) {
    const names = loaded.map((skill) => skill.descriptor.id + "@" + skill.descriptor.version).join(" + ");
    const bytes = loaded.reduce((sum, skill) => sum + skill.loadedBytes, 0);
    lines.push("Skills  " + names + " - " + tokenLabel(approximateTokens(bytes)));
    for (const selection of selections) {
      lines.push(
        "  - " +
          selection.id +
          " (" +
          selection.invocation +
          ", trust=" +
          selection.trust +
          ", lock=" +
          selection.lock +
          ") - " +
          selection.reason,
      );
    }
  }
  if (instructionPacket.sources.length) {
    lines.push("Rules   " + instructionPacket.sources.map((source) => source.path).join(" + "));
    lines.push("Context " + tokenLabel(approximateTokens(instructionBytesOf(instructionPacket))) + " of instructions");
  }
  for (const skipped of graph.skipped) {
    // A source dropped by a bound is NOT a source in force. Naming it is the
    // difference between a known limit and a rule the user believes applies.
    lines.push("Skipped " + skipped.path + " - " + skipped.reason);
  }
  for (const conflict of graph.conflicts) {
    lines.push("Conflict " + conflict.topic + " - effective: " + conflict.effective + " (" + conflict.reason + ")");
    recordWhy("instruction-conflict", conflict.topic + ": effective '" + conflict.effective + "' - " + conflict.reason);
  }
  return lines;
}

const instructionBytesOf = (packet: InstructionContextPacket): number =>
  packet.sources.reduce((sum, source) => sum + Buffer.byteLength(source.content, "utf8"), 0);

const tokenLabel = (tokens: number): string =>
  (tokens >= 1000 ? (tokens / 1000).toFixed(1) + "k" : String(tokens)) + " tokens";

export { SkillError };
