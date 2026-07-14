// Session log — local, structured, the user's. Distinct from the context pool
// (machine-facing vector memory): this is the human-readable history of a run.
// Append-only JSONL + a rendered monologue + a manifest, under
// ~/.aether-agent/logs/<session-id>/ (override with AETHER_LOG_DIR). `/clear`
// wipes the pool, never these logs. See spec neo_lite_..._killgate.md §5.
//
//   events.jsonl   one {ts, type, ...} per event/command (the record)
//   monologue.txt  the rendered human view (stage / skill / checkpoint lines)
//   manifest.json  {sessionId, task, model, poolGb, brain, started, ended, finalStatus, ...}

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrainEvent } from "./brain_protocol.js";
import type { ToolResult } from "./tool_executor.js";
import { registerRestore } from "../ui/restore.js";
import { normalizeWorkspace } from "./workspace_scope.js";

export function logsRoot(): string {
  return process.env["AETHER_LOG_DIR"] ?? join(homedir(), ".aether-agent", "logs");
}



const SENSITIVE_KEY = /token|secret|password|authorization|api[_-]?key|private[_-]?key|credential|pat/i;

function redactInline(value: string): string {
  return value
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/((?:token|secret|password|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .slice(0, 512);
}

function loggedArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => {
    if (SENSITIVE_KEY.test(key)) return [key, "[REDACTED]"];
    if (key.toLowerCase() === "content") {
      return [key, `[omitted ${Buffer.byteLength(String(value), "utf8")} bytes]`];
    }
    if (key.toLowerCase() === "command") return [key, "[omitted shell command]"];
    if (typeof value === "string") return [key, redactInline(value)];
    if (Array.isArray(value)) return [key, `[omitted ${value.length} items]`];
    if (value && typeof value === "object") return [key, "[omitted object]"];
    return [key, value];
  }));
}

/** Keep event records useful for audit while preventing prompts, file contents,
 * shell commands, and credential-shaped values from becoming durable logs. */
function loggedEvent(ev: BrainEvent): BrainEvent {
  switch (ev.type) {
    case "tool_call":
      return { ...ev, name: redactInline(ev.name), args: loggedArgs(ev.args) };
    case "memory": {
      const { text, narrative, description, triggers, action, skill, skill_name, ...metadata } = ev;
      return {
        ...metadata,
        ...(text != null && { text: `[omitted ${Buffer.byteLength(text, "utf8")} bytes]` }),
        ...(narrative != null && { narrative: "[omitted memory narrative]" }),
        ...(description != null && { description: "[omitted memory description]" }),
        ...(triggers != null && { triggers: `[omitted ${triggers.length} triggers]` }),
        ...(action != null && { action: "[omitted memory action]" }),
        ...(skill != null && { skill: redactInline(skill) }),
        ...(skill_name != null && { skill_name: redactInline(skill_name) }),
      } as BrainEvent;
    }
    case "stage": return { ...ev, name: redactInline(ev.name), face: redactInline(ev.face) };
    case "skill": return { ...ev, name: redactInline(ev.name), reason: redactInline(ev.reason) };
    case "monologue": return { ...ev, text: redactInline(ev.text) };
    case "checkpoint": return { ...ev, gitSha: redactInline(ev.gitSha) };
    case "done": return { ...ev, result: redactInline(ev.result), reason: redactInline(ev.reason) };
    case "error": return { ...ev, msg: redactInline(ev.msg) };
    case "workflow_start": return { ...ev, workflowId: redactInline(ev.workflowId) };
    case "phase_start": return { ...ev, phaseType: redactInline(ev.phaseType) };
    case "phase_done": return { ...ev, artifactSummary: redactInline(ev.artifactSummary) };
    case "agent_spawn": return { ...ev, agentId: redactInline(ev.agentId), brief: redactInline(ev.brief) };
    case "agent_progress": return { ...ev, agentId: redactInline(ev.agentId), delta: redactInline(ev.delta) };
    case "agent_done": return { ...ev, agentId: redactInline(ev.agentId), summary: redactInline(ev.summary) };
    case "workflow_done": return { ...ev, synthesis: redactInline(ev.synthesis) };
    default: return ev;
  }
}

/** The terminal status of a run. Derived by the host's verify gate (verify_gate.ts)
 * from a real final test run — NEVER from the brain's self-report. "ok" only when the
 * host's tests are green; the breaker reasons (stalled/no-progress/max-turns) are the
 * brain's, surfaced through when the host is red; "unverified" when there is no gate. */
export type FinalStatus =
  | "ok"
  | "incomplete"
  | "unverified"
  | "stalled"
  | "no-progress"
  | "max-turns"
  | "failed"
  | "error";

export interface SessionMeta {
  task: string;
  model: string;
  poolGb: number;
  brain: "local" | "cloud";
  cwd: string;
}

export class SessionLog {
  readonly dir: string;
  readonly sessionId: string;
  private readonly eventsPath: string;
  private readonly monologuePath: string;
  private readonly manifestPath: string;
  private events = 0;
  private toolCalls = 0;
  private readonly started: string;

