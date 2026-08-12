// CloudBrain — the cloud transport. Surfaces the Aether API through the SAME
// BrainEvent vocabulary the local brain emits, so the host renders cloud and
// local runs identically.
//
// Primary path (dev-session protocol): POST /agent/dev/sessions creates a
// server-side coding session; GET .../stream delivers seq-numbered frames
// (tool_call included); the host executes locally and sendToolResult() POSTs
// the result back (idempotent server-side). control() maps pause/resume/steer
// onto POST .../control. This is the real bidirectional round-trip: the API is
// the brain, this machine is the authority — code stays local.
//
// Fallback path (legacy one-way chat stream): when the server has no dev
// route (404) or the feature is off (403), CloudBrain degrades to the
// pre-existing /agent/chat/stream behavior, where sendToolResult/control are
// documented no-ops because the server runs its tools server-side.

import type { Brain, TaskCommand } from "./brain.js";
import { EventQueue } from "./brain.js";
import type { BrainEvent } from "./brain_protocol.js";
import { TOOLS } from "./brain_protocol.js";
import type { ToolResult } from "./tool_executor.js";
import type { ApiClient } from "./transport.js";
import {
  CHAT_STREAM_PATH,
  CHAT_PATH,
  DEV_SESSIONS_PATH,
  devSessionStreamPath,
  devSessionToolResultsPath,
  devSessionControlPath,
  devSessionPath,
  defaultStreamTimeoutMs,
} from "./transport.js";
import { buildChatRequest, buildDevSessionRequest } from "./envelope.js";
import { decodeSse, type StreamFrame } from "./stream.js";
import { HttpError, StreamIncompleteError, StreamUnavailableError } from "./errors.js";
import { appendCustody } from "./custody.js";
import { hintFor } from "./error_hints.js";

/** Version of the dev-session wire protocol this client speaks. */
export const DEV_PROTOCOL_VERSION = 1;

/** Reconnect budget for a dropped dev-session stream (resets on progress). */
const MAX_RECONNECTS = 3;
const RECONNECT_DELAY_MS = 1_000;

interface DevSessionCreated {
  session_id: string;
  protocol_version: number;
  model?: string;
  tools?: string[];
}

export class CloudBrain implements Brain {
  private aborted = false;
  private net: AbortController | null = null;
  private sessionId: string | null = null;
  private lastSeq = 0;
  /** Serializes upstream result POSTs so they arrive in execution order. */
  private upstream: Promise<void> = Promise.resolve();

  constructor(private readonly api: ApiClient) {}

  run(task: TaskCommand): AsyncIterable<BrainEvent> {
    const queue = new EventQueue();
    void this.pump(task, queue);
    return queue.drain();
  }

  private async pump(task: TaskCommand, queue: EventQueue): Promise<void> {
    try {
      let created: DevSessionCreated | null = null;
      try {
        created = await this.api.postJson<DevSessionCreated>(
          DEV_SESSIONS_PATH,
          buildDevSessionRequest({
            task: task.text,
            model: task.model,
            effort: task.effort,
            capabilities: TOOLS,
            protocolVersion: DEV_PROTOCOL_VERSION,
          }),
        );
      } catch (err) {
        if (isLegacyServer(err)) {
          await this.legacyPump(task, queue);
          return;
        }
        throw err;
      }
      this.sessionId = created.session_id;
      queue.push({ type: "stage", name: "execute", face: "⟨◉⟩" }); // uplink face
      await this.devPump(queue);
    } catch (err) {
      queue.push({ type: "error", msg: withHint(err) });
    } finally {
      queue.end();
    }
  }

  /** Consume the dev-session stream, reconnecting from lastSeq on a drop. */
  private async devPump(queue: EventQueue): Promise<void> {
    const id = this.sessionId as string;
    let failed: string | null = null;
    let sawDone = false;
    let doneOk = true;
    let reconnects = 0;

    while (!this.aborted && !sawDone && !failed) {
      this.net = new AbortController();
      let progressed = false;
      try {
        const stream = await this.api.stream(devSessionStreamPath(id, this.lastSeq), undefined, {
          method: "GET",
          signal: this.net.signal,
        });
        for await (const frame of decodeSse(stream)) {
          if (this.aborted) break;
          // Duplicate delivery is safe by contract: a replayed frame keeps its
          // seq, so anything at or below the high-water mark is skipped and a
          // mutating tool_call can never execute twice.
          if (typeof frame.seq === "number") {
            if (frame.seq <= this.lastSeq) continue;
            this.lastSeq = frame.seq;
            progressed = true;
            reconnects = 0;
          }
          if (frame.type === "custody") appendCustody(frame.custody);
          if (frame.type === "error") failed = frame.msg;
          if (frame.type === "done") {
            sawDone = true;
            doneOk = frame.ok !== false;
          }
          const ev = mapDevFrame(frame);
          if (ev) queue.push(ev);
          if (sawDone || failed) break;
        }
      } catch (err) {
        if (this.aborted) break;
        if (reconnects >= MAX_RECONNECTS) {
          failed = withHint(err);
          break;
        }
        reconnects += 1;
        await sleep(RECONNECT_DELAY_MS * reconnects);
        continue;
      }
      if (this.aborted || sawDone || failed) break;
      // Stream ended cleanly without a terminal frame — reconnect from seq
      // unless the budget is spent (a quiet server keeps its socket open, so
      // a clean early end is either a proxy hiccup or a dead session).
      if (reconnects >= MAX_RECONNECTS && !progressed) {
        failed = withHint(new StreamIncompleteError());
        break;
      }
      reconnects += 1;
      await sleep(RECONNECT_DELAY_MS * reconnects);
    }

    if (failed) {
      queue.push({ type: "done", ok: false, result: failed, remaining: 0, reason: "" });
    } else if (this.aborted) {
      queue.push({ type: "done", ok: false, result: "aborted", remaining: 0, reason: "" });
    } else {
      queue.push({ type: "done", ok: doneOk, result: "", remaining: 0, reason: "" });
    }
  }

