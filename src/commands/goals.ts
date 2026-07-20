// goals.ts — slash command handlers for /goal and /goals.
// Called from slash.ts when the user types /goal or /goals.

import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import {
  goalsForWorkspace, getGoalForWorkspace, getActiveGoal, newGoal, newPhase, newTask,
  upsertGoal, startGoal, completePhase,
  setPhaseNote, type Goal,
} from "../core/goals.js";
import { renderGoalChain, renderPhaseDetail } from "../ui/goal_chain.js";

const cols = () => process.stdout.columns || 100;

function resolveGoal(cwd: string, id?: string): Goal | undefined {
  return id ? getGoalForWorkspace(id, cwd) : getActiveGoal(cwd) ?? goalsForWorkspace(cwd)[0];
}

// ── LLM-powered goal decomposition ────────────────────────────────────
// Heuristic today; later wired to POST /project/decompose (task_graph.py).

function decomposeGoal(description: string, cwd: string): Goal {
  const goal = newGoal(description, cwd);
  const lower = description.toLowerCase();

  const isFullStack = lower.includes("full") || lower.includes("stack") ||
    (lower.includes("front") && lower.includes("back"));
  const isApi = lower.includes("api") || lower.includes("backend") || lower.includes("server");
  const isFrontend = lower.includes("front") || lower.includes("ui") || lower.includes("react") || lower.includes("vue");
  const isApp = lower.includes("app") || isFullStack;
  const hasTests = lower.includes("test") || lower.includes("e2e") || lower.includes("qa");
  const hasDeploy = lower.includes("deploy") || lower.includes("docker") || lower.includes("ship");

  if (isApp || isFullStack) {
    goal.phases.push(populatePhase(1, "Planning & Setup", "Project scaffold, deps, config, repo setup",
      ["Initialize project structure", "Install dependencies", "Configure tooling"]));
    goal.phases.push(populatePhase(2, "Backend / API", "Data models, API endpoints, auth, business logic",
      ["Design data models/schema", "Implement API endpoints", "Add authentication"]));
    goal.phases.push(populatePhase(3, "Frontend UI", "Components, pages, state management, styling",
      ["Build UI components", "Wire up state/API calls", "Style and polish"]));
  } else if (isApi || isFrontend) {
    goal.phases.push(populatePhase(1, "Setup & Foundation", "Project init, config, core structure",
      ["Initialize project", "Configure build tools", "Set up core modules"]));
    goal.phases.push(populatePhase(2, isApi ? "API Implementation" : "UI Implementation",
      isApi ? "Endpoints, middleware, error handling" : "Components, routing, state",
      ["Build core feature", "Handle edge cases", "Add error handling"]));
  }

  if (hasTests) {
    goal.phases.push(populatePhase(goal.phases.length + 1, "Testing", "Unit, integration, and E2E tests",
      ["Write unit tests", "Add integration tests", "Run E2E tests"]));
  }
  if (hasDeploy) {
    goal.phases.push(populatePhase(goal.phases.length + 1, "Deployment", "Containerization, CI/CD, production release",
      ["Create Dockerfile", "Set up CI pipeline", "Deploy to production"]));
  }

  // Default: at least one phase
  if (goal.phases.length === 0) {
    goal.phases.push(populatePhase(1, "Implementation", description,
      ["Break down approach", "Implement core logic", "Verify and document"]));
  }

  goal.selectedPhaseId = goal.phases[0]!.id;
  return goal;
}

function populatePhase(idx: number, title: string, description: string, taskTitles: string[]) {
  const phase = newPhase(idx, title, description);
  phase.tasks = taskTitles.map(newTask);
  return phase;
}

// ── Handlers ──────────────────────────────────────────────────────────