  /** `now` is injected (ISO string) so the caller owns the clock — testable,
   * and the runtime never reaches for a forbidden Date() internally. */
  constructor(
    private readonly meta: SessionMeta,
    now: string,
    root: string = logsRoot(),
  ) {
    this.started = now;
    // process.pid makes the session dir collision-proof: two `aether code`
    // invocations with the same brain starting in the same millisecond would
    // otherwise resolve to the same directory, and the eager truncation below
    // would silently wipe the other, already-running session's events.
    this.sessionId = now.replace(/[:.]/g, "-") + "-" + String(meta.brain) + "-" + process.pid;
    this.dir = join(root, this.sessionId);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.eventsPath = join(this.dir, "events.jsonl");
    this.monologuePath = join(this.dir, "monologue.txt");
    writeFileSync(this.eventsPath, "", { encoding: "utf8", mode: 0o600 });
    writeFileSync(this.monologuePath, "", { encoding: "utf8", mode: 0o600 });
    this.manifestPath = join(this.dir, "manifest.json");
    this.writeManifest(null);
    // Batched writes must still land if the process exits abruptly (SIGINT
    // handlers call process.exit) — the exit hook drains the buffer.
    this.unregisterFlush = registerRestore(() => this.flush());
  }

  private readonly unregisterFlush: () => void;

  /** Record one brain event (and mirror human-readable lines to monologue.txt). */
  event(ev: BrainEvent, ts: string): void {
    this.events += 1;
    if (ev.type === "tool_call") this.toolCalls += 1;
    const safe = loggedEvent(ev);
    this.buffer(this.eventsPath, JSON.stringify({ ts, ...safe }) + "\n");
    const line = monologueLine(safe);
    if (line) this.buffer(this.monologuePath, line + "\n");
  }

  /** Record the host's tool execution result (the other half of a tool_call). */
  toolResult(id: string, result: ToolResult, ts: string): void {
    this.buffer(
      this.eventsPath,
      JSON.stringify({ ts, type: "tool_result", id, exit_code: result.exitCode }) + "\n",
    );
  }

  // ── buffered appends ──────────────────────────────────────────────────────
  // A synchronous appendFileSync per stream event serializes disk I/O into the
  // presentation hot path (one fsync-able write per token burst). Events are
  // coalesced and flushed every FLUSH_EVERY events or FLUSH_MS ms, whichever
  // comes first — and always on close(), so the record stays loss-bounded.
  private static readonly FLUSH_EVERY = 50;
  private static readonly FLUSH_MS = 100;
  private pending = new Map<string, string[]>();
  private pendingCount = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private buffer(path: string, chunk: string): void {
    let arr = this.pending.get(path);
    if (!arr) {
      arr = [];
      this.pending.set(path, arr);
    }
    arr.push(chunk);
    this.pendingCount += 1;
    if (this.pendingCount >= SessionLog.FLUSH_EVERY) {
      this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), SessionLog.FLUSH_MS);
      if (typeof this.flushTimer.unref === "function") this.flushTimer.unref();
    }
  }

  /** Write all buffered lines to disk. Idempotent; safe to call any time. */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingCount === 0) return;
    for (const [path, chunks] of this.pending) {
      if (chunks.length) appendFileSync(path, chunks.join(""), "utf8");
    }
    this.pending.clear();
    this.pendingCount = 0;
  }

  /** Finalize the manifest. `finalStatus` is derived from the HOST's own final
   * test run (ground truth), never from the brain's self-report. `remaining` =
   * failing tests when not ok (only written when > 0). */
  close(finalStatus: FinalStatus, ended: string, remaining = 0): void {
    this.flush();
    this.unregisterFlush();
    this.writeManifest({ ended, finalStatus, remaining });
  }

  private writeManifest(end: { ended: string; finalStatus: string; remaining?: number } | null): void {
    writeFileSync(
      this.manifestPath,
      JSON.stringify(
        {
          sessionId: this.sessionId,
          task: redactInline(this.meta.task),
          model: this.meta.model,
          poolGb: this.meta.poolGb,
          brain: this.meta.brain,
          cwd: normalizeWorkspace(this.meta.cwd),
          started: this.started,
          ended: end?.ended ?? null,
          finalStatus: end?.finalStatus ?? "running",
          events: this.events,
          toolCalls: this.toolCalls,
          ...(end?.remaining != null && end.remaining > 0 && { remaining: end.remaining }),
        },
        null,
        2,
      ) + "\n",
      { encoding: "utf8", mode: 0o600 },
    );
  }
}

/** The human-facing monologue line for an event (null = not shown in the tree). */
export function monologueLine(ev: BrainEvent): string | null {
  switch (ev.type) {
    case "stage":
      return `* ${ev.name}`;
    case "skill":
      return `  ⌁ skill ${ev.name}${ev.reason ? ` (${ev.reason})` : ""}`;
    case "monologue":
      return `${"  ".repeat(ev.depth + 1)}${ev.depth > 0 ? "└─ " : ""}${ev.text}`;
    case "tool_call":
      return `  : ${ev.name}`;
    case "checkpoint":
      return `  [▪]→[▪▪] checkpoint ${ev.gitSha}`;
    case "done":
      return `\n${ev.ok ? "OKAY" : "FAIL"} ${ev.result}`;
    case "error":
      return `✗ ${ev.msg}`;
    default:
      return null; // status/telemetry are live-only, not part of the record tree
  }
}
