// animations.ts — frame data + the variable-timing controller for the terminal's
// single pinned status line. PRESENTATION ONLY: consumes agent state, never emits
// or mutates a tool call. The controller pushes composed frames to a sink (the
// TuiLayout / StatusRenderer); it never writes stdout itself.
//
// Five sequences keyed by stage (deep_strike / radar / buffer / sentry /
// kernel_panic). Per-frame timing — a variable setTimeout chain, NOT setInterval,
// so frames can breathe at different rates. One-shot stages render a static frame.

export interface Frame {
  art: string;
  ms: number;
}

export type Sequence = {
  /** loop = cycle frames; once = render frame 0 then hold (self-review / reveal). */
  mode: "loop" | "once";
  frames: Frame[];
};

// Single-line art — the status line is one row. Width-safe (no box-drawing that
// would overflow a narrow terminal); the layout truncates defensively anyway.
export const SEQUENCES: Record<string, Sequence> = {
  // reasoning / execute / compiling / grounding — a probing strike pattern.
  deep_strike: {
    mode: "loop",
    frames: [
      { art: "▹    ", ms: 90 },
      { art: "▸▹   ", ms: 90 },
      { art: " ▸▹  ", ms: 90 },
      { art: "  ▸▹ ", ms: 90 },
      { art: "   ▸▹", ms: 90 },
      { art: "    ▸", ms: 120 },
      { art: "    ◂", ms: 120 },
      { art: "   ◂◃", ms: 90 },
      { art: "  ◂◃ ", ms: 90 },
      { art: " ◂◃  ", ms: 90 },
      { art: "◂◃   ", ms: 90 },
      { art: "◃    ", ms: 120 },
    ],
  },
  // recon / scanning — a sweeping radar.
  radar: {
    mode: "loop",
    frames: [
      { art: "( ◜ )", ms: 110 },
      { art: "( ◝ )", ms: 110 },
      { art: "( ◞ )", ms: 110 },
      { art: "( ◟ )", ms: 110 },
    ],
  },
  // anchoring / logging / checkpoint — filling a buffer.
  buffer: {
    mode: "loop",
    frames: [
      { art: "▱▱▱▱", ms: 130 },
      { art: "▰▱▱▱", ms: 130 },
      { art: "▰▰▱▱", ms: 130 },
      { art: "▰▰▰▱", ms: 130 },
      { art: "▰▰▰▰", ms: 200 },
    ],
  },
  // idle — a calm sentry pulse.
  sentry: {
    mode: "loop",
    frames: [
      { art: "·   ", ms: 260 },
      { art: "··  ", ms: 260 },
      { art: "··· ", ms: 260 },
      { art: "····", ms: 320 },
      { art: "··· ", ms: 260 },
      { art: "··  ", ms: 260 },
    ],
  },
  // error — a kernel-panic stutter (the only sequence the error path swaps to).
  kernel_panic: {
    mode: "loop",
    frames: [
      { art: "▚▞▚▞", ms: 70 },
      { art: "▞▚▞▚", ms: 70 },
      { art: "✷ ✷ ", ms: 110 },
      { art: " ✷ ✷", ms: 110 },
    ],
  },
  // one-shot stages — render once, hold.
  self_review: { mode: "once", frames: [{ art: "(¬_¬\")→[•‿•]", ms: 0 }] },
  reveal: { mode: "once", frames: [{ art: "ᕙ(`▽`)ᕗ", ms: 0 }] },
};

// Stage -> sequence. Unknown stages fall back to deep_strike (the work pattern).
export const STAGE_MAP: Record<string, keyof typeof SEQUENCES> = {
  recon: "radar",
  scanning: "radar",
  reasoning: "deep_strike",
  execute: "deep_strike",
  compiling: "deep_strike",
  grounding: "deep_strike",
  anchoring: "buffer",
  logging: "buffer",
  checkpoint: "buffer",
  paging: "buffer",
  idle: "sentry",
  error: "kernel_panic",
  "self-review": "self_review",
  reveal: "reveal",
};

export function sequenceFor(stage: string): Sequence {
  const key = STAGE_MAP[stage] ?? "deep_strike";
  return SEQUENCES[key] ?? SEQUENCES["deep_strike"]!;
}

export interface AnimationSink {
  /** Push a composed frame (current stage + its art) to the screen authority. */
  onFrame(stage: string, art: string): void;
  /** Push a progress update (token/pool fill) to the screen authority. */
  onProgress?(used: number, cap: number): void;
}

/**
 * Drives the active sequence with a variable per-frame setTimeout chain. A real
 * stage change resets to frame 0 and swaps the sequence; one-shot stages render
 * static. Stall freezes the last frame with a dimmed suffix; resume restarts.
 */
export class AnimationController {
  private stage = "idle";
  private seq: Sequence = SEQUENCES["sentry"]!;
  private frameIdx = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stalled = false;
  private lastArt = "";

  constructor(private readonly sink: AnimationSink) {}

  /** Swap the sequence on a real stage change (reset to frame 0). */
  setStage(stage: string): void {
    if (stage === this.stage && this.timer) return; // already running this stage
    this.stage = stage;
    this.seq = sequenceFor(stage);
    this.frameIdx = 0;
    this.stalled = false;
    this.clearTimer();
    if (this.seq.mode === "once") {
      // static one-shot — render and hold, no loop.
      this.render(this.seq.frames[0]?.art ?? "");
      return;
    }
    this.tick();
  }

  setProgress(used: number, cap: number): void {
    if (!this.stalled) this.sink.onProgress?.(used, cap);
  }

  /** Watchdog stall: freeze the current frame with a dimmed "waiting" suffix. */
  markStalled(): void {
    this.stalled = true;
    this.clearTimer();
    this.sink.onFrame(this.stage, this.lastArt + " · waiting…");
  }

  /** Liveness returned: restart the tick from the current frame. */
  resume(): void {
    if (!this.stalled) return;
    this.stalled = false;
    if (this.seq.mode === "loop") this.tick();
    else this.render(this.lastArt);
  }

  stop(): void {
    this.clearTimer();
  }

  private tick(): void {
    this.clearTimer();
    if (this.stalled) return;
    const frame = this.seq.frames[this.frameIdx] ?? this.seq.frames[0];
    if (!frame) return;
    this.render(frame.art);
    this.frameIdx = (this.frameIdx + 1) % this.seq.frames.length;
    this.timer = setTimeout(() => this.tick(), Math.max(16, frame.ms));
  }

  private render(art: string): void {
    this.lastArt = art;
    this.sink.onFrame(this.stage, art);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
