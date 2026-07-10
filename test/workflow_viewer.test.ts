import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createViewerState,
  applyViewerFrame,
  selectAgent,
  moveCursor,
  togglePhaseExpanded,
  renderCiTree,
  renderAgentFeed,
  viewerClearSequence,
  viewerLineCount,
} from "../src/ui/workflow_viewer.js";
import type { BrainEvent } from "../src/core/brain_protocol.js";

const wfStart: BrainEvent = {
  type: "workflow_start", workflowId: "wf_x",
  phases: [{ n: 1, type: "RECON", agents: 2 }], totalAgents: 2,
};
const spawn1: BrainEvent = { type: "agent_spawn", agentId: "ag_1", phaseN: 1, brief: "scan auth" };
const spawn2: BrainEvent = { type: "agent_spawn", agentId: "ag_2", phaseN: 1, brief: "scan rate-limit" };

test("initialises empty and hidden", () => {
  const s = createViewerState();
  assert.strictEqual(s.visible, false);
  assert.strictEqual(s.agents.length, 0);
  assert.strictEqual(s.selectedAgentId, null);
  assert.strictEqual(s.cursorIndex, 0);
  assert.strictEqual(s.workflowId, null);
});

test("becomes visible on workflow_start", () => {
  const s = applyViewerFrame(createViewerState(), wfStart);
  assert.strictEqual(s.visible, true);
  assert.strictEqual(s.workflowId, "wf_x");
  assert.strictEqual(s.agents.length, 0);
});

test("adds agent entry on agent_spawn", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  assert.strictEqual(s.agents.length, 1);
  assert.strictEqual(s.agents[0]!.id, "ag_1");
  assert.strictEqual(s.agents[0]!.brief, "scan auth");
  assert.strictEqual(s.agents[0]!.status, "running");
  assert.strictEqual(s.agents[0]!.feed, "");
});

test("appends to feed on agent_progress (two deltas)", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = applyViewerFrame(s, { type: "agent_progress", agentId: "ag_1", delta: "token A" } as BrainEvent);
  s = applyViewerFrame(s, { type: "agent_progress", agentId: "ag_1", delta: " token B" } as BrainEvent);
  assert.ok(s.agents[0]!.feed.includes("token A"));
  assert.ok(s.agents[0]!.feed.includes("token B"));
});

test("marks agent done on agent_done", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = applyViewerFrame(s, { type: "agent_done", agentId: "ag_1", phaseN: 1, summary: "found SSRF" } as BrainEvent);
  assert.strictEqual(s.agents[0]!.status, "done");
  assert.strictEqual(s.agents[0]!.summary, "found SSRF");
});

test("hides on workflow_done", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, { type: "workflow_done", synthesis: "done", totalPhases: 1, totalAgents: 0 } as BrainEvent);
  assert.strictEqual(s.visible, false);
});

test("selectAgent sets selectedAgentId", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = selectAgent(s, "ag_1");
  assert.strictEqual(s.selectedAgentId, "ag_1");
});

test("moveCursor clamps at bottom bound (no negative)", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = moveCursor(s, -1);  // can't go below 0
  assert.strictEqual(s.cursorIndex, 0);
});

test("moveCursor clamps at top bound (single agent)", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = moveCursor(s, 1);   // can't go above agents.length - 1 = 0
  assert.strictEqual(s.cursorIndex, 0);
});

test("moveCursor advances when multiple agents", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = applyViewerFrame(s, spawn2);
  s = moveCursor(s, 1);
  assert.strictEqual(s.cursorIndex, 1);
  s = moveCursor(s, -1);
  assert.strictEqual(s.cursorIndex, 0);
});

test("renderCiTree returns empty string when not visible", () => {
  assert.strictEqual(renderCiTree(createViewerState()), "");
});

test("renderCiTree includes agent id and brief when visible", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  const rendered = renderCiTree(s);
  assert.ok(rendered.includes("ag_1"), `expected 'ag_1' in:\n${rendered}`);
  assert.ok(rendered.includes("scan auth"), `expected 'scan auth' in:\n${rendered}`);
});

test("renderAgentFeed returns empty string when no agent selected", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  assert.strictEqual(renderAgentFeed(s), "");
});

