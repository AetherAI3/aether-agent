import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEventLine } from "../src/core/brain_protocol.js";
import { createTaskChainState, applyFrame } from "../src/ui/task_chain.js";
import { createViewerState, applyViewerFrame } from "../src/ui/workflow_viewer.js";

// Pure state composition tests — verify state reducers handle workflow frames correctly.
// These don't test brain_cloud.ts directly; they verify the composition contract that
// brain_cloud.ts will enforce when routing frames.

test("workflow_start updates both task chain and viewer", () => {
  const frame = parseEventLine(JSON.stringify({
    type: "workflow_start", workflow_id: "wf_test",
    phases: [{ n: 1, type: "RECON", agents: 3 }], total_agents: 3,
  }));
  assert.ok(frame !== null);
  const chain = applyFrame(createTaskChainState(), frame!);
  const viewer = applyViewerFrame(createViewerState(), frame!);

  assert.strictEqual(chain.workflowId, "wf_test");
  assert.strictEqual(chain.phases.length, 1);
  assert.strictEqual(viewer.visible, true);
});

test("phase_start updates task chain, not viewer agents", () => {
  const startFrame = parseEventLine(JSON.stringify({
    type: "workflow_start", workflow_id: "wf_x",
    phases: [{ n: 1, type: "RECON", agents: 3 }], total_agents: 3,
  }))!;
  const phaseFrame = parseEventLine(JSON.stringify({
    type: "phase_start", phase_n: 1, phase_type: "RECON", agent_count: 3,
  }))!;
  let chain = applyFrame(createTaskChainState(), startFrame);
  chain = applyFrame(chain, phaseFrame);
  const viewer = applyViewerFrame(applyViewerFrame(createViewerState(), startFrame), phaseFrame);

  assert.strictEqual(chain.phases[0]!.status, "running");
  assert.strictEqual(viewer.agents.length, 0); // phase_start doesn't add agents to viewer
});

test("agent_spawn updates viewer, not task chain phases", () => {
  const startFrame = parseEventLine(JSON.stringify({
    type: "workflow_start", workflow_id: "wf_x", phases: [], total_agents: 1,
  }))!;
  const spawnFrame = parseEventLine(JSON.stringify({
    type: "agent_spawn", agent_id: "ag_1", phase_n: 1, brief: "scan auth",
  }))!;
  let viewer = applyViewerFrame(createViewerState(), startFrame);
  viewer = applyViewerFrame(viewer, spawnFrame);
  const chain = applyFrame(applyFrame(createTaskChainState(), startFrame), spawnFrame);

  assert.strictEqual(viewer.agents.length, 1);
  assert.strictEqual(chain.phases.length, 0); // agent_spawn doesn't affect chain phases
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
