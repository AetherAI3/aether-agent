// CloudBrain — the cloud transport. Surfaces the existing AetherCloud universal
// SSE stream through the SAME BrainEvent vocabulary the local brain emits, so
// the host renders cloud and local runs identically.
//
// Honest boundary (today's server contract): the universal stream is one-way
// and runs its tools server-side, so it does NOT yet emit `tool_call` frames or
// accept an upstream `tool_result`. CloudBrain therefore maps the frames that
// exist (delta/reasoning/task_*/done/error) and `sendToolResult` is a no-op.
// When the server adds tool_call frames + an upstream channel, this class
// implements the same round-trip the local brain already does — no host change.

import type { Brain, TaskCommand } from "./brain.js";
import { EventQueue } from "./brain.js";
import type { BrainEvent } from "./brain_protocol.js";
import type { ApiClient } from "./transport.js";
import { CHAT_STREAM_PATH, CHAT_PATH, defaultStreamTimeoutMs } from "./transport.js";
import { buildChatRequest } from "./envelope.js";
import { decodeSse, type StreamFrame } from "./stream.js";
import { StreamIncompleteError, StreamUnavailableError } from "./errors.js";
import { appendCustody } from "./custody.js";
import { hintFor } from "./error_hints.js";

export class CloudBrain implements Brain {
  private aborted = false;

  constructor(private readonly api: ApiClient) {}

  run(task: TaskCommand): AsyncIterable<BrainEvent> {
    const queue = new EventQueue();
    void this.pump(task, queue);
    return queue.drain();
  }

  private async pump(task: TaskCommand, queue: EventQueue): Promise<void> {
    const req = buildChatRequest({
      prompt: task.text,
      model: task.model || undefined,
      manualModel: Boolean(task.model),
    });
    queue.push({ type: "stage", name: "execute", face: "⟨◉⟩" }); // uplink face
    try {
      const stream = await this.api.stream(CHAT_STREAM_PATH, req);
      // The terminal done must be ground truth, never fabricated success
      // (CONTRACTS.md invariant 5): a streamed error, a user abort, or the
      // stream ending without ever sending a terminal done/error frame (a
      // clean-looking premature close — LOOP-06 round 3) all end the run
      // ok:false. Custody receipts persist here too — the server stores
      // nothing; the client-held log is the only copy.
      let failed: string | null = null;
      let sawDone = false;
      for await (const frame of decodeSse(stream)) {
        if (this.aborted) break;
        if (frame.type === "custody") appendCustody(frame.custody);
        if (frame.type === "error") failed = frame.msg;
        if (frame.type === "done") sawDone = true;
        const ev = mapFrame(frame);
        if (ev) queue.push(ev);
      }
      if (failed) {
        queue.push({ type: "done", ok: false, result: failed, remaining: 0, reason: "" });
      } else if (this.aborted) {
        queue.push({ type: "done", ok: false, result: "aborted", remaining: 0, reason: "" });
      } else if (!sawDone) {
        queue.push({ type: "done", ok: false, result: withHint(new StreamIncompleteError()), remaining: 0, reason: "" });
      } else {
        queue.push({ type: "done", ok: true, result: "", remaining: 0, reason: "" });
      }
    } catch (err) {
      if (err instanceof StreamUnavailableError) {
        // Fail-soft: non-streaming fallback (contract `{"stream": false}`). A
        // full LLM turn can legitimately run long, so this opts into
        // stream()'s own generous bound rather than request()'s 30s
        // metadata-call default (LOOP-01/LOOP-06 round-1).
        try {
          const r = await this.api.postJson<{ response?: string }>(CHAT_PATH, req, undefined, defaultStreamTimeoutMs());
          queue.push({ type: "monologue", text: r.response ?? "", depth: 0 });
          queue.push({ type: "done", ok: true, result: r.response ?? "", remaining: 0, reason: "" });
        } catch (e2) {
          queue.push({ type: "error", msg: withHint(e2) });
        }
      } else {
        queue.push({ type: "error", msg: withHint(err) });
      }
    } finally {
      queue.end();
    }
  }

  // The cloud stream executes tools server-side today; nothing to send back.
  sendToolResult(): void {}
  control(): void {}
  close(): void {
    this.aborted = true;
  }
}

/** Error message plus its recovery hint (if any), e.g. for a StreamTimeoutError:
 *  "stream timed out after 120s with no data (the stream went quiet - retry, or /doctor to check connectivity)". */
function withHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const hint = hintFor(err);
  return hint ? `${msg} (${hint})` : msg;
}

/** Map a universal SSE frame onto the bridge event vocabulary (null = ignore). */
function mapFrame(f: StreamFrame): BrainEvent | null {
  switch (f.type) {
    case "reasoning":
      return { type: "monologue", text: f.text, depth: 1 };
    case "delta":
      return { type: "monologue", text: f.text, depth: 0 };
    case "task_start":
      return { type: "stage", name: f.label ?? "task", face: "(ง'̀-'́)ง" };
    case "task_done":
      return { type: "checkpoint", gitSha: f.taskId ?? "" };
    case "task_failed":
      return { type: "error", msg: f.msg ?? "task failed" };
    case "error":
      return { type: "error", msg: f.msg };
    case "done":
      return null; // the pump emits its own terminal done after the loop
    case "memory": {
      const { type: _, ...rest } = f;
      return { type: "memory", ...rest };
    }
    case "workflow_start":
      return {
        type: "workflow_start",
        workflowId: f.workflow_id,
        phases: f.phases,
        totalAgents: f.total_agents,
      };
    case "phase_start":
      return {
        type: "phase_start",
        phaseN: f.phase_n,
        phaseType: f.phase_type,
        agentCount: f.agent_count,
      };
    case "phase_done":
      return {
        type: "phase_done",
        phaseN: f.phase_n,
        artifactSummary: f.artifact_summary,
      };
    case "agent_spawn":
      return {
        type: "agent_spawn",
        agentId: f.agent_id,
        phaseN: f.phase_n,
        brief: f.brief,
      };
    case "agent_progress":
      return {
        type: "agent_progress",
        agentId: f.agent_id,
        delta: f.delta,
      };
    case "agent_done":
      return {
        type: "agent_done",
        agentId: f.agent_id,
        phaseN: f.phase_n,
        summary: f.summary,
        tokens: f.tokens,
        toolCalls: f.tool_calls,
        durationMs: f.duration_ms,
      };
    case "workflow_done":
      return {
        type: "workflow_done",
        synthesis: f.synthesis,
        totalPhases: f.total_phases,
        totalAgents: f.total_agents,
      };
    default:
      return null; // open/ping/usage/custody/etc. — not part of the agent view
  }
}
