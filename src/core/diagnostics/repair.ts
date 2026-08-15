// Safe repair — narrow, backup-first, receipted.
//
// Transaction per target: inspect → plan → back up → mutate atomically →
// verify → rollback on failure → append a metadata-only receipt line.
//
// Forbidden classes (never implement here): credential changes, git
// mutations, source edits, dependency installs.

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { configDir } from "../config.js";
import { skillSettingsPath, SKILL_SETTINGS_SCHEMA_VERSION } from "../skills/skill_settings.js";
import { trustStorePath, SKILL_TRUST_SCHEMA_VERSION } from "../skills/skill_trust.js";

export interface RepairPlan {
  repairId: string;
  targetClass: string;
  target: string;
  backupPath: string | null;
  detail: string;
}

export interface RepairAction {
  id: string;
  targetClass: string;
  describe(): string;
  /** Inspect and return one plan per applicable target; empty = nothing to do. */
  plan(now: string): RepairPlan[];
  apply(plan: RepairPlan): void;
  verify(plan: RepairPlan): boolean;
  rollback(plan: RepairPlan): void;
}

export interface RepairOutcome {
  plan: RepairPlan;
  applied: boolean;
  verified: boolean;
  rolledBack: boolean;
}

const STALE_TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function fileDigest(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

function atomicWriteJson(path: string, body: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

/** A store file that exists but no longer parses to its schema shape. */
function storeCorrupt(path: string, listKey: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return typeof raw !== "object" || raw === null || !Array.isArray(raw[listKey]);
  } catch {
    return true;
  }
}

interface SkillStoreTarget {
  path(): string;
  listKey: string;
  empty(): Record<string, unknown>;
}

const SKILL_STORES: SkillStoreTarget[] = [
  {
    path: skillSettingsPath,
    listKey: "settings",
    empty: () => ({ schema_version: SKILL_SETTINGS_SCHEMA_VERSION, settings: [] }),
  },
  {
    path: trustStorePath,
    listKey: "records",
    empty: () => ({ schema_version: SKILL_TRUST_SCHEMA_VERSION, records: [] }),
  },
];

function skillStoreFor(target: string): SkillStoreTarget | undefined {
  return SKILL_STORES.find((store) => store.path() === target);
}

const repairSkillIndex: RepairAction = {
  id: "repair.skill_index",
  targetClass: "skill-index-store",
  describe: () => "rebuild corrupt skill settings/trust store files (backup-first)",
  plan: () =>
    SKILL_STORES.filter((store) => storeCorrupt(store.path(), store.listKey)).map((store) => ({
      repairId: "repair.skill_index",
      targetClass: "skill-index-store",
      target: store.path(),
      backupPath: store.path() + ".corrupt-" + process.pid,
      detail: "rebuild corrupt store as empty after backing up",
    })),
  apply: (plan) => {
    const store = skillStoreFor(plan.target);
    if (!store) throw new Error("unknown skill store target");
    atomicWriteJson(plan.target, store.empty());
  },
  verify: (plan) => {
    const store = skillStoreFor(plan.target);
    return store != null && !storeCorrupt(plan.target, store.listKey);
  },
  rollback: (plan) => {
    if (plan.backupPath && existsSync(plan.backupPath)) copyFileSync(plan.backupPath, plan.target);
  },
};

const repairConfigDir: RepairAction = {
  id: "repair.config_dir",
  targetClass: "config-dir",
  describe: () => "create the missing local config directory (owner-only)",
  plan: () =>
    existsSync(configDir())
      ? []
      : [
          {
            repairId: "repair.config_dir",
            targetClass: "config-dir",
            target: configDir(),
            backupPath: null,
            detail: "create directory with mode 0700",
          },
        ],
  apply: (plan) => {
    mkdirSync(plan.target, { recursive: true, mode: 0o700 });
  },
  verify: (plan) => existsSync(plan.target) && statSync(plan.target).isDirectory(),
  rollback: () => {
    // Creating an empty directory is harmless; removing it on a failed verify
    // could race another writer — leave it in place.
  },
};

const repairStaleTmp: RepairAction = {
  id: "repair.stale_tmp",
  targetClass: "temp-files",
  describe: () => "remove *.tmp files in the config directory older than one day",
  plan: (now) => {
    const dir = configDir();
    if (!existsSync(dir)) return [];
    const cutoff = Date.parse(now) - STALE_TMP_MAX_AGE_MS;
    const plans: RepairPlan[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".tmp")) continue;
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          plans.push({
            repairId: "repair.stale_tmp",
            targetClass: "temp-files",
            target: full,
            backupPath: null,
            detail: "remove stale temp file",
          });
        }
      } catch {
        // unreadable entry — never a repair candidate
      }
    }
    return plans;
  },
  apply: (plan) => {
    rmSync(plan.target, { force: true });
  },
  verify: (plan) => !existsSync(plan.target),
  rollback: () => {
    // A deletion that failed verify left the file in place — nothing to undo.
  },
};

export const REPAIR_ACTIONS: readonly RepairAction[] = [repairSkillIndex, repairConfigDir, repairStaleTmp];

export function repairReceiptsPath(): string {
  return join(configDir(), "repair-receipts.jsonl");
}

export function planRepairs(now: string, actions: readonly RepairAction[] = REPAIR_ACTIONS): RepairPlan[] {
  const plans: RepairPlan[] = [];
  for (const action of actions) {
    try {
      plans.push(...action.plan(now));
    } catch {
      // Inspection must never break doctor — an unplannable action is skipped.
    }
  }
  return plans;
}

function appendReceipt(receipt: Record<string, unknown>): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  appendFileSync(repairReceiptsPath(), JSON.stringify(receipt) + "\n", "utf8");
}

export function executeRepairs(
  plans: readonly RepairPlan[],
  now: string,
  actions: readonly RepairAction[] = REPAIR_ACTIONS,
): RepairOutcome[] {
  const outcomes: RepairOutcome[] = [];
  for (const plan of plans) {
    const action = actions.find((candidate) => candidate.id === plan.repairId);
    if (!action) {
      outcomes.push({ plan, applied: false, verified: false, rolledBack: false });
      continue;
    }
    const beforeDigest = fileDigest(plan.target);
    let applied = false;
    let verified = false;
    let rolledBack = false;
    try {
      if (plan.backupPath && existsSync(plan.target)) copyFileSync(plan.target, plan.backupPath);
      action.apply(plan);
      applied = true;
      verified = action.verify(plan);
    } catch {
      verified = false;
    }
    if (applied && !verified) {
      try {
        action.rollback(plan);
        rolledBack = true;
      } catch {
        rolledBack = false;
      }
    }
    // Receipt is metadata-only: digests and paths, never file contents.
    appendReceipt({
      repair_id: plan.repairId,
      target_class: plan.targetClass,
      before_digest: beforeDigest,
      after_digest: fileDigest(plan.target),
      backup_path: plan.backupPath,
      verified,
      ts: now,
    });
    outcomes.push({ plan, applied, verified, rolledBack });
  }
  return outcomes;
}
