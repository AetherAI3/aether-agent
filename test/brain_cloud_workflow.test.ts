import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEventLine } from "../src/core/brain_protocol.js";
import { createViewerState, applyViewerFrame } from "../src/ui/workflow_viewer.js";

// Pure state composition tests — verify the reducer handles workflow frames
// correctly. These don't test brain_cloud.ts directly; they verify the
// composition contract that brain_cloud.ts will enforce when routing frames.
//
// task_chain.ts (a separate, unused-in-production phase-tracking prototype)
// used to be exercised here alongside workflow_viewer.ts to prove the two
// data models didn't step on each other. Finding C
// (docs/specs/2026-07-10-workflow-viewer-agent-panel-design.md) absorbed its
// phase logic into WorkflowViewerState and the file was deleted as dead code
// — these tests now verify the same non-interference property between the
// unified state's `phases` and `agents` slices instead.

test("workflow_start populates both phases and viewer visibility", () => {
  const frame = parseEventLine(JSON.stringify({
    type: "workflow_start", workflow_id: "wf_test",
    phases: [{ n: 1, type: "RECON", agents: 3 }], total_agents: 3,
  }));
  assert.ok(frame !== null);
  const viewer = applyViewerFrame(createViewerState(), frame!);

  assert.strictEqual(viewer.workflowId, "wf_test");
  assert.strictEqual(viewer.phases.length, 1);
  assert.strictEqual(viewer.visible, true);
});

test("phase_start updates phases, not agents", () => {
  const startFrame = parseEventLine(JSON.stringify({
    type: "workflow_start", workflow_id: "wf_x",
    phases: [{ n: 1, type: "RECON", agents: 3 }], total_agents: 3,
  }))!;
  const phaseFrame = parseEventLine(JSON.stringify({
    type: "phase_start", phase_n: 1, phase_type: "RECON", agent_count: 3,
  }))!;
  const viewer = applyViewerFrame(applyViewerFrame(createViewerState(), startFrame), phaseFrame);

  assert.strictEqual(viewer.phases[0]!.status, "running");
  assert.strictEqual(viewer.agents.length, 0); // phase_start doesn't add agents
});

test("agent_spawn updates agents, not phases", () => {
  const startFrame = parseEventLine(JSON.stringify({
    type: "workflow_start", workflow_id: "wf_x",
    phases: [{ n: 1, type: "RECON", agents: 1 }], total_agents: 1,
  }))!;
  const spawnFrame = parseEventLine(JSON.stringify({
    type: "agent_spawn", agent_id: "ag_1", phase_n: 1, brief: "scan auth",
  }))!;
  let viewer = applyViewerFrame(createViewerState(), startFrame);
  viewer = applyViewerFrame(viewer, spawnFrame);

  assert.strictEqual(viewer.agents.length, 1);
  assert.strictEqual(viewer.phases[0]!.status, "waiting"); // agent_spawn doesn't affect phase status
});

test("agent_progress accumulates in viewer feed", () => {
  const startFrame = parseEventLine(JSON.stringify({
    type: "workflow_start", workflow_id: "wf_x", phases: [], total_agents: 1,
  }))!;
  const spawnFrame = parseEventLine(JSON.stringify({
    type: "agent_spawn", agent_id: "ag_1", phase_n: 1, brief: "scan",
  }))!;
  const prog1 = parseEventLine(JSON.stringify({
    type: "agent_progress", agent_id: "ag_1", delta: "A",
  }))!;
  const prog2 = parseEventLine(JSON.stringify({
    type: "agent_progress", agent_id: "ag_1", delta: "B",
  }))!;
  let viewer = applyViewerFrame(createViewerState(), startFrame);
  viewer = applyViewerFrame(viewer, spawnFrame);
  viewer = applyViewerFrame(viewer, prog1);
  viewer = applyViewerFrame(viewer, prog2);
  assert.strictEqual(viewer.agents[0]!.feed, "AB");
});