  /** The pre-dev-protocol one-way chat stream (older/flagged-off servers). */
  private async legacyPump(task: TaskCommand, queue: EventQueue): Promise<void> {
    const req = buildChatRequest({
      prompt: task.text,
      model: task.model || undefined,
      manualModel: Boolean(task.model),
    });
    queue.push({ type: "stage", name: "execute", face: "⟨◉⟩" });
    try {
      this.net = new AbortController();
      const stream = await this.api.stream(CHAT_STREAM_PATH, req, { signal: this.net.signal });
      // The terminal done must be ground truth, never fabricated success
      // (CONTRACTS.md invariant 5): a streamed error, a user abort, or a
      // clean-looking premature close all end the run ok:false. Custody
      // receipts persist here too — the client-held log is the only copy.
      let failed: string | null = null;
      let sawDone = false;
      for await (const frame of decodeSse(stream)) {
        if (this.aborted) break;
        if (frame.type === "custody") appendCustody(frame.custody);
        if (frame.type === "error") failed = frame.msg;
        if (frame.type === "done") sawDone = true;
        const ev = mapLegacyFrame(frame);
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
        // stream()'s own generous bound rather than request()'s 30s default.
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
    }
  }

  /** POST a locally executed tool result upstream. Serialized so results land
   *  in execution order; retried once (the server accepts duplicates as
   *  idempotent no-ops, so a lost ack can never double-apply). */
  sendToolResult(id: string, result: ToolResult): void {
    const sessionId = this.sessionId;
    if (!sessionId) return; // legacy path: server ran the tool itself
    const body = {
      tool_call_id: id,
      status: result.exitCode === 0 ? "ok" : "error",
      exit_code: result.exitCode,
      output: result.output,
      truncated: false,
    };
    this.upstream = this.upstream.then(async () => {
      const path = devSessionToolResultsPath(sessionId);
      try {
        await this.api.postJson(path, body);
      } catch {
        if (this.aborted) return;
        await sleep(RECONNECT_DELAY_MS);
        try {
          await this.api.postJson(path, body);
        } catch {
          // Deliberately swallowed: the server's tool-result timeout will
          // terminate the session with a clear error frame; throwing here
          // would only crash the host loop mid-render.
        }
      }
    });
  }

  control(action: "pause" | "resume" | "steer", note?: string): void {
    const sessionId = this.sessionId;
    if (!sessionId) return; // legacy path: no server session to control
    void this.api
      .postJson(devSessionControlPath(sessionId), { action, note: note ?? null })
      .catch(() => {}); // fire-and-forget; a lost steer is re-typeable
  }

  close(): void {
    this.aborted = true;
    this.net?.abort();
    const sessionId = this.sessionId;
    if (sessionId) {
      void this.api.deleteJson(devSessionPath(sessionId)).catch(() => {});
    }
  }
}

/** Error message plus its recovery hint (if any). */
function withHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const hint = hintFor(err);
  return hint ? `${msg} (${hint})` : msg;
}

/** An older/flagged-off server: no dev-session route. 404 = route absent,
 *  403 = AETHER_AGENT_DEV_ENABLED off — both degrade to the legacy stream. */
function isLegacyServer(err: unknown): boolean {
  return err instanceof HttpError && (err.status === 404 || err.status === 403);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Map a dev-session frame onto the bridge event vocabulary (null = ignore). */
function mapDevFrame(f: StreamFrame): BrainEvent | null {
  switch (f.type) {
    case "session":
      return { type: "status", phase: `session ${f.model ?? ""}`.trim(), poolUsed: 0, poolCap: 0 };
    case "tool_call":
      return { type: "tool_call", id: f.toolCallId, name: f.name, args: f.args };
    case "reasoning":
      return { type: "monologue", text: f.text, depth: 1 };
    case "delta":
      return { type: "monologue", text: f.text, depth: 0 };
    case "error":
      return { type: "error", msg: f.msg };
    case "done":
      return null; // devPump emits its own terminal done
    default:
      return null; // open/ping/usage/tool_result_ack/custody — not agent view
  }
}

/** Map a legacy universal SSE frame onto the bridge vocabulary (null = ignore). */
function mapLegacyFrame(f: StreamFrame): BrainEvent | null {
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
