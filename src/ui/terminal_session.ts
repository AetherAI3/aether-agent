// terminal_session.ts — the embed entry point. A host (desktop/web) supplies an
// AgentSource (cloud SSE) and a RenderSink (xterm-backed); this wires them through
// the SAME bindEventSource → StatusRenderer chain the CLI uses, so the embedded
// terminal renders identically to `aether agent`. Returns a disposer.

import { StatusRenderer } from "./status_renderer.js";
import type { RenderSink } from "./sink.js";
import { bindEventSource, type AgentSource, type AnimSink } from "../core/agent_events.js";

export interface TerminalSessionOptions {
  source: AgentSource;
  sink: RenderSink;
  /** "api" shows UVT used/cap; "local" hides it. Embeds are cloud-metered → "api". */
  mode?: "local" | "api";
  /** Injected clock (ms) — overridden in tests. */
  now?: () => number;
}

export interface TerminalSession {
  dispose(): void;
}

export function createTerminalSession(opts: TerminalSessionOptions): TerminalSession {
  let disposed = false;

  const renderer = new StatusRenderer({
    sink: opts.sink,
    mode: opts.mode ?? "api",
    now: opts.now,
    ownsProcess: false, // embeds never install global process handlers
  });
  renderer.start();

  // Guard-wrapped AnimSink: all callbacks are no-ops after dispose() so that any
  // watchdog timeout that fires after unbind does not write into the sink.
  const anim: AnimSink = {
    setStage: (stage: string): void => { if (!disposed) renderer.setVerb(stage, ""); },
    setProgress: (used: number, cap: number): void => { if (!disposed) renderer.setProgress(used, cap); },
    markStalled: (): void => { if (!disposed) renderer.setHeartbeat("○"); },
    resume: (): void => { if (!disposed) renderer.setHeartbeat("◉"); },
    stop: (): void => {},
  };

  // Guard-wrapped UiSink forwarded to renderer: prevents late events from rendering.
  const guardedUi = {
    log: (line: string): void => { if (!disposed) renderer.log(line); },
    end: (): void => { if (!disposed) renderer.end?.(); },
  };

  const unbind = bindEventSource(opts.source, guardedUi, anim, {});

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unbind();
      renderer.end();
    },
  };
}
