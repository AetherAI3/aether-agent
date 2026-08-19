// Skill and instruction health checks for `aether doctor` fast mode.
//
// Ported from PR #71's src/core/diagnostics/{skills,instructions}.ts onto this
// tree's three-axis HealthCheck contract. PR #71 modelled a result as a status
// plus a detail string, with configured/reachable/verified as plain booleans.
// Here each axis carries its own state and evidence, which is what keeps
// "checked and failed" distinct from "never checked".
//
// Every check below is filesystem-only: no network, no writes, no token spend.
// `reachable` is therefore not-applicable rather than a pass — there is no
// remote endpoint to reach — and `verified` is a real yes/no, because these
// checks genuinely exercise the files they report on during this run.
//
// Details carry counts, ids and short labels only. Never file bodies.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppContext } from "./context.js";
import { axis, notApplicable, type Axis } from "./health.js";
import type { CheckOutcome, DiagnosticCheckSpec } from "./diagnostics.js";
import { discoverSkills } from "./skills/skill_discovery.js";
import type { SkillDescriptor, SkillIndex } from "./skills/skill_types.js";
import { compareLock, projectLockPath, readSkillLock } from "./skills/skill_lock.js";
import { skillSettingsPath } from "./skills/skill_settings.js";
import { trustStorePath } from "./skills/skill_trust.js";
import { resolveInstructionGraph } from "./instructions/instruction_resolver.js";
import type { InstructionGraph } from "./instructions/instruction_types.js";

/** Nothing here talks to a network, so the axis is absent rather than passing. */
const LOCAL_ONLY = "local filesystem — no remote to reach";

/**
 * Shared shape for these checks: a local invariant either holds or it does not,
 * and either way this run actually looked. Keeping the mapping in one place is
 * what stops a future check from quietly claiming a `verified` it did not earn.
 */
function localOutcome(ok: boolean, evidence: string, severity: CheckOutcome["severity"]): CheckOutcome {
  const state: Axis["state"] = ok ? "yes" : "no";
  return {
    configured: axis(state, { evidence }),
    reachable: notApplicable(LOCAL_ONLY),
    verified: axis(state),
    severity: ok ? "info" : severity,
  };
}

/** True when a local skill store exists but is not a schema-shaped object. */
function storeCorrupt(path: string, listKey: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return typeof raw !== "object" || raw === null || !Array.isArray(raw[listKey]);
  } catch {
    return true;
  }
}

/**
 * Discovery walks the filesystem and four checks want the same answer, so
 * memoize: one `aether doctor` run indexes once.
 */
function memoize<T>(fn: () => T): () => T {
  let cached: { value: T } | null = null;
  return () => {
    if (cached === null) cached = { value: fn() };
    return cached.value;
  };
}

export function skillCheckSpecs(ctx: AppContext): DiagnosticCheckSpec[] {
  const projectRoot = resolve(ctx.flags.cwd);
  const skillIndex = memoize<SkillIndex>(() => discoverSkills({ projectRoot }));
  const instructionGraph = memoize<InstructionGraph>(() => resolveInstructionGraph(projectRoot));

  return [
    {
      id: "skills.index",
      category: "skills",
      title: "Skill index",
      run: (): CheckOutcome => {
        const corrupt =
          Number(storeCorrupt(skillSettingsPath(), "settings")) +
          Number(storeCorrupt(trustStorePath(), "records"));
        if (corrupt > 0) {
          return localOutcome(false, `${corrupt} skill store file(s) unreadable — run: aether doctor --fix`, "error");
        }
        const index = skillIndex();
        return localOutcome(
          index.errors.length === 0,
          index.errors.length === 0
            ? `${index.skills.length} skill(s) indexed`
            : `${index.skills.length} skill(s) indexed, ${index.errors.length} index error(s) — run: aether skills check --all`,
          "warning",
        );
      },
    },
    {
      id: "skills.lock",
      category: "skills",
      title: "Skill lockfile",
      run: (): CheckOutcome => {
        const projectSkills = skillIndex().skills.filter((descriptor: SkillDescriptor) => descriptor.scope === "project");
        const lock = readSkillLock(projectLockPath(projectRoot));
        if (!lock.ok) {
          // No project skills means no lock is owed — that is a pass, not a gap.
          if (lock.missing && projectSkills.length === 0) {
            return localOutcome(true, "no project skills, no lock required", "warning");
          }
          return localOutcome(
            false,
            `${lock.missing ? "lock file missing" : "lock file unreadable"} — run: aether skills lock`,
            "warning",
          );
        }
        const drift = compareLock(
          lock.lock,
          new Map(projectSkills.map((descriptor: SkillDescriptor) => [descriptor.id, descriptor.sha256])),
        );
        const drifted = drift.unlocked.length + drift.changed.length + drift.missing.length;
        return localOutcome(
          drifted === 0,
          drifted === 0
            ? "lock matches discovered project skills"
            : `lock drift: ${drift.unlocked.length} unlocked, ${drift.changed.length} changed, ${drift.missing.length} missing — run: aether skills lock`,
          "warning",
        );
      },
    },
    {
      id: "skills.trust",
      category: "skills",
      title: "Project skill trust",
      run: (): CheckOutcome => {
        // A content change invalidates prior trust, so "changed" counts as
        // untrusted here rather than as a still-approved skill.
        const untrusted = skillIndex().skills.filter(
          (descriptor: SkillDescriptor) =>
            descriptor.scope === "project" &&
            (descriptor.trust === "untrusted" || descriptor.trust === "changed"),
        );
        return localOutcome(
          untrusted.length === 0,
          untrusted.length === 0
            ? "no project skills awaiting trust review"
            : `${untrusted.length} project skill(s) untrusted or changed — run: aether skills trust <id>`,
          "warning",
        );
      },
    },
    {
      id: "skills.evals",
      category: "skills",
      title: "Skill eval manifests",
      run: (): CheckOutcome => {
        const index = skillIndex();
        if (index.skills.length === 0) return localOutcome(true, "no skills discovered", "info");
        const missing = index.skills.filter((descriptor: SkillDescriptor) => !descriptor.manifest.health.evalManifest);
        return localOutcome(
          missing.length === 0,
          missing.length === 0
            ? "all skills declare eval manifests"
            : `${missing.length} of ${index.skills.length} skill(s) declare no eval manifest — add health.eval_manifest`,
          "info",
        );
      },
    },
    {
      id: "instructions.graph",
      category: "instructions",
      title: "Instruction sources",
      run: (): CheckOutcome => {
        const graph = instructionGraph();
        // A source that failed to parse counts even when it emitted no warning
        // of its own — silently dropping an AGENTS.md is the failure.
        const parseWarnings =
          graph.sources.reduce(
            (sum, source) => sum + source.warnings.length + (source.parseStatus === "ok" ? 0 : 1),
            0,
          ) + graph.skipped.length;
        return localOutcome(
          parseWarnings === 0,
          parseWarnings === 0
            ? `${graph.sources.length} instruction source(s), no parse warnings`
            : `${graph.sources.length} instruction source(s), ${parseWarnings} parse warning(s) — review the flagged files`,
          "warning",
        );
      },
    },
    {
      id: "instructions.conflicts",
      category: "instructions",
      title: "Instruction conflicts",
      run: (): CheckOutcome => {
        const conflicts = instructionGraph().conflicts;
        return localOutcome(
          conflicts.length === 0,
          conflicts.length === 0
            ? "no instruction conflicts detected"
            : `${conflicts.length} conflict(s): ${conflicts.map((conflict) => conflict.topic).join(", ")} — align the higher-precedence source`,
          "warning",
        );
      },
    },
  ];
}
