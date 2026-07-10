// heartbeat.ts — event-driven liveness pulse (TS port of heartbeat.mjs). Rebuild
// of the AetherCloud orb (#00A0E7) as an EVENT-DRIVEN glyph: each real heartbeat
// event triggers ONE beat, so the visible pulse rate = real liveness rate. Not a
// fixed loop. An overlay glyph the screen authority composes alongside the stage
// animation. Stall (watchdog) -> hollow glyph; resume on the next heartbeat.

export interface HeartbeatOptions {
  // Second arg is the running beat count — the thinking timer tracks each beat.
  onFrame?: (glyph: string, beats: number) => void;
  frameMs?: number;
}

export class HeartbeatIndicator {
  // soft single-pulse envelope (the orb's gentle wobble, not a sharp lub-dub)
  private readonly envelope = ["·", "•", "●", "◉", "●", "•", "·"];
  private readonly rest = "·"; // diastole — quiet between beats
  private readonly stallGlyph = "○"; // hollow — no heartbeats arriving
  private readonly frameMs: number;
  private idx = -1;
  private beats = 0; // running pulse count — the "track each heartbeat" counter
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stalled = false;
  private readonly onFrame: (glyph: string, beats: number) => void;

  constructor(opts: HeartbeatOptions = {}) {
    this.frameMs = opts.frameMs ?? 35;
    this.onFrame = opts.onFrame ?? ((): void => {});
  }

  /** Trigger one beat. Called on each real heartbeat event. A beat that
   *  arrives while the envelope is still playing is absorbed — restarting
   *  mid-pulse snaps the glyph back to "·" and reads as stutter. */
  beat(): void {
    this.stalled = false;
    this.beats += 1; // count every real heartbeat, even absorbed ones — the
    // thinking timer's ♥ counter should track true liveness, not paint frames.
    if (this.timer) {
      // pulse in flight — liveness is already visible; restarting mid-pulse
      // would snap the glyph back to "·" and read as stutter. Still report
      // the updated beat count so a caller tracking liveness (the thinking
      // timer's ♥ counter) sees every beat, not just the ones that happen to
      // land between animation frames.
      this.onFrame(this.glyph(), this.beats);
      return;
    }
    this.idx = 0;
    this.step();
  }

  /** How many beats have pulsed so far (the thinking timer's heartbeat count). */
  count(): number {
    return this.beats;
  }

  /** Watchdog timeout: show hollow, stop pulsing (honest: connection is silent). */
  markStalled(): void {
    this.stalled = true;
    this.idx = -1;
    this.clear();
    this.onFrame(this.glyph(), this.beats);
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
      this.onFrame(this.glyph(), this.beats);
      return;
    }
    this.onFrame(this.glyph(), this.beats);
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
