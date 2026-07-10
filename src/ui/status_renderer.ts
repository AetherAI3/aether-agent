// status_renderer.ts — single stdout authority for the one-shot `aether code`.
// Scrollback above (meaningful events) + ONE pinned, animated status line below.
// log() clears the pinned line, writes the event, repaints the status. No
// alt-screen (that's TuiLayout, for the persistent REPL) — just a `\r`-pinned
// line, which is the right shape for a run-to-completion command.
//
// PRESENTATION ONLY + TTY-GATED. Non-TTY (pipes, triage_log.py, CI) -> plain
// lines, never `\r`/ANSI. Honors NO_COLOR and AETHER_NO_ANIM=1. This isolation is
// what keeps the §8 emission logs clean.

import { theme, stripAnsi } from "./theme.js";
import { humanTokens } from "./statusbar.js";

const ESC = "\x1b[";
const CLR_LINE = "\r" + ESC + "2K"; // carriage-return + clear-to-EOL
const HIDE = ESC + "?25l";
const SHOW = ESC + "?25h";

export interface StatusRendererOptions {
  quiet?: boolean;
  /** "local" hides the UVT figure (local has no UVT); "api" shows used/cap. */
  mode?: "local" | "api";
}

export class StatusRenderer {
  private readonly tty: boolean;
  private readonly mode: "local" | "api";
  private hb = "·";
  private stage = "";
  private art = "";
  private used = 0;
  private cap = 0;
  private tasks = ""; // pre-styled multi-task counter (e.g. "3/7"); "" hides it
  private startedAt = 0; // wall-clock start of the run (thinking timer)
  private beats = 0; // heartbeat pulses so far (the live "tracking each beat")
  private cleanupBound = false;

  constructor(opts: StatusRendererOptions = {}) {
    this.tty =
      Boolean(process.stdout.isTTY) &&
      !opts.quiet &&
      process.env["AETHER_NO_ANIM"] !== "1";
    this.mode = opts.mode ?? "local";
  }

  start(): void {
    this.startedAt = Date.now(); // begin the thinking timer (even off-TTY: harmless)
    if (!this.tty) return;
    process.stdout.write(HIDE);
    this.installCleanup();
    this.repaint();
  }

  /** A meaningful scrollback line (tool call, checkpoint, monologue, result). */
  log(line: string): void {
    if (!this.tty) {
      process.stdout.write(line + "\n");
      return;
    }
    process.stdout.write(CLR_LINE + line + "\n");
    this.repaint();
  }

  setHeartbeat(g: string): void {
    this.hb = g;
    this.repaint();
  }
  /** Update the live heartbeat count (drives the thinking timer's ♥ counter). */
  setBeats(n: number): void {
    this.beats = n;
    this.repaint();
  }
  setStage(stage: string, art: string): void {
    this.stage = stage;
    this.art = art;
    this.repaint();
  }
  setProgress(used: number, cap: number): void {
    this.used = used;
    this.cap = cap;
    this.repaint();
  }
  /** A compact, pre-styled multi-task counter pinned alongside the stage. */
  setTasks(summary: string): void {
    this.tasks = summary;
    this.repaint();
  }

  /** Tear down: clear the pinned line, restore the cursor. */
  end(): void {
    if (!this.tty) return;
    process.stdout.write(CLR_LINE + SHOW);
  }

  private repaint(): void {
    if (!this.tty) return;
    process.stdout.write(CLR_LINE + this.compose());
  }

  private compose(): string {
    const hb = theme.cyan(this.hb);
    const stage = this.stage ? theme.bold("* " + this.stage) : "";
    const art = theme.iceBlue(this.art);
    const tasksSeg = this.tasks ? "  " + this.tasks : ""; // pre-styled counter
    const timerSeg = this.startedAt ? "  " + theme.dim(this.timer()) : "";
    const fill =
      this.mode === "api" && this.cap > 0
        ? `  ${humanTokens(this.used)}/${humanTokens(this.cap)} ${this.bar()}`
        : this.cap > 0
          ? `  ${this.bar()}`
          : "";
    // A pinned \r-line that wraps leaves one stale row PER REPAINT (10-20/s
    // with the heartbeat) — clamp to the terminal by shedding the least
    // important segments first, hard-clipping the stage as the last resort.
    const cols = (process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80) - 1;
    const candidates = [
      `${hb}  ${stage} ${art}${tasksSeg}${timerSeg}${theme.dim(fill)}`,
      `${hb}  ${stage} ${art}${tasksSeg}${timerSeg}`,
      `${hb}  ${stage} ${art}${tasksSeg}`,
      `${hb}  ${stage} ${art}`,
    ];
    for (const c of candidates) {
      if (stripAnsi(c).length <= cols) return c;
    }
    const plainStage = this.stage ? "* " + this.stage : "";
    return `${hb}  ${theme.bold(plainStage.slice(0, Math.max(0, cols - 3)))}`;
  }

  /** The thinking timer: elapsed wall-clock + the running heartbeat count. Loops
   * (repaints) on every beat, so while the agent thinks it visibly ticks. */
  private timer(): string {
    const secs = Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
    const t = secs >= 60 ? `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, "0")}s` : `${secs}s`;
    return `⏱ ${t} ♥${this.beats}`;
  }

  private bar(width = 12): string {
    const frac = this.cap > 0 ? Math.min(1, this.used / this.cap) : 0;
    const f = Math.round(frac * width);
    return "▓".repeat(f) + "░".repeat(Math.max(0, width - f));
  }

  private installCleanup(): void {
    if (this.cleanupBound) return;
    this.cleanupBound = true;
    const restore = (): void => {
      try {
        process.stdout.write(SHOW);
      } catch {
        /* terminal already gone */
      }
    };
    process.on("exit", restore);
    process.on("SIGINT", () => {
      restore();
      process.stdout.write("\n");
      process.exit(130);
    });
  }
}
