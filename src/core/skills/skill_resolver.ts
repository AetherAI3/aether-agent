// Explicit and automatic skill resolution over the metadata index.
// Pure functions — no filesystem, no model, no mutation.
//
// Explicit order: exact fully qualified id → exact unique short name →
// exact unique declared command alias → ambiguity error. No source-order
// preference ever breaks a tie silently.

import { SkillError } from "./skill_errors.js";
import { SKILL_BOUNDS } from "./skill_bounds.js";
import type { SkillCandidate, SkillDescriptor, SkillIndex, ResolvedSkill } from "./skill_types.js";

function shortName(id: string): string {
  return id.split("/")[1] ?? id;
}

function describeMatches(matches: readonly SkillDescriptor[]): string[] {
  return matches.map((descriptor) => descriptor.id + "@" + descriptor.version);
}

/**
 * Resolve one explicit reference. Trust/enable checks happen here so a caller
 * cannot accidentally load a resolved-but-untrusted skill: resolution of a
 * disabled or untrusted skill THROWS the structured refusal.
 */
export function resolveExplicit(index: SkillIndex, reference: string): ResolvedSkill {
  const query = reference.trim().toLowerCase();
  if (!query) throw new SkillError({ code: "skill.not_found", detail: "empty skill reference" });

  let matches: SkillDescriptor[];
  if (query.includes("/")) {
    matches = index.skills.filter((descriptor) => descriptor.id === query);
  } else {
    matches = index.skills.filter((descriptor) => shortName(descriptor.id) === query);
    if (matches.length === 0) {
      matches = index.skills.filter((descriptor) => descriptor.manifest.triggers.commands.includes(query));
    }
  }

  if (matches.length === 0) {
    // A skill directory that failed to validate is NOT absent — it is broken,
    // and saying "no skill matches" for it sends the user looking for a typo
    // in a name that is right. Carry the index errors into the refusal.
    const indexErrors = index.errors.map((entry) => entry.root + ": " + entry.errors.join("; "));
    throw new SkillError({
      code: "skill.not_found",
      skillId: reference,
      detail:
        "no skill matches '" +
        reference +
        "'" +
        (indexErrors.length
          ? " — " + indexErrors.length + " skill director" + (indexErrors.length === 1 ? "y" : "ies") + " failed to index and cannot load"
          : ""),
      ...(indexErrors.length ? { context: { index_errors: indexErrors } } : {}),
    });
  }
  if (matches.length > 1) {
    throw new SkillError({
      code: "skill.ambiguous",
      skillId: reference,
      detail: "'" + reference + "' matches more than one skill — use the fully qualified id",
      context: { matches: describeMatches(matches) },
    });
  }

  const descriptor = matches[0];
  if (!descriptor) throw new SkillError({ code: "skill.not_found", skillId: reference, detail: "no skill matches" });
  assertInvokable(descriptor);

  const candidate: SkillCandidate = {
    descriptor,
    invocation: "explicit",
    reason: query.includes("/") ? "exact id" : "unique name '" + query + "'",
    confidence: 1,
  };
  return { candidate, loadOrder: dependencyOrder(index, descriptor) };
}

export function assertInvokable(descriptor: SkillDescriptor): void {
  if (!descriptor.enabled) {
    throw new SkillError({ code: "skill.disabled", skillId: descriptor.id, detail: "skill is disabled — enable with: aether skills enable " + descriptor.id });
  }
  if (descriptor.trust === "changed") {
    throw new SkillError({
      code: "skill.changed",
      skillId: descriptor.id,
      detail: "skill content changed since it was trusted — inspect and re-trust: aether skills trust " + descriptor.id,
    });
  }
  if (descriptor.trust === "untrusted") {
    throw new SkillError({
      code: "skill.untrusted",
      skillId: descriptor.id,
      detail: "project skill is untrusted — inspect and trust: aether skills trust " + descriptor.id,
    });
  }
}

/**
 * Dependency-ordered load list (dependencies first, target last), with cycle
 * and missing-dependency detection and a bounded depth.
 */
export function dependencyOrder(index: SkillIndex, target: SkillDescriptor): SkillDescriptor[] {
  const byId = new Map(index.skills.map((descriptor) => [descriptor.id, descriptor]));
  const order: SkillDescriptor[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();

  const visit = (descriptor: SkillDescriptor, depth: number): void => {
    if (done.has(descriptor.id)) return;
    if (visiting.has(descriptor.id)) {
      throw new SkillError({
        code: "skill.dependency_cycle",
        skillId: target.id,
        detail: "dependency cycle through " + descriptor.id,
      });
    }
    if (depth > SKILL_BOUNDS.maxDependencyDepth) {
      throw new SkillError({
        code: "skill.dependency_cycle",
        skillId: target.id,
        detail: "dependency depth exceeds " + SKILL_BOUNDS.maxDependencyDepth,
      });
    }
    visiting.add(descriptor.id);
    for (const dependencyId of descriptor.manifest.dependencies.skills) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        throw new SkillError({
          code: "skill.dependency_missing",
          skillId: target.id,
          detail: "dependency not found: " + dependencyId,
        });
      }
      assertInvokable(dependency);
      visit(dependency, depth + 1);
    }
    visiting.delete(descriptor.id);
    done.add(descriptor.id);
    order.push(descriptor);
  };

  visit(target, 0);
  return order;
}

export interface AutomaticMatch {
  candidate: SkillCandidate;
}

/**
 * Bounded automatic selection over the metadata-only candidate catalog.
 * Considers ONLY skills already marked automatic (built-ins with
 * `automatic: true`, or user/project skills explicitly opted in — project ones
 * only when trusted; discovery already folded those rules into `automatic`).
 * Matching is deterministic phrase containment — no model call.
 */
export function resolveAutomatic(index: SkillIndex, prompt: string): AutomaticMatch[] {
  const text = prompt.toLowerCase();
  const matches: AutomaticMatch[] = [];
  for (const descriptor of index.skills) {
    if (!descriptor.automatic || !descriptor.enabled) continue;
    if (descriptor.trust === "untrusted" || descriptor.trust === "changed") continue;
    const phrase = descriptor.manifest.triggers.phrases.find((candidatePhrase) =>
      text.includes(candidatePhrase.toLowerCase()),
    );
    if (!phrase) continue;
    matches.push({
      candidate: {
        descriptor,
        invocation: "automatic",
        reason: "prompt contains trigger phrase '" + phrase + "'",
        confidence: Math.min(1, phrase.length / 40),
      },
    });
    if (matches.length >= SKILL_BOUNDS.maxAutomaticSkillsPerTurn) break;
  }
  return matches;
}
