import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEventLine } from "../src/core/brain_protocol.js";
import { normalizeFrame } from "../src/core/stream.js";

// --- brain_protocol: decodeEvent via parseEventLine -------------------------
test("parses workflow_start", () => {
  const ev = parseEventLine(JSON.stringify({
    type: "workflow_start",
    workflow_id: "wf_abc",
    phases: [{ n: 1, type: "RECON", agents: 8 }],
    total_agents: 8,
  }));
  assert.ok(ev !== null);
  assert.strictEqual(ev!.type, "workflow_start");
  if (ev!.type === "workflow_start") {
    assert.strictEqual(ev.workflowId, "wf_abc");
    assert.strictEqual(ev.totalAgents, 8);
    assert.strictEqual(ev.phases.length, 1);
    assert.strictEqual(ev.phases[0]!.n, 1);
    assert.strictEqual(ev.phases[0]!.type, "RECON");
    assert.strictEqual(ev.phases[0]!.agents, 8);
  }
});

test("parses phase_start", () => {
  const ev = parseEventLine(JSON.stringify({
    type: "phase_start", phase_n: 1, phase_type: "RECON", agent_count: 8,
  }));
  assert.ok(ev !== null);
  assert.strictEqual(ev!.type, "phase_start");
  if (ev!.type === "phase_start") {
    assert.strictEqual(ev.phaseN, 1);
    assert.strictEqual(ev.phaseType, "RECON");
    assert.strictEqual(ev.agentCount, 8);
  }
});

test("parses phase_done", () => {
  const ev = parseEventLine(JSON.stringify({
    type: "phase_done", phase_n: 1, artifact_summary: "found 3 SSRF vectors",
  }));
  assert.ok(ev !== null);
  assert.strictEqual(ev!.type, "phase_done");
  if (ev!.type === "phase_done") {
    assert.strictEqual(ev.phaseN, 1);
    assert.strictEqual(ev.artifactSummary, "found 3 SSRF vectors");
  }
});

test("parses agent_spawn", () => {
  const ev = parseEventLine(JSON.stringify({
    type: "agent_spawn", agent_id: "ag_7", phase_n: 1, brief: "scan rate-limit",
  }));
  assert.ok(ev !== null);
  assert.strictEqual(ev!.type, "agent_spawn");
  if (ev!.type === "agent_spawn") {
    assert.strictEqual(ev.agentId, "ag_7");
    assert.strictEqual(ev.phaseN, 1);
    assert.strictEqual(ev.brief, "scan rate-limit");
  }
});

test("parses agent_progress", () => {
  const ev = parseEventLine(JSON.stringify({
    type: "agent_progress", agent_id: "ag_7", delta: "checking line 42...",
  }));
  assert.ok(ev !== null);
  assert.strictEqual(ev!.type, "agent_progress");
  if (ev!.type === "agent_progress") {
    assert.strictEqual(ev.agentId, "ag_7");
    assert.strictEqual(ev.delta, "checking line 42...");
  }
});

test("parses agent_done", () => {
  const ev = parseEventLine(JSON.stringify({
    type: "agent_done", agent_id: "ag_7", phase_n: 1, summary: "rate-limit bypass found",
  }));
  assert.ok(ev !== null);
  assert.strictEqual(ev!.type, "agent_done");
  if (ev!.type === "agent_done") {
    assert.strictEqual(ev.agentId, "ag_7");
    assert.strictEqual(ev.summary, "rate-limit bypass found");
  }
});

test("parses workflow_done", () => {
  const ev = parseEventLine(JSON.stringify({
    type: "workflow_done", synthesis: "Final synthesis", total_phases: 4, total_agents: 25,
  }));
  assert.ok(ev !== null);
  assert.strictEqual(ev!.type, "workflow_done");
  if (ev!.type === "workflow_done") {
    assert.strictEqual(ev.synthesis, "Final synthesis");
    assert.strictEqual(ev.totalAgents, 25);
    assert.strictEqual(ev.totalPhases, 4);
  }
});

// --- stream.ts: normalizeFrame (cloud SSE path) ----------------------------
test("normalizeFrame passes through workflow_start", () => {
  const f = normalizeFrame({
    type: "workflow_start",
    workflow_id: "wf_abc",
    phases: [{ n: 1, type: "RECON", agents: 8 }],
    total_agents: 8,
  });
  assert.ok(f !== null);
  assert.strictEqual(f!.type, "workflow_start");
});

test("normalizeFrame passes through agent_spawn", () => {
  const f = normalizeFrame({
    type: "agent_spawn", agent_id: "ag_1", phase_n: 1, brief: "scan auth",
  });
  assert.ok(f !== null);
  assert.strictEqual(f!.type, "agent_spawn");
});
