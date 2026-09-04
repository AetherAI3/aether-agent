// agent_events.ts — transport-agnostic agent event source for the terminal UI +
// the adapter from the bridge's BrainEvent onto the animation layer's AgentEvent.
// Both local AND cloud `aether code` runs feed BrainEvents into the same
// LocalAgentSource (a synthetic heartbeat per loop tick, regardless of which
// brain produced the events) — the AnimationController consumes the SAME
// AgentEvent stream either way. NO protocol change (presentation-only adapter).

import type { BrainEvent } from "./brain_protocol.js";
import { clipCodePoints } from "../ui/theme.js";
import { sanitizeTerm } from "../ui/text.js";

// The UI's event vocabulary (smaller than BrainEvent — presentation slice).
// `seq` is additive and optional for legacy/local sources. Once an embed opts
// into resumable delivery, TerminalSession requires it and enforces a strict
// monotonic high-water mark before events reach this renderer boundary.
type AgentEventPayload =
  | { type: "stage"; stage: string }
  | { type: "tool"; name: string; args?: string }
  | { type: "commit"; sha: string }
  | { type: "token"; used: number; cap: number }
  | { type: "heartbeat" }
  | { type: "done" }
  /** Transport EOF/close before done/error. This is terminal incomplete, never success. */
  | { type: "closed"; reason?: string }
  | { type: "error"; message?: string }
  // log = a plain transcript line (monologue / skill / fray markers); not an anim event.
  | { type: "log"; line: string };

export type AgentEvent = AgentEventPayload & {
  readonly seq?: number;
};

/** Adapt one bridge BrainEvent to the UI AgentEvent (null = ignore). */
export function mapBrainEvent(ev: BrainEvent): AgentEvent | null {
  switch (ev.type) {
    case "stage":
      return { type: "stage", stage: safeInline(ev.name) };
    case "tool_call":
      return { type: "tool", name: safeInline(ev.name), args: argHint(ev.args) };
    case "checkpoint":
      return { type: "commit", sha: safeInline(ev.gitSha) };
    case "status":
      return { type: "token", used: ev.poolUsed, cap: ev.poolCap };
    case "skill":
      return { type: "log", line: `  ⌁ skill ${safeInline(ev.name)}${ev.reason ? ` (${safeInline(ev.reason)})` : ""}` };
    case "monologue":
      return { type: "log", line: `${"  ".repeat(ev.depth + 1)}${ev.depth > 0 ? "└─ " : ""}${safeInline(ev.text)}` };
    case "done":
      return { type: "done" };
    case "error":
      return { type: "error", message: safeInline(ev.msg) };
    default:
      return null; // telemetry — not part of the UI slice
  }
}

function argHint(args: Record<string, unknown>): string {
  const k = args["path"] ?? args["command"] ?? args["query"] ?? args["message"] ?? "";
  return clipCodePoints(safeInline(String(k)), 60);
}

function safeInline(value: string): string {
  return sanitizeTerm(value).replace(/[\r\n\t]+/g, " ");
}

export interface AgentSource {
  /** Optional disposer lets long-lived/embed sources detach one subscriber
   * without relying on close() to tear down the whole transport. A transport
   * that reaches EOF must deliver `{type:"closed"}` before detaching itself. */
  on(handler: (e: AgentEvent) => void): void | (() => void);
  close(): void;
}

// ---- Fed BrainEvents from the host loop (either brain); synthetic heartbeat per tick ----
// Stages/tool/commit/token fire REGARDLESS of any cloud connection; the heartbeat
// keeps the watchdog behaviour identical to cloud.
export class LocalAgentSource implements AgentSource {
  private readonly handlers = new Set<(e: AgentEvent) => void>();
  private readonly hb: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(heartbeatMs = 1000) {
    this.hb = setInterval(() => this.emit({ type: "heartbeat" }), heartbeatMs);
    if (typeof this.hb.unref === "function") this.hb.unref(); // never keep the process alive
  }

  /** Feed one BrainEvent from the host loop; it is adapted + dispatched. */
  feedBrain(ev: BrainEvent): void {
    const a = mapBrainEvent(ev);
    if (a) this.emit(a);
  }

