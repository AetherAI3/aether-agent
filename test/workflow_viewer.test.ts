import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createViewerState,
  applyViewerFrame,
  selectAgent,
  moveCursor,
  renderCiTree,
  renderAgentFeed,
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