export async function handleGoal(
  ctx: AppContext, out: Writable, subcmd: string, rest: string,
): Promise<void> {
  const c = cols();

  switch (subcmd) {
    case "": {
      // /goal <description> — create a new goal
      if (!rest.trim()) {
        out.write("usage: /goal <description of what you want to build>\n");
        out.write("  e.g. /goal build a full-stack todo app with auth\n");
        return;
      }
      const goal = decomposeGoal(rest.trim(), ctx.flags.cwd);

      // Show the plan
      out.write("\n");
      for (const l of renderGoalChain(goal, c)) out.write("  " + l + "\n");
      for (const l of renderPhaseDetail(goal, c)) out.write("  " + l + "\n");
      out.write("\n");

      // Ask to save
      const ok = ctx.flags.yes || (await ctx.confirm(`Save this ${goal.phases.length}-phase plan? [y/N] `));
      if (!ok) {
        out.write("discarded.\n");
        return;
      }
      upsertGoal(goal);
      out.write(`Goal saved: ${goal.id}\n`);
      out.write("Start it with: /goal start\n");
      break;
    }

    case "start": {
      const id = rest.trim();
      const goal = resolveGoal(ctx.flags.cwd, id);
      if (!goal) { out.write("no goals found. create one first: /goal <description>\n"); return; }
      if (goal.status === "running") { out.write(`already running: ${goal.id}\n`); return; }
      const started = startGoal(goal);
      upsertGoal(started);
      out.write(`Goal started: ${started.id}\n`);
      for (const l of renderGoalChain(started, c)) out.write("  " + l + "\n");
      break;
    }

    case "pause": {
      const goal = getActiveGoal(ctx.flags.cwd);
      if (!goal) { out.write("no active goal to pause.\n"); return; }
      goal.status = "paused";
      upsertGoal(goal);
      out.write("Goal paused.\n");
      break;
    }

    case "resume": {
      const goal = getActiveGoal(ctx.flags.cwd);
      if (!goal) { out.write("no paused goal to resume.\n"); return; }
      goal.status = "running";
      upsertGoal(goal);
      out.write("Goal resumed.\n");
      break;
    }

    case "cancel": {
      const goal = getActiveGoal(ctx.flags.cwd);
      if (!goal) { out.write("no active goal to cancel.\n"); return; }
      const ok = ctx.flags.yes || (await ctx.confirm("Cancel this goal? [y/N] "));
      if (!ok) { out.write("kept.\n"); return; }
      goal.status = "halted";
      upsertGoal(goal);
      out.write("Goal cancelled.\n");
      break;
    }

    case "complete": {
      const active = getActiveGoal(ctx.flags.cwd);
      if (!active) { out.write("no active goal.\n"); return; }
      const phaseId = rest.trim() || active.activePhaseId || "";
      if (!phaseId) { out.write("usage: /goal complete <phase-id>\n"); return; }
      const updated = completePhase(active, phaseId);
      upsertGoal(updated);
      out.write("Phase complete!\n");
      for (const l of renderGoalChain(updated, c)) out.write("  " + l + "\n");
      break;
    }

    case "note": {
      const parts = rest.trim().split(/\s+(.*)/s);
      const phaseId = parts[0] ?? "";
      const note = parts[1] ?? "";
      if (!phaseId || !note) { out.write("usage: /goal note <phase-id> <note text>\n"); return; }
      const active = resolveGoal(ctx.flags.cwd);
      if (!active) { out.write("no goal to add note to.\n"); return; }
      const updated = setPhaseNote(active, phaseId, note);
      upsertGoal(updated);
      out.write(`Note added to ${phaseId}.\n`);
      break;
    }

    case "view": {
      const id = rest.trim();
      const goal = resolveGoal(ctx.flags.cwd, id);
      if (!goal) { out.write("no goals found.\n"); return; }
      out.write("\n");
      for (const l of renderGoalChain(goal, c)) out.write("  " + l + "\n");
      for (const l of renderPhaseDetail(goal, c)) out.write("  " + l + "\n");
      out.write("\n");
      break;
    }

    default:
      out.write(`unknown /goal subcommand: ${subcmd}\n`);
      out.write("try: /goal <desc>, /goal start, /goal pause, /goal note <phase> <text>, /goal view\n");
  }
}

export async function handleGoals(
  ctx: AppContext, out: Writable, rest: string,
): Promise<void> {
  const goals = goalsForWorkspace(ctx.flags.cwd);
  const c = cols();

  if (rest.trim()) {
    // /goals <id> — show that goal in detail
    const goal = getGoalForWorkspace(rest.trim(), ctx.flags.cwd);
    if (!goal) { out.write(`no goal found: ${rest.trim()}\n`); return; }
    for (const l of renderGoalChain(goal, c)) out.write("  " + l + "\n");
    for (const l of renderPhaseDetail(goal, c)) out.write("  " + l + "\n");
    return;
  }

  if (goals.length === 0) {
    out.write("(no goals yet)\n");
    out.write("create one: /goal build a full-stack todo app\n");
    return;
  }

  out.write(`\n${goals.length} goal(s):\n\n`);
  for (const g of goals) {
    const icon = g.status === "running" ? "●" : g.status === "complete" ? "✓" : "○";
    const done = g.phases.filter(p => p.status === "complete").length;
    const total = g.phases.length;
    out.write(`  ${icon}  ${g.id}  ${g.title.slice(0, 50)}  [${done}/${total} phases]  ${g.status}\n`);
  }
  out.write("\nview one: /goals <id>\n");
}

export function goalHelp(): string {
  return [
    "/goal <desc>      create a new goal (agent plans phases)",
    "/goals            list saved goals",
    "/goal view [id]   show goal chain + phase detail",
    "/goal start [id]  start working on a goal",
    "/goal pause       pause the active goal",
    "/goal resume      resume a paused goal",
    "/goal cancel      cancel the active goal",
    "/goal note <phase> <text>   add a note to a phase",
    "/goal complete <phase>      mark a phase as complete",
  ].join("\n");
}
