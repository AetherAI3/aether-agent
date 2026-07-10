import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTaskChainState,
  applyFrame,
} from "../src/ui/task_chain.js";
import type { BrainEvent } from "../src/core/brain_protocol.js";

const wfStart: BrainEvent = {
  type: "workflow_start",
  workflowId: "wf_abc",
  phases: [
    { n: 1, type: "RECON", agents: 8 },
    { n: 2, type: "IMPLEMENT", agents: 12 },
  ],
  totalAgents: 20,
};

test("initialises with no workflow", () => {
  const s = createTaskChainState();
  assert.strictEqual(s.workflowId, null);
  assert.strictEqual(s.phases.length, 0);
  assert.strictEqual(s.totalAgents, 0);
  assert.strictEqual(s.doneAgents, 0);
  assert.strictEqual(s.currentPhaseN, null);
});

test("sets workflowId + phases on workflow_start", () => {
  const s = applyFrame(createTaskChainState(), wfStart);
  assert.strictEqual(s.workflowId, "wf_abc");
  assert.strictEqual(s.phases.length, 2);
  assert.strictEqual(s.phases[0]!.status, "waiting");
  assert.strictEqual(s.phases[1]!.status, "waiting");
  assert.strictEqual(s.totalAgents, 20);
  assert.strictEqual(s.doneAgents, 0);
  assert.strictEqual(s.currentPhaseN, null);
});

test("marks phase running on phase_start", () => {
  let s = applyFrame(createTaskChainState(), wfStart);
  const phaseStart: BrainEvent = {
    type: "phase_start", phaseN: 1, phaseType: "RECON", agentCount: 8,
  };
  s = applyFrame(s, phaseStart);
  assert.strictEqual(s.phases[0]!.status, "running");
  assert.strictEqual(s.currentPhaseN, 1);
});

test("marks phase done + stores artifactSummary on phase_done", () => {
  let s = applyFrame(createTaskChainState(), wfStart);
  s = applyFrame(s, { type: "phase_start", phaseN: 1, phaseType: "RECON", agentCount: 8 } as BrainEvent);
  s = applyFrame(s, { type: "phase_done", phaseN: 1, artifactSummary: "found 3 issues" } as BrainEvent);
  assert.strictEqual(s.phases[0]!.status, "done");
  assert.strictEqual(s.phases[0]!.artifactSummary, "found 3 issues");
});

test("increments doneAgents on agent_done", () => {
  let s = applyFrame(createTaskChainState(), {
    type: "workflow_start", workflowId: "wf_x",
    phases: [{ n: 1, type: "RECON", agents: 2 }], totalAgents: 2,
  } as BrainEvent);
  s = applyFrame(s, { type: "agent_done", agentId: "ag_1", phaseN: 1, summary: "ok" } as BrainEvent);
  assert.strictEqual(s.doneAgents, 1);
  s = applyFrame(s, { type: "agent_done", agentId: "ag_2", phaseN: 1, summary: "ok" } as BrainEvent);
  assert.strictEqual(s.doneAgents, 2);
});

test("ignores non-workflow frames without error", () => {
  const s = applyFrame(createTaskChainState(), { type: "error", msg: "hello" } as BrainEvent);
  assert.strictEqual(s.workflowId, null);
});
