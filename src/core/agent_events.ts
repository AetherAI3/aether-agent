// agent_events.ts — transport-agnostic agent event source for the terminal UI +
// the adapter from the bridge's BrainEvent onto the animation layer's AgentEvent.
// Both local AND cloud `aether code` runs feed BrainEvents into the same
// LocalAgentSource (a synthetic heartbeat per loop tick, regardless of which
// brain produced the events) — the AnimationController consumes the SAME
// AgentEvent stream either way. NO protocol change (presentation-only adapter).

import type { BrainEvent } from "./brain_protocol.js";
import { clipCodePoints } from "../ui/theme.js";

// The UI's event vocabulary (smaller than BrainEvent — presentation slice).
export type AgentEvent =
  | { type: "stage"; stage: string }
  | { type: "tool"; name: string; args?: string }
  | { type: "commit"; sha: string }
  | { type: "token"; used: number; cap: number }
  | { type: "heartbeat" }
  | { type: "done" }
  | { type: "error"; message?: string }
  // log = a plain transcript line (monologue / skill / fray markers); not an anim event.
  | { type: "log"; line: string };

/** Adapt one bridge BrainEvent to the UI AgentEvent (null = ignore). */
export function mapBrainEvent(ev: BrainEvent): AgentEvent | null {
  switch (ev.type) {
    case "stage":
      return { type: "stage", stage: ev.name };
    case "tool_call":
      return { type: "tool", name: ev.name, args: argHint(ev.args) };
    case "checkpoint":
      return { type: "commit", sha: ev.gitSha };
    case "status":
      return { type: "token", used: ev.poolUsed, cap: ev.poolCap };
    case "skill":
      return { type: "log", line: `  ⌁ skill ${ev.name}${ev.reason ? ` (${ev.reason})` : ""}` };
    case "monologue":
      return { type: "log", line: `${"  ".repeat(ev.depth + 1)}${ev.depth > 0 ? "└─ " : ""}${ev.text}` };
    case "done":
      return { type: "done" };
    case "error":
      return { type: "error", message: ev.msg };
    default:
      return null; // telemetry — not part of the UI slice
  }
}

function argHint(args: Record<string, unknown>): string {
  const k = args["path"] ?? args["command"] ?? args["query"] ?? args["message"] ?? "";
  return clipCodePoints(String(k), 60);
}

export interface AgentSource {
  on(handler: (e: AgentEvent) => void): void;
  close(): void;
}

// ---- Fed BrainEvents from the host loop (either brain); synthetic heartbeat per tick ----
// Stages/tool/commit/token fire REGARDLESS of any cloud connection; the heartbeat
// keeps the watchdog behaviour identical to cloud.
export class LocalAgentSource implements AgentSource {
  private readonly handlers: Array<(e: AgentEvent) => void> = [];
  private readonly hb: ReturnType<typeof setInterval>;

  constructor(heartbeatMs = 1000) {
    this.hb = setInterval(() => this.emit({ type: "heartbeat" }), heartbeatMs);
    if (typeof this.hb.unref === "function") this.hb.unref(); // never keep the process alive
  }

  /** Feed one BrainEvent from the host loop; it is adapted + dispatched. */
  feedBrain(ev: BrainEvent): void {
    const a = mapBrainEvent(ev);
    if (a) this.emit(a);
  }

  on(h: (e: AgentEvent) => void): void {
    this.handlers.push(h);
  }
  close(): void {
    clearInterval(this.hb);
  }
  private emit(e: AgentEvent): void {
    for (const h of this.handlers) h(e);
  }
}

// ---- The screen authority + animation/heartbeat interfaces bindEventSource drives ----
export interface UiSink {
  log(line: string): void;
  end?(): void;
}
export interface AnimSink {
  setStage(stage: string): void;
  setProgress(used: number, cap: number): void;
  markStalled(): void;
  resume(): void;
  stop(): void;
}
export interface HeartbeatSink {
  beat(): void;
  markStalled(): void;
}

export interface BindOptions {
  heartbeatTimeoutMs?: number;
  hb?: HeartbeatSink;
}

/** Bind a source to the UI + animation controller, with a liveness watchdog.
 * EVERY event (incl. heartbeat) re-arms the watchdog. On timeout -> markStalled
 * (freeze + dimmed waiting); the next event resumes. STALL (silence) is distinct
 * from ERROR (an explicit error event -> kernel_panic). */
export function bindEventSource(
  source: AgentSource,
  ui: UiSink,
  anim: AnimSink,
  opts: BindOptions = {},
): () => void {
  const heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? 5000;
  const hb = opts.hb;
  let stalled = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const arm = (): void => {
    if (watchdog) clearTimeout(watchdog);
    if (stalled) {
      stalled = false;
      anim.resume();
    }
    watchdog = setTimeout(() => {
      stalled = true;
      anim.markStalled();
      hb?.markStalled();
    }, heartbeatTimeoutMs);
  };

  source.on((e) => {
    arm(); // EVERY event = liveness
    switch (e.type) {
      case "heartbeat":
        hb?.beat();
        break;
      case "stage":
        anim.setStage(e.stage);
        break;
      case "tool":
        ui.log(`  : ${e.name}${e.args ? " " + e.args : ""}`);
        break;
      case "commit":
        ui.log(`  [▪]→[▪▪] checkpoint ${e.sha}`);
        break;
      case "token":
        anim.setProgress(e.used, e.cap);
        break;
      case "log":
        ui.log(e.line);
        break;
      case "error":
        anim.setStage("error");
        if (e.message) ui.log(`! ${e.message}`);
        break;
      case "done":
        anim.stop();
        ui.end?.();
        if (watchdog) clearTimeout(watchdog);
        break;
    }
  });
  arm();
  return () => {
    if (watchdog) clearTimeout(watchdog);
    source.close();
  };
}
