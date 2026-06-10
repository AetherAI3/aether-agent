// src/ui/thinking.ts — the pre-first-byte liveness pulse. Between submitting a
// turn and the first streamed frame the terminal used to sit silent; this
// writes one soft animated line ("✦ thinking…") and clears it the moment real
// output arrives. \r-pinned single line, TTY only — callers gate on isTTY.

import { theme } from "./theme.js";

const GLYPHS = ["✦", "✧", "✶", "✧"];
const CLR = "\r\x1b[2K";

export class ThinkingPulse {
  private timer: ReturnType<typeof setInterval> | null = null;
  private idx = 0;
  private shown = false;

  constructor(
    private readonly write: (s: string) => void,
    private readonly intervalMs = 240,
  ) {}

  start(): void {
    if (this.timer) return;
    this.paint();
    this.timer = setInterval(() => this.paint(), this.intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  /** Clear the pulse line (idempotent). Call before the first real write. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.shown) {
      this.write(CLR);
      this.shown = false;
    }
  }

  private paint(): void {
    const g = GLYPHS[this.idx % GLYPHS.length]!;
    this.idx++;
    this.write(CLR + theme.cyan(g) + " " + theme.dim("thinking…"));
    this.shown = true;
  }
}
