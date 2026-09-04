import type { BrainEvent } from "../core/brain_protocol.js";
import { titledBox, theme } from "./box.js";
import { humanTokens } from "./statusbar.js";
import { formatElapsed } from "./elapsed.js";
import { sanitizeTerm } from "./text.js";

const safeInline = (value: string): string => sanitizeTerm(value).replace(/[\r\n\t]+/g, " ");

export interface AgentEntry {
  id: string;
  phaseN: number;
  brief: string;
  status: "running" | "done" | "error";
  feed: string;
  summary: string | null;
  // Client-derivable (Finding F) — stamped locally, no wire change needed.
  startedMs: number | null;
  // Backend-gated (Finding E) — null until an `agent_done` frame actually
  // carries them; the renderer shows "—", never a fabricated number.
  tokens: number | null;
  toolCalls: number | null;
  durationMs: number | null;
}

export interface PhaseEntry {
  n: number;
  type: string;
  agentCount: number;
  status: "waiting" | "running" | "done";
  artifactSummary: string | null;
}

export interface WorkflowViewerState {
  visible: boolean;
  workflowId: string | null;
  phases: PhaseEntry[];
  agents: AgentEntry[];
  selectedAgentId: string | null;
  cursorIndex: number;
  // Which phase numbers currently show their agent rows. All phases start
  // expanded on workflow_start (matches the pre-existing flat-list default of
  // "agents visible without extra input"); collapse is opt-in per phase.
  expandedPhaseNs: number[];
}

export function createViewerState(): WorkflowViewerState {
  return {
    visible: false,
    workflowId: null,
    phases: [],
    agents: [],
    selectedAgentId: null,
    cursorIndex: 0,
    expandedPhaseNs: [],
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
        workflowId: safeInline(frame.workflowId),
        phases: frame.phases.map((p) => ({
          n: p.n,
          type: safeInline(p.type),
          agentCount: p.agents,
          status: "waiting" as const,
          artifactSummary: null,
        })),
        agents: [],
        selectedAgentId: null,
        cursorIndex: 0,
        expandedPhaseNs: frame.phases.map((p) => p.n),
      };

    case "phase_start":
      return {
        ...state,
        phases: state.phases.map((p) =>
          p.n === frame.phaseN ? { ...p, status: "running" as const } : p
        ),
      };

    case "phase_done":
      return {
        ...state,
        phases: state.phases.map((p) =>
          p.n === frame.phaseN
            ? { ...p, status: "done" as const, artifactSummary: safeInline(frame.artifactSummary) }
            : p
        ),
      };

    case "agent_spawn":
      return {
        ...state,
        agents: [
          ...state.agents,
          {
            id: safeInline(frame.agentId),
            phaseN: frame.phaseN,
            brief: safeInline(frame.brief),
            status: "running" as const,
            feed: "",
            summary: null,
            startedMs: Date.now(),
            tokens: null,
            toolCalls: null,
            durationMs: null,
          },
        ],
      };

    case "agent_progress":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === safeInline(frame.agentId) ? { ...a, feed: a.feed + sanitizeTerm(frame.delta) } : a
        ),
      };

    case "agent_done":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === safeInline(frame.agentId)
            ? {
                ...a,
                status: "done" as const,
                summary: safeInline(frame.summary),
                tokens: frame.tokens ?? a.tokens,
                toolCalls: frame.toolCalls ?? a.toolCalls,
                durationMs: frame.durationMs ?? a.durationMs,
              }
            : a
        ),
      };

    case "workflow_done":
      return { ...state, visible: false };

    default:
      return state;
  }
}

/** Select one agent to drill into (Finding D), or `null` to go back to the
 *  tree view. */
export function selectAgent(state: WorkflowViewerState, agentId: string | null): WorkflowViewerState {
  return { ...state, selectedAgentId: agentId };
}

/** Indices into state.agents that are actually rendered right now: every
 *  agent when there's no phase data (flat-list fallback), else only agents
 *  whose phase is expanded. Keeps the cursor from ever resting on a row
 *  hidden by a collapsed phase. */
function visibleAgentIndices(state: WorkflowViewerState): number[] {
  if (state.phases.length === 0) return state.agents.map((_, i) => i);
  const indices: number[] = [];
  state.agents.forEach((a, i) => {
    if (state.expandedPhaseNs.includes(a.phaseN)) indices.push(i);
  });
  return indices;
}

export function moveCursor(state: WorkflowViewerState, direction: 1 | -1): WorkflowViewerState {
  const visible = visibleAgentIndices(state);
  if (visible.length === 0) return state;
  const currentPos = visible.indexOf(state.cursorIndex);
  const nextPos = Math.max(0, Math.min(visible.length - 1, (currentPos === -1 ? 0 : currentPos) + direction));
  return { ...state, cursorIndex: visible[nextPos]! };
}

/** Toggle whether a phase's agent rows are shown (Finding C's "State changes":
 *  a plain array, not a Set, to keep the existing immutable-spread reducer
 *  style and strict-equality test assertions working unchanged). Snaps the
 *  cursor to the nearest visible agent if collapsing hid the one it was on. */