test("renderAgentFeed includes feed content for selected agent", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = applyViewerFrame(s, { type: "agent_progress", agentId: "ag_1", delta: "output text" } as BrainEvent);
  s = selectAgent(s, "ag_1");
  const rendered = renderAgentFeed(s);
  assert.ok(rendered.includes("output text"), `expected feed in:\n${rendered}`);
  assert.ok(rendered.includes("ag_1"), `expected agentId in:\n${rendered}`);
});

// ── Phase tracking (Finding C — absorbed from the deleted task_chain.ts,
// which modeled these transitions correctly but was never wired into
// production; its test cases are migrated here against the unified state) ──

const twoPhaseStart: BrainEvent = {
  type: "workflow_start", workflowId: "wf_abc",
  phases: [
    { n: 1, type: "RECON", agents: 8 },
    { n: 2, type: "IMPLEMENT", agents: 12 },
  ],
  totalAgents: 20,
};

test("workflow_start sets phases from wire data, all waiting", () => {
  const s = applyViewerFrame(createViewerState(), twoPhaseStart);
  assert.strictEqual(s.phases.length, 2);
  assert.strictEqual(s.phases[0]!.status, "waiting");
  assert.strictEqual(s.phases[1]!.status, "waiting");
  assert.strictEqual(s.phases[0]!.type, "RECON");
  assert.strictEqual(s.phases[1]!.type, "IMPLEMENT");
});

test("phase_start marks the matching phase running, leaves others alone", () => {
  let s = applyViewerFrame(createViewerState(), twoPhaseStart);
  s = applyViewerFrame(s, { type: "phase_start", phaseN: 1, phaseType: "RECON", agentCount: 8 } as BrainEvent);
  assert.strictEqual(s.phases[0]!.status, "running");
  assert.strictEqual(s.phases[1]!.status, "waiting");
});

test("phase_done marks phase done and stores artifactSummary", () => {
  let s = applyViewerFrame(createViewerState(), twoPhaseStart);
  s = applyViewerFrame(s, { type: "phase_start", phaseN: 1, phaseType: "RECON", agentCount: 8 } as BrainEvent);
  s = applyViewerFrame(s, { type: "phase_done", phaseN: 1, artifactSummary: "found 3 issues" } as BrainEvent);
  assert.strictEqual(s.phases[0]!.status, "done");
  assert.strictEqual(s.phases[0]!.artifactSummary, "found 3 issues");
});

test("phase_start/phase_done never touch an already-populated agents array", () => {
  // Seeded with a real spawned agent first — a reducer bug that clobbers
  // `agents` (e.g. an accidental `agents: []` in the phase_start/phase_done
  // branch) is unobservable if this test starts from zero agents, since an
  // empty array reset to empty proves nothing.
  let s = applyViewerFrame(createViewerState(), twoPhaseStart);
  s = applyViewerFrame(s, spawn1);
  s = applyViewerFrame(s, { type: "phase_start", phaseN: 1, phaseType: "RECON", agentCount: 8 } as BrainEvent);
  s = applyViewerFrame(s, { type: "phase_done", phaseN: 1, artifactSummary: "ok" } as BrainEvent);
  assert.strictEqual(s.agents.length, 1);
  assert.strictEqual(s.agents[0]!.id, "ag_1");
});

test("ignores non-workflow frames without error", () => {
  const s = applyViewerFrame(createViewerState(), { type: "error", msg: "hello" } as BrainEvent);
  assert.strictEqual(s.workflowId, null);
  assert.strictEqual(s.visible, false);
});

test("renderCiTree falls back to a flat agent list when workflow_start carries no phase data", () => {
  const noPhaseStart: BrainEvent = { type: "workflow_start", workflowId: "wf_flat", phases: [], totalAgents: 1 };
  let s = applyViewerFrame(createViewerState(), noPhaseStart);
  s = applyViewerFrame(s, spawn1);
  const rendered = renderCiTree(s);
  assert.ok(!rendered.includes("PHASES"), `expected no PHASES header in:\n${rendered}`);
  assert.ok(rendered.includes("ag_1"), `expected 'ag_1' in:\n${rendered}`);
});

// ── Phase expand/collapse (Finding C's expandedPhaseNs) ──

test("phases start expanded by default (agents visible without extra input)", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  assert.deepEqual(s.expandedPhaseNs, [1]);
  assert.ok(renderCiTree(s).includes("ag_1"));
});

