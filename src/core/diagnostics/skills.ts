// Skill health checks — fast-mode, filesystem-only, metadata-only. Details
// carry counts and ids, never file contents.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compareLock, projectLockPath, readSkillLock } from "../skills/skill_lock.js";
import { skillSettingsPath } from "../skills/skill_settings.js";
import { trustStorePath } from "../skills/skill_trust.js";
import type { CheckSpec } from "./registry.js";

/** True when a local skill store file exists but is not a schema-shaped object. */
function storeCorrupt(path: string, listKey: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return typeof raw !== "object" || raw === null || !Array.isArray(raw[listKey]);
  } catch {
    return true;
  }
}

export function skillsChecks(): CheckSpec[] {
  return [
    {
      id: "skills.index",
      category: "skills",
      mode: "fast",
      severity: "warning",
      repairId: "repair.skill_index",
      run: (deps) => {
        const index = deps.skillIndex();
        const corruptStores =
          Number(storeCorrupt(skillSettingsPath(), "settings")) + Number(storeCorrupt(trustStorePath(), "records"));
        if (corruptStores > 0) {
          return {
            status: "warn" as const,
            detail: corruptStores + " skill store file(s) corrupt — next: aether doctor --fix",
          };
        }
        return {
          status: index.errors.length ? ("warn" as const) : ("pass" as const),
          detail:
            index.skills.length +
            " skill(s) indexed, " +
            index.errors.length +
            " index error(s)" +
            (index.errors.length ? " — next: aether skills check --all" : ""),
        };
      },
    },
    {
      id: "skills.lock",
      category: "skills",
      mode: "fast",
      severity: "warning",
      run: (deps) => {
        const index = deps.skillIndex();
        const projectSkills = index.skills.filter((descriptor) => descriptor.scope === "project");
        const lock = readSkillLock(projectLockPath(resolve(deps.ctx.flags.cwd)));
        if (!lock.ok) {
          if (lock.missing && projectSkills.length === 0) {
            return { status: "pass" as const, detail: "no project skills, no lock required" };
          }
          return {
            status: "warn" as const,
            detail:
              (lock.missing ? "lock file missing" : "lock file unreadable") +
              " — next: aether skills lock",
          };
        }
        const drift = compareLock(
          lock.lock,
          new Map(projectSkills.map((descriptor) => [descriptor.id, descriptor.sha256])),
        );
        const drifted = drift.unlocked.length + drift.changed.length + drift.missing.length;
        if (drifted === 0) return { status: "pass" as const, detail: "lock matches discovered project skills" };
        return {
          status: "warn" as const,
          detail:
            "lock drift: " +
            drift.unlocked.length + " unlocked, " +
            drift.changed.length + " changed, " +
            drift.missing.length + " missing — next: aether skills lock",
        };
      },
    },
    {
      id: "skills.trust",
      category: "skills",
      mode: "fast",
      severity: "warning",
      run: (deps) => {
        const index = deps.skillIndex();
        const untrusted = index.skills.filter(
          (descriptor) =>
            descriptor.scope === "project" && (descriptor.trust === "untrusted" || descriptor.trust === "changed"),
        );
        if (untrusted.length === 0) {
          return { status: "pass" as const, detail: "no project skills awaiting trust review" };
        }
        return {
          status: "warn" as const,
          detail: untrusted.length + " project skill(s) untrusted or changed — next: aether skills trust <id>",
        };
      },
    },
    {
      id: "skills.evals",
      category: "skills",
      mode: "fast",
      severity: "info",
      run: (deps) => {
        const index = deps.skillIndex();
        const missing = index.skills.filter((descriptor) => !descriptor.manifest.health.evalManifest);
        if (index.skills.length === 0) return { status: "pass" as const, detail: "no skills discovered" };
        if (missing.length === 0) return { status: "pass" as const, detail: "all skills declare eval manifests" };
        return {
          status: "warn" as const,
          detail: missing.length + " of " + index.skills.length + " skill(s) declare no eval manifest — next: add health.eval_manifest",
        };
      },
    },
  ];
}