  on(h: (e: AgentEvent) => void): () => void {
    if (this.closed) return () => {};
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.hb);
    this.handlers.clear();
  }
  private emit(e: AgentEvent): void {
    if (this.closed) return;
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
  /** Hard bound for a connected source that makes no real progress. */
  meaningfulProgressTimeoutMs?: number;
  /** Remaining portion of the first meaningful-progress window. Recoverable
   * remounts use this to preserve the original deadline rather than granting
   * a fresh full timeout every time the UI is recreated. Later real progress
   * still earns a complete new window. */
  initialMeaningfulProgressRemainingMs?: number;
  hb?: HeartbeatSink;
  /** Close the whole source when this binding ends. Embeds commonly share a
   * transport, so ownership is explicit and defaults to detach-only. */
  ownsSource?: boolean;
  /** Observe actual progress without creating a second source subscription.
   * Duplicate stage/token frames and empty logs are deliberately excluded. */
  onMeaningfulEvent?: (event: AgentEvent) => void;
  /** Exactly-once notification from the binding's single terminal path. */
  onTerminal?: (terminal: EventSourceTerminal) => void;
  /** Render the terminal line in this binding. Defaults true for standalone
   * consumers. Lifecycle-owning embeds set false and render their TurnOutcome
   * once from onTerminal instead. */
  renderTerminalOutput?: boolean;
}

export interface EventSourceTerminal {
  state: "succeeded" | "failed" | "timed_out" | "incomplete";
  message: string;
}

export const DEFAULT_MEANINGFUL_PROGRESS_TIMEOUT_MS = 120_000;

/** Bind a source to the UI + animation controller, with a meaningful-progress
 * watchdog. Cosmetic heartbeats prove the connection is alive but DO NOT
 * reset the progress clock; otherwise a server can pulse forever while the UI
 * claims useful work is advancing. A real event resumes the stalled view.
 * STALL remains distinct from an explicit terminal ERROR. */
