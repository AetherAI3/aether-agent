import type { BrainEvent } from "../core/brain_protocol.js";

export interface PhaseRailEntry {
  n: number;
  type: string;
  agentCount: number;
  status: "waiting" | "running" | "done";
  artifactSummary: string | null;
}

export interface TaskChainState {
  workflowId: string | null;
  phases: PhaseRailEntry[];
  currentPhaseN: number | null;
  totalAgents: number;
  doneAgents: number;
}

export function createTaskChainState(): TaskChainState {
  return {
    workflowId: null,
    phases: [],
    currentPhaseN: null,
    totalAgents: 0,
    doneAgents: 0,
  };
}

export function applyFrame(state: TaskChainState, frame: BrainEvent): TaskChainState {
  switch (frame.type) {
    case "workflow_start":
      return {
        ...state,
        workflowId: frame.workflowId,
        totalAgents: frame.totalAgents,
        doneAgents: 0,
        currentPhaseN: null,
        phases: frame.phases.map((p) => ({
          n: p.n,
          type: p.type,
          agentCount: p.agents,
          status: "waiting" as const,
          artifactSummary: null,
        })),
      };
    case "phase_start":
      return {
        ...state,
        currentPhaseN: frame.phaseN,
        phases: state.phases.map((p) =>
          p.n === frame.phaseN ? { ...p, status: "running" as const } : p
        ),
      };
    case "phase_done":
      return {
        ...state,
        phases: state.phases.map((p) =>
          p.n === frame.phaseN
            ? { ...p, status: "done" as const, artifactSummary: frame.artifactSummary }
            : p
        ),
      };
    case "agent_done":
      return { ...state, doneAgents: state.doneAgents + 1 };
    default:
      return state;
  }
}
