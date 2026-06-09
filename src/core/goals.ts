// goals.ts — persistent goal chain for the terminal agent.
// Mirrors AetherCloud desktop task-chain model, adapted for file-based CLI.

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// ── Types ───────────────────────────────────────────────────────────

export type PhaseStatus = "pending" | "in_progress" | "complete" | "failed" | "skipped";
export type GoalStatus = "idle" | "running" | "paused" | "complete" | "halted" | "failed";
export type TaskMiniStatus = "queued" | "running" | "complete" | "failed" | "skipped";

export interface GoalTask {
  id: string;
  title: string;
  status: TaskMiniStatus;
}

export interface GoalPhase {
  id: string;
  title: string;
  description: string;
  status: PhaseStatus;
  tasks: GoalTask[];
  userNote: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Goal {
  id: string;
  title: string;
  phases: GoalPhase[];
  status: GoalStatus;
  activePhaseId?: string;
  selectedPhaseId?: string;
  createdAt: string;
  completedAt?: string;
}

// ── Store ────────────────────────────────────────────────────────────

const GOALS_DIR = join(homedir(), ".config", "aether");
const GOALS_FILE = join(GOALS_DIR, "goals.json");

function ensureDir(): void {
  if (!existsSync(GOALS_DIR)) mkdirSync(GOALS_DIR, { recursive: true });
}

export function loadGoals(): Goal[] {
  try {
    if (!existsSync(GOALS_FILE)) return [];
    const raw = readFileSync(GOALS_FILE, "utf8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveGoals(goals: Goal[]): void {
  ensureDir();
  writeFileSync(GOALS_FILE, JSON.stringify(goals, null, 2), { mode: 0o600 });
}

export function upsertGoal(goal: Goal): void {
  const all = loadGoals();
  const idx = all.findIndex((g) => g.id === goal.id);
  if (idx >= 0) all[idx] = goal;
  else all.push(goal);
  saveGoals(all);
}

export function deleteGoal(id: string): void {
  const all = loadGoals().filter((g) => g.id !== id);
  saveGoals(all);
}

export function getGoal(id: string): Goal | undefined {
  return loadGoals().find((g) => g.id === id);
}

export function getActiveGoal(): Goal | undefined {
  return loadGoals().find((g) => g.status === "running" || g.status === "paused");
}

export function newGoal(title: string): Goal {
  return {
    id: `goal_${randomUUID().slice(0, 8)}`,
    title,
    phases: [],
    status: "idle",
    createdAt: new Date().toISOString(),
  };
}

export function newPhase(idx: number, title: string, description: string): GoalPhase {
  return {
    id: `phase-${idx}`,
    title,
    description,
    status: "pending",
    tasks: [],
    userNote: "",
    createdAt: new Date().toISOString(),
  };
}

export function newTask(title: string): GoalTask {
  return { id: `t_${randomUUID().slice(0, 6)}`, title, status: "queued" };
}

export function selectPhase(goal: Goal, phaseId: string): Goal {
  const copy = JSON.parse(JSON.stringify(goal)) as Goal;
  copy.selectedPhaseId = phaseId;
  return copy;
}

export function setPhaseNote(goal: Goal, phaseId: string, note: string): Goal {
  const copy = JSON.parse(JSON.stringify(goal)) as Goal;
  const phase = copy.phases.find((p) => p.id === phaseId);
  if (phase) phase.userNote = note;
  return copy;
}

export function startGoal(goal: Goal): Goal {
  const copy = JSON.parse(JSON.stringify(goal)) as Goal;
  copy.status = "running";
  const first = copy.phases.find((p) => p.status === "pending");
  if (first) {
    first.status = "in_progress";
    first.startedAt = new Date().toISOString();
    copy.activePhaseId = first.id;
    copy.selectedPhaseId = first.id;
  }
  return copy;
}

export function completePhase(goal: Goal, phaseId: string): Goal {
  const copy = JSON.parse(JSON.stringify(goal)) as Goal;
  const phase = copy.phases.find((p) => p.id === phaseId);
  if (phase) {
    phase.status = "complete";
    phase.completedAt = new Date().toISOString();
    for (const t of phase.tasks) t.status = "complete";
  }
  const next = copy.phases.find((p) => p.status === "pending");
  if (next) {
    next.status = "in_progress";
    next.startedAt = new Date().toISOString();
    copy.activePhaseId = next.id;
    copy.selectedPhaseId = next.id;
  } else {
    copy.status = "complete";
    copy.completedAt = new Date().toISOString();
    copy.activePhaseId = undefined;
  }
  return copy;
}