test("togglePhaseExpanded collapses a phase, hiding its agent rows", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = togglePhaseExpanded(s, 1);
  assert.deepEqual(s.expandedPhaseNs, []);
  const rendered = renderCiTree(s);
  assert.ok(!rendered.includes("scan auth"), `expected agent row hidden in:\n${rendered}`);
});

test("togglePhaseExpanded twice restores the agent rows", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = togglePhaseExpanded(s, 1);
  s = togglePhaseExpanded(s, 1);
  assert.deepEqual(s.expandedPhaseNs, [1]);
  assert.ok(renderCiTree(s).includes("scan auth"));
});

test("togglePhaseExpanded snaps the cursor off a now-hidden agent onto a visible one", () => {
  let s = applyViewerFrame(createViewerState(), twoPhaseStart);
  s = applyViewerFrame(s, spawn1); // phaseN 1
  s = applyViewerFrame(s, { type: "agent_spawn", agentId: "ag_2", phaseN: 2, brief: "implement fix" } as BrainEvent);
  s = moveCursor(s, 1); // cursor now on ag_2 (phase 2)
  assert.strictEqual(s.cursorIndex, 1);
  s = togglePhaseExpanded(s, 2); // collapse the phase the cursor is sitting in
  assert.notStrictEqual(s.cursorIndex, 1, "cursor must not be left pointing at a hidden row");
  assert.strictEqual(s.agents[s.cursorIndex]!.phaseN, 1, "cursor snapped to a still-visible agent");
});

test("moveCursor skips over agents in a collapsed phase", () => {
  let s = applyViewerFrame(createViewerState(), twoPhaseStart);
  s = applyViewerFrame(s, spawn1); // ag_1, phaseN 1
  s = applyViewerFrame(s, { type: "agent_spawn", agentId: "ag_2", phaseN: 2, brief: "implement fix" } as BrainEvent);
  s = togglePhaseExpanded(s, 2); // collapse phase 2 (ag_2 now hidden)
  s = moveCursor(s, 1); // from ag_1, moving "down" must not land on the hidden ag_2
  assert.strictEqual(s.agents[s.cursorIndex]!.id, "ag_1", "only ag_1 is visible, cursor must stay put");
});

// ── Multi-phase render coverage (phaseDots was previously exercised only via
// applyViewerFrame state assertions, never through renderCiTree itself) ──

test("renderCiTree's phaseDots renders filled dots for done agents, split correctly across two phases", () => {
  let s = applyViewerFrame(createViewerState(), twoPhaseStart); // phase 1: 8 agents, phase 2: 12 agents
  s = applyViewerFrame(s, spawn1); // ag_1, phase 1
  s = applyViewerFrame(s, { type: "agent_spawn", agentId: "ag_2", phaseN: 2, brief: "implement" } as BrainEvent);
  s = applyViewerFrame(s, { type: "agent_done", agentId: "ag_1", phaseN: 1, summary: "ok" } as BrainEvent);
  const rendered = renderCiTree(s);
  // phase 1: 1 done out of a declared 8 -> "●" + 7x "○"
  assert.ok(rendered.includes("●" + "○".repeat(7)), `expected phase 1 dots in:\n${rendered}`);
  // phase 2: 0 done out of a declared 12 -> 12x "○", no filled dot
  assert.ok(rendered.includes("○".repeat(12)), `expected phase 2 dots in:\n${rendered}`);
  // both phases' own agents show up under the right phase (both start expanded)
  assert.ok(rendered.includes("scan auth"));
  assert.ok(rendered.includes("implement"));
});

test("renderCiTree's phaseDots counts an errored agent as settled, not partial", () => {
  let s = applyViewerFrame(createViewerState(), wfStart); // 1 phase declaring 2 agents
  s = applyViewerFrame(s, spawn1);
  s = applyViewerFrame(s, spawn2);
  s = applyViewerFrame(s, { type: "agent_done", agentId: "ag_1", phaseN: 1, summary: "ok" } as BrainEvent);
  // ag_2 errors instead of completing — status is a real AgentEntry state
  s = { ...s, agents: s.agents.map((a) => (a.id === "ag_2" ? { ...a, status: "error" as const } : a)) };
  const rendered = renderCiTree(s);
  assert.ok(rendered.includes("●●"), `both agents (1 done + 1 error) should render as filled dots:\n${rendered}`);
  assert.ok(!rendered.includes("●○"), `an errored agent must not read as still-partial:\n${rendered}`);
});