export function bindEventSource(
  source: AgentSource,
  ui: UiSink,
  anim: AnimSink,
  opts: BindOptions = {},
): () => void {
  const heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? 5000;
  const meaningfulProgressTimeoutMs = opts.meaningfulProgressTimeoutMs ?? DEFAULT_MEANINGFUL_PROGRESS_TIMEOUT_MS;
  const hb = opts.hb;
  const renderTerminalOutput = opts.renderTerminalOutput ?? true;
  let stalled = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let terminalWatchdog: ReturnType<typeof setTimeout> | null = null;
  let ended = false;
  let sourceClosed = false;
  let subscriberDetached = false;
  let detachSubscriberImpl: void | (() => void);
  let highestTokenUsed = 0;
  let sawMeaningfulProgress = false;
  // A hostile/corrupt source must not grow this set forever. Once the bounded
  // vocabulary is exhausted, novel presentation frames stop extending the
  // turn; a monotonically increasing token counter can still prove progress.
  const seenProgressFingerprints = new Set<string>();
  const maxProgressFingerprints = 256;

  const closeSource = (): void => {
    if (!opts.ownsSource) return;
    if (sourceClosed) return;
    sourceClosed = true;
    source.close();
  };

  const detachSubscriber = (): void => {
    if (subscriberDetached) return;
    subscriberDetached = true;
    if (typeof detachSubscriberImpl === "function") detachSubscriberImpl();
  };

  const clearWatchdogs = (): void => {
    if (watchdog) clearTimeout(watchdog);
    if (terminalWatchdog) clearTimeout(terminalWatchdog);
    watchdog = null;
    terminalWatchdog = null;
  };

  const armConnection = (): void => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      stalled = true;
      anim.markStalled();
      hb?.markStalled();
    }, heartbeatTimeoutMs);
    watchdog.unref?.();
  };

  const armProgress = (delayMs = meaningfulProgressTimeoutMs): void => {
    if (terminalWatchdog) clearTimeout(terminalWatchdog);
    if (meaningfulProgressTimeoutMs > 0) {
      terminalWatchdog = setTimeout(() => {
        if (ended) return;
        ended = true;
        stalled = true;
        anim.setStage("error");
        anim.markStalled();
        hb?.markStalled();
        const message =
          `turn stalled after ${Math.round(meaningfulProgressTimeoutMs / 1000)}s with no meaningful progress; ` +
          "the source was cancelled and `aether doctor` can inspect connectivity";
        if (renderTerminalOutput) ui.log(`! ${message}`);
        notifyTerminal({ state: "timed_out", message });
        anim.stop();
        ui.end?.();
        clearWatchdogs();
        detachSubscriber();
        closeSource();
      }, Math.max(0, Math.min(meaningfulProgressTimeoutMs, delayMs)));
      terminalWatchdog.unref?.();
    }
  };

  const noteMeaningfulProgress = (event: AgentEvent): void => {
    sawMeaningfulProgress = true;
    if (stalled) {
      stalled = false;
      anim.resume();
    }
    armProgress();
    try {
      opts.onMeaningfulEvent?.(event);
    } catch {
      // An observer is not allowed to strand the renderer/source cleanup path.
    }
  };

  const notifyTerminal = (terminal: EventSourceTerminal): void => {
    try {
      opts.onTerminal?.(terminal);
    } catch {
      // Terminal cleanup and exactly-once delivery remain authoritative even
      // when an optional host observer throws.
    }
  };

  const claimProgressFingerprint = (kind: string, value: string): boolean => {
    const normalized = clipCodePoints(safeInline(value).trim(), 256);
    if (!normalized) return false;
    const fingerprint = `${kind}:${normalized}`;
    if (seenProgressFingerprints.has(fingerprint)) return false;
    if (seenProgressFingerprints.size >= maxProgressFingerprints) return false;
    seenProgressFingerprints.add(fingerprint);
    return true;
  };

  const isMeaningfulProgress = (event: AgentEvent): boolean => {
    switch (event.type) {
      case "heartbeat":
      case "done":
      case "error":
      case "closed":
        return false;
      case "stage":
        return claimProgressFingerprint("stage", event.stage);
      case "token": {
        // Capacity changes, counter replays, and counter regressions are
        // presentation updates rather than proof that work advanced.
        if (
          !Number.isSafeInteger(event.used) ||
          !Number.isSafeInteger(event.cap) ||
          event.used <= highestTokenUsed ||
          event.cap < event.used
        ) return false;
        highestTokenUsed = event.used;
        return true;
      }
      case "log":
        return claimProgressFingerprint("log", event.line);
      case "tool":
        return claimProgressFingerprint("tool", `${event.name}\u0000${event.args ?? ""}`);
      case "commit":
        return claimProgressFingerprint("commit", event.sha);
    }
  };

  detachSubscriberImpl = source.on((e) => {
    if (ended) return;
    armConnection();
    if (isMeaningfulProgress(e)) noteMeaningfulProgress(e);
    switch (e.type) {
      case "heartbeat":
        hb?.beat();
        break;
      case "stage":
        anim.setStage(safeInline(e.stage));
        break;
      case "tool":
        ui.log(`  : ${safeInline(e.name)}${e.args ? " " + safeInline(e.args) : ""}`);
        break;
      case "commit":
        ui.log(`  [▪]→[▪▪] checkpoint ${safeInline(e.sha)}`);
        break;
      case "token":
        anim.setProgress(e.used, e.cap);
        break;
      case "log":
        ui.log(safeInline(e.line));
        break;
      case "error":
        ended = true;
        anim.setStage("error");
        {
          const message = e.message ? safeInline(e.message) : "turn failed";
          if (renderTerminalOutput) ui.log(`! ${message}`);
          notifyTerminal({ state: "failed", message });
        }
        anim.stop();
        ui.end?.();
        clearWatchdogs();
        detachSubscriber();
        closeSource();
        break;
      case "closed":
        ended = true;
        anim.setStage("error");
        {
          const message = e.reason
            ? safeInline(e.reason)
            : "connection ended before the turn delivered a terminal frame";
          if (renderTerminalOutput) ui.log(`! ${message}`);
          notifyTerminal({ state: "incomplete", message });
        }
        anim.stop();
        ui.end?.();
        clearWatchdogs();
        detachSubscriber();
        closeSource();
        break;
      case "done":
        ended = true;
        if (renderTerminalOutput) ui.log("✓ turn completed");
        notifyTerminal({ state: "succeeded", message: "turn completed" });
        anim.stop();
        ui.end?.();
        clearWatchdogs();
        detachSubscriber();
        closeSource();
        break;
    }
  });
  // A source is allowed to emit synchronously from on(). If that event
  // finalized the binding, honor the pending detach once on() returns.
  if (subscriberDetached && typeof detachSubscriberImpl === "function") {
    detachSubscriberImpl();
  }
  if (!ended) {
    armConnection();
    // Atomic resume sources may replay synchronously during subscription. A
    // meaningful replay earns a fresh window and must not then be overwritten
    // by the stale pre-remount remainder.
    if (!sawMeaningfulProgress) armProgress(opts.initialMeaningfulProgressRemainingMs);
  }
  let unbound = false;
  return () => {
    if (unbound) return;
    unbound = true;
    ended = true;
    clearWatchdogs();
    detachSubscriber();
    closeSource();
  };
}
