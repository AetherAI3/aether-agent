// heartbeat.ts — event-driven liveness pulse (TS port of heartbeat.mjs). Rebuild
// of the AetherCloud orb (#00A0E7) as an EVENT-DRIVEN glyph: each real heartbeat
// event triggers ONE beat, so the visible pulse rate = real liveness rate. Not a
// fixed loop. An overlay glyph the screen authority composes alongside the stage
// animation. Stall (watchdog) -> hollow glyph; resume on the next heartbeat.

export interface HeartbeatOptions {
  onFrame?: (glyph: string) => void;
  frameMs?: number;
}

export class HeartbeatIndicator {
  // soft single-pulse envelope (the orb's gentle wobble, not a sharp lub-dub)
  private readonly envelope = ["·", "•", "●", "◉", "●", "•", "·"];
  private readonly rest = "·"; // diastole — quiet between beats
  private readonly stallGlyph = "○"; // hollow — no heartbeats arriving
  private readonly frameMs: number;
  private idx = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stalled = false;
  private readonly onFrame: (glyph: string) => void;

  constructor(opts: HeartbeatOptions = {}) {
    this.frameMs = opts.frameMs ?? 35;
    this.onFrame = opts.onFrame ?? (() => {});
  }

  /** Trigger one beat. Called on each real heartbeat event. A beat that
   *  arrives while the envelope is still playing is absorbed — restarting
   *  mid-pulse snaps the glyph back to "·" and reads as stutter. */
  beat(): void {
    this.stalled = false;
    if (this.timer) return; // pulse in flight — liveness is already visible
    this.idx = 0;
    this.step();
  }

  /** Watchdog timeout: show hollow, stop pulsing (honest: connection is silent). */
  markStalled(): void {
    this.stalled = true;
    this.idx = -1;
    this.clear();
    this.onFrame(this.glyph());
  }

  glyph(): string {
    if (this.stalled) return this.stallGlyph;
    if (this.idx < 0) return this.rest;
    return this.envelope[Math.min(this.idx, this.envelope.length - 1)]!;
  }

  stop(): void {
    this.clear();
  }

  private step(): void {
    this.clear();
    if (this.idx < 0 || this.idx >= this.envelope.length) {
      this.idx = -1;
      this.onFrame(this.glyph());
      return;
    }
    this.onFrame(this.glyph());
    this.idx++;
    this.timer = setTimeout(() => this.step(), this.frameMs);
  }

  private clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