export function togglePhaseExpanded(state: WorkflowViewerState, phaseN: number): WorkflowViewerState {
  const isExpanded = state.expandedPhaseNs.includes(phaseN);
  const next: WorkflowViewerState = {
    ...state,
    expandedPhaseNs: isExpanded
      ? state.expandedPhaseNs.filter((n) => n !== phaseN)
      : [...state.expandedPhaseNs, phaseN],
  };
  const visible = visibleAgentIndices(next);
  if (visible.length > 0 && !visible.includes(next.cursorIndex)) {
    return { ...next, cursorIndex: visible[0]! };
  }
  return next;
}

const STATUS_ICON: Record<AgentEntry["status"], string> = {
  running: "●",
  done: "✓",
  error: "✗",
};

function phaseDots(phase: PhaseEntry, agents: AgentEntry[]): string {
  // "done" or "error" both mean the agent is no longer running — count both
  // as filled, or a phase.status of "done" with one failed agent renders as
  // permanently partial (e.g. "●●●●●○ done"), which reads as contradictory.
  const settledCount = agents.filter(
    (a) => a.phaseN === phase.n && (a.status === "done" || a.status === "error"),
  ).length;
  const total = Math.max(phase.agentCount, settledCount);
  return "●".repeat(settledCount) + "○".repeat(Math.max(0, total - settledCount));
}

function agentRow(a: AgentEntry, isCursor: boolean, now: number): string {
  const cursor = isCursor ? "▶ " : "  ";
  const id = isCursor ? theme.bold(a.id) : a.id;
  const tokens = a.tokens != null ? `${humanTokens(a.tokens)} tok` : "—";
  const tools = a.toolCalls != null ? `${a.toolCalls} tools` : "—";
  const elapsed =
    a.durationMs != null
      ? formatElapsed(a.durationMs)
      : a.startedMs != null
        ? formatElapsed(Math.max(0, now - a.startedMs))
        : "—";
  return `${cursor}${STATUS_ICON[a.status]}  ${id}  ${a.brief}  ${tokens}  ${tools}  ${elapsed}`;
}

/** Render the workflow popout: a titled box, phase-grouped when phase data
 *  is available (Finding C), falling back to the original flat agent list
 *  when it isn't (e.g. an older brain that never sends phase_start/phase_done).
 *  Tokens/Tools columns render "—" until Tier-2/3 wire data arrives for that
 *  agent — never a fabricated number (Finding E / Design's Error Handling). */
export function renderCiTree(state: WorkflowViewerState): string {
  if (!state.visible) return "";
  const now = Date.now();
  // "—" until at least one agent has reported tokens — summing null-as-0
  // would print a real-looking "0 tokens" instead of an honest placeholder
  // (the same convention agentRow already follows for its own columns).
  const reportingAgents = state.agents.filter((a) => a.tokens != null);
  const totalTokens = reportingAgents.length > 0
    ? `${humanTokens(reportingAgents.reduce((sum, a) => sum + a.tokens!, 0))} tokens`
    : "— tokens";
  const lines: string[] = [`${state.agents.length} agents · ${totalTokens}`, ""];

  if (state.phases.length === 0) {
    for (let i = 0; i < state.agents.length; i++) {
      lines.push(agentRow(state.agents[i]!, i === state.cursorIndex, now));
    }
  } else {
    lines.push("PHASES");
    for (const phase of state.phases) {
      const expanded = state.expandedPhaseNs.includes(phase.n);
      const marker = expanded ? "▾" : "▸";
      lines.push(`${marker} ${phase.type}  ${phaseDots(phase, state.agents)}  ${phase.status}`);
      if (expanded) {
        for (let i = 0; i < state.agents.length; i++) {
          const a = state.agents[i]!;
          if (a.phaseN !== phase.n) continue;
          lines.push("    " + agentRow(a, i === state.cursorIndex, now));
        }
      }
    }
  }

  lines.push("");
  lines.push(
    state.phases.length > 0
      ? "[↑↓ move · ←→ collapse/expand phase · Enter select agent · Esc back]"
      : "[↑↓ move · Enter select agent · Esc back]",
  );
  const width = Math.min(78, (process.stdout.columns ?? 80) - 2);
  return titledBox(lines, `WORKFLOW  ${state.workflowId ?? ""}`, { width });
}

export function renderAgentFeed(state: WorkflowViewerState): string {
  if (!state.selectedAgentId) return "";
  const agent = state.agents.find((a) => a.id === state.selectedAgentId);
  if (!agent) return "";
  return `=== ${safeInline(agent.id)} — ${safeInline(agent.brief)} ===\n\n${sanitizeTerm(agent.feed)}`;
}

/** Clear sequence for repainting the popout in place: cursor-up + clear-line
 *  for each previously-printed panel line, then clear the current (input) row
 *  — replaces the single-line `\r\x1b[2K` that only erased the input row and
 *  left every prior render stacked as duplicate copies in scrollback
 *  (Finding B). `prevLineCount <= 0` (nothing rendered yet) degrades to the
 *  original single-line clear. */
export function viewerClearSequence(prevLineCount: number): string {
  return "\r\x1b[2K" + "\x1b[1A\x1b[2K".repeat(Math.max(0, prevLineCount));
}

/** Line count of a rendered panel ("" -> 0), for `viewerClearSequence`. */
export function viewerLineCount(rendered: string): number {
  return rendered === "" ? 0 : rendered.split("\n").length;
}
