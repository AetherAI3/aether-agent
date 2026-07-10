// Thinking pulse — the anti-dead-air indicator for a chat turn. Between
// submitting a prompt and the first streamed frame, NOTHING used to be
// written; this paints a small `\r`-pinned line on stderr and clears it the
// moment real output arrives. After `stallAfterMs` with no frame it turns
// honest: "still waiting · Ctrl+C cancels the turn" (truthful because the
// REPL's per-turn AbortController exists — E10).
//
// PRESENTATION ONLY + gated: disabled it writes ZERO bytes (pipes, --json,
// AETHER_NO_ANIM, non-TTY stderr), so machine consumers never see it.

import { errTheme } from "./theme.js";
import { KAOMOJI } from "./kaomoji.js";

const ESC = "\x1b[";
const CLR_LINE = "\r" + ESC + "2K";

/** One pulse frame, plain (styling happens at the write site). Pure. */
export function thinkingFrame(tick: number, stalled: boolean): string {
  const dots = "·".repeat((tick % 3) + 1).padEnd(3);
  const base = `${KAOMOJI.idle} thinking${dots}`;
  return stalled ? `${base} — still waiting · Ctrl+C cancels the turn` : base;
}

interface MinimalWriter {
  write(s: string): boolean;
}

export interface ThinkingPulseOptions {
  /** Paint cadence (default 120ms). */
  intervalMs?: number;
  /** Frameless time before the stall suffix appears (default 10s). */
  stallAfterMs?: number;
  /** Write target (default process.stderr) — injectable for tests. */
  err?: MinimalWriter;
  /** Off = zero bytes ever. Caller computes the TTY/json/NO_ANIM gate. */
  enabled: boolean;
  /** Called after every paint. In the REPL this re-syncs readline's input
   * line (same tty row), since a keystroke typed ahead during the pulse
   * window otherwise gets stomped by the next `\r`-repaint. */
  onPaint?: () => void;
}

export class ThinkingPulse {
  private readonly err: MinimalWriter;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly stallAfterMs: number;
  private readonly onPaint?: () => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private startedAt = 0;
  private painted = false;

  constructor(opts: ThinkingPulseOptions) {
    this.err = opts.err ?? process.stderr;
    this.enabled = opts.enabled;
    this.intervalMs = opts.intervalMs ?? 120;
    this.stallAfterMs = opts.stallAfterMs ?? 10_000;
    this.onPaint = opts.onPaint;
  }

  start(): void {
    if (!this.enabled || this.timer) return;
    this.startedAt = Date.now();
    this.paint();
    this.timer = setInterval(() => this.paint(), this.intervalMs);
    // Never hold the process open on our account.
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Clear the pinned line and go silent. Idempotent — safe in finally. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.painted) {
      this.err.write(CLR_LINE);
      this.painted = false;
    }
  }

  private paint(): void {
    const stalled = Date.now() - this.startedAt >= this.stallAfterMs;
    const frame = thinkingFrame(this.tick++, stalled);
    this.err.write(CLR_LINE + errTheme.dim(frame));
    this.painted = true;
    this.onPaint?.();
  }
}
