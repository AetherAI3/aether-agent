// Session log — local, structured, the user's. Distinct from the context pool
// (machine-facing vector memory): this is the human-readable history of a run.
// Append-only JSONL + a rendered monologue + a manifest, under
// ~/.aether-code/logs/<session-id>/ (override with AETHER_LOG_DIR). `/clear`
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

export function logsRoot(): string {
  return process.env["AETHER_LOG_DIR"] ?? join(homedir(), ".aether-code", "logs");
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
    this.sessionId = now.replace(/[:.]/g, "-") + "-" + String(meta.brain);
    this.dir = join(root, this.sessionId);
    mkdirSync(this.dir, { recursive: true });
    this.eventsPath = join(this.dir, "events.jsonl");
    this.monologuePath = join(this.dir, "monologue.txt");
    this.manifestPath = join(this.dir, "manifest.json");
    this.writeManifest(null);
  }

  /** Record one brain event (and mirror human-readable lines to monologue.txt). */
  event(ev: BrainEvent, ts: string): void {
    this.events += 1;
    if (ev.type === "tool_call") this.toolCalls += 1;
    appendFileSync(this.eventsPath, JSON.stringify({ ts, ...ev }) + "\n", "utf8");
    const line = monologueLine(ev);
    if (line) appendFileSync(this.monologuePath, line + "\n", "utf8");
  }

  /** Record the host's tool execution result (the other half of a tool_call). */
  toolResult(id: string, result: ToolResult, ts: string): void {
    appendFileSync(
      this.eventsPath,
      JSON.stringify({ ts, type: "tool_result", id, exit_code: result.exitCode }) + "\n",
      "utf8",
    );
  }

  /** Finalize the manifest. `finalStatus` is derived from the HOST's own final
   * test run (ground truth), never from the brain's self-report. `remaining` =
   * failing tests when not ok (only written when > 0). */
  close(finalStatus: FinalStatus, ended: string, remaining = 0): void {
    this.writeManifest({ ended, finalStatus, remaining });
  }

  private writeManifest(end: { ended: string; finalStatus: string; remaining?: number } | null): void {
    writeFileSync(
      this.manifestPath,
      JSON.stringify(
        {
          sessionId: this.sessionId,
          task: this.meta.task,
          model: this.meta.model,
          poolGb: this.meta.poolGb,
          brain: this.meta.brain,
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
      "utf8",
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