// ── Client-derivable + backend-gated agent fields (Findings E + F) ──

test("agent_spawn stamps a client-side startedMs", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  assert.strictEqual(typeof s.agents[0]!.startedMs, "number");
});

test("tokens/toolCalls/durationMs default to null (never fabricated)", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  assert.strictEqual(s.agents[0]!.tokens, null);
  assert.strictEqual(s.agents[0]!.toolCalls, null);
  assert.strictEqual(s.agents[0]!.durationMs, null);
});

test("agent_done with optional tier-2/3 fields populates tokens/toolCalls/durationMs", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = applyViewerFrame(s, {
    type: "agent_done", agentId: "ag_1", phaseN: 1, summary: "ok",
    tokens: 97600, toolCalls: 40, durationMs: 266_000,
  } as BrainEvent);
  assert.strictEqual(s.agents[0]!.tokens, 97600);
  assert.strictEqual(s.agents[0]!.toolCalls, 40);
  assert.strictEqual(s.agents[0]!.durationMs, 266_000);
});

test("agent_done without tier-2/3 fields leaves them null, not zero", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = applyViewerFrame(s, { type: "agent_done", agentId: "ag_1", phaseN: 1, summary: "ok" } as BrainEvent);
  assert.strictEqual(s.agents[0]!.tokens, null);
  assert.strictEqual(s.agents[0]!.toolCalls, null);
  assert.strictEqual(s.agents[0]!.durationMs, null);
});

test("renderCiTree shows an em-dash for agents with no tier-2/3 data yet", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  const rendered = renderCiTree(s);
  assert.ok(rendered.includes("—"), `expected em-dash placeholder in:\n${rendered}`);
});

test("renderCiTree shows real tokens/tools once the backend sends them", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = applyViewerFrame(s, {
    type: "agent_done", agentId: "ag_1", phaseN: 1, summary: "ok",
    tokens: 97600, toolCalls: 40, durationMs: 266_000,
  } as BrainEvent);
  const rendered = renderCiTree(s);
  assert.ok(rendered.includes("97.6K tok"), `expected formatted tokens in:\n${rendered}`);
  assert.ok(rendered.includes("40 tools"), `expected tool count in:\n${rendered}`);
});

// ── selectAgent(null) — back out of the drill-down (Finding D) ──

test("selectAgent(state, null) clears the selection", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = selectAgent(s, "ag_1");
  s = selectAgent(s, null);
  assert.strictEqual(s.selectedAgentId, null);
});

// ── Redraw-in-place regression (Finding B) ──

test("viewerClearSequence degrades to a single-line clear when nothing was rendered yet", () => {
  assert.strictEqual(viewerClearSequence(0), "\r\x1b[2K");
  assert.strictEqual(viewerClearSequence(-1), "\r\x1b[2K");
});

test("viewerClearSequence emits one cursor-up+clear-line pair per previously-rendered line", () => {
  const seq = viewerClearSequence(3);
  assert.strictEqual(seq, "\r\x1b[2K" + "\x1b[1A\x1b[2K".repeat(3));
});

test("viewerLineCount is 0 for an empty (hidden) render", () => {
  assert.strictEqual(viewerLineCount(""), 0);
});

test("viewerLineCount counts newline-separated lines", () => {
  assert.strictEqual(viewerLineCount("a\nb\nc"), 3);
  assert.strictEqual(viewerLineCount("solo line"), 1);
});

test("redraw clear sequence stays bounded across repeated cursor moves (Finding B regression: the old \\r\\x1b[2K only erased the input row, stacking a full duplicate tree in scrollback on every move)", () => {
  let s = applyViewerFrame(createViewerState(), wfStart);
  s = applyViewerFrame(s, spawn1);
  s = applyViewerFrame(s, spawn2);
  const baselineLen = viewerClearSequence(viewerLineCount(renderCiTree(s))).length;
  for (let i = 0; i < 5; i++) {
    s = moveCursor(s, i % 2 === 0 ? 1 : -1);
    const len = viewerClearSequence(viewerLineCount(renderCiTree(s))).length;
    assert.strictEqual(len, baselineLen, "clear sequence must not grow across repeated moves");
  }
});
