import type { BrainEvent } from "../core/brain_protocol.js";

export interface AgentEntry {
  id: string;
  phaseN: number;
  brief: string;
  status: "running" | "done" | "error";
  feed: string;
  summary: string | null;
}

export interface WorkflowViewerState {
  visible: boolean;
  workflowId: string | null;
  agents: AgentEntry[];
  selectedAgentId: string | null;
  cursorIndex: number;
}

export function createViewerState(): WorkflowViewerState {
  return {
    visible: false,
    workflowId: null,
    agents: [],
    selectedAgentId: null,
    cursorIndex: 0,
  };
}

export function applyViewerFrame(
  state: WorkflowViewerState,
  frame: BrainEvent,
): WorkflowViewerState {
  switch (frame.type) {
    case "workflow_start":
      return {
        ...state,
        visible: true,
        workflowId: frame.workflowId,
        agents: [],
        selectedAgentId: null,
        cursorIndex: 0,
      };

    case "agent_spawn":
      return {
        ...state,
        agents: [
          ...state.agents,
          {
            id: frame.agentId,
            phaseN: frame.phaseN,
            brief: frame.brief,
            status: "running" as const,
            feed: "",
            summary: null,
          },
        ],
      };

    case "agent_progress":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === frame.agentId ? { ...a, feed: a.feed + frame.delta } : a
        ),
      };

    case "agent_done":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === frame.agentId
            ? { ...a, status: "done" as const, summary: frame.summary }
            : a
        ),
      };

    case "workflow_done":
      return { ...state, visible: false };

    default:
      return state;
  }
}

export function selectAgent(state: WorkflowViewerState, agentId: string): WorkflowViewerState {
  return { ...state, selectedAgentId: agentId };
}

export function moveCursor(state: WorkflowViewerState, direction: 1 | -1): WorkflowViewerState {
  const next = Math.max(0, Math.min(state.agents.length - 1, state.cursorIndex + direction));
  return { ...state, cursorIndex: next };
}

const STATUS_ICON: Record<AgentEntry["status"], string> = {
  running: "●",
  done: "✓",
  error: "✗",
};

export function renderCiTree(state: WorkflowViewerState): string {
  if (!state.visible) return "";
  const lines: string[] = [`WORKFLOW  ${state.workflowId ?? ""}`, ""];
  for (let i = 0; i < state.agents.length; i++) {
    const a = state.agents[i]!;
    const cursor = i === state.cursorIndex ? "▶ " : "  ";
    const bold = i === state.cursorIndex ? "\x1b[1m" : "";
    const reset = i === state.cursorIndex ? "\x1b[0m" : "";
    lines.push(`${cursor}${STATUS_ICON[a.status]}  ${bold}${a.id}${reset}  ${a.brief}`);
  }
  lines.push("");
  lines.push("[↑↓ move · Enter select agent · Esc back]");
  return lines.join("\n");
}

export function renderAgentFeed(state: WorkflowViewerState): string {
  if (!state.selectedAgentId) return "";
  const agent = state.agents.find((a) => a.id === state.selectedAgentId);
  if (!agent) return "";
  return `=== ${agent.id} — ${agent.brief} ===\n\n${agent.feed}`;
}
