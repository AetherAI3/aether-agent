// status_renderer.ts — single stdout authority for the one-shot `aether agent`.
// Scrollback above (meaningful events) + ONE pinned, animated status line below.
// log() clears the pinned line, writes the event, repaints the status. No
// alt-screen (that's TuiLayout, for the persistent REPL) — just a `\r`-pinned
// line, which is the right shape for a run-to-completion command.
//
// PRESENTATION ONLY + TTY-GATED. Non-TTY (pipes, triage_log.py, CI) -> plain
// lines, never `\r`/ANSI. Honors NO_COLOR and AETHER_NO_ANIM=1. This isolation is
// what keeps the §8 emission logs clean.

import { theme } from "./theme.js";
import { humanTokens } from "./statusbar.js";
import { formatElapsed } from "./elapsed.js";

const ESC = "\x1b[";
const CLR_LINE = "\r" + ESC + "2K"; // carriage-return + clear-to-EOL
const HIDE = ESC + "?25l";
const SHOW = ESC + "?25h";

export interface StatusRendererOptions {
  quiet?: boolean;
  /** "local" hides the UVT figure; "api" shows used/cap. */
  mode?: "local" | "api";
  /** Injected clock (ms). Defaults to Date.now — overridden in tests. */
  now?: () => number;
}

export class StatusRenderer {
  private readonly tty: boolean;
  private readonly mode: "local" | "api";
  private readonly now: () => number;
  private hb = "·";
  private verb = "Working";
  private kao = "";
  private streamed = 0; // output tokens streamed this run (the ↑ figure)
  private used = 0;
  private cap = 0;
  private startedMs: number;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private cleanupBound = false;

  constructor(opts: StatusRendererOptions = {}) {
    this.tty =
      Boolean(process.stdout.isTTY) && !opts.quiet && process.env["AETHER_NO_ANIM"] !== "1";
    this.mode = opts.mode ?? "local";
    this.now = opts.now ?? (() => Date.now());
    this.startedMs = this.now();
  }

  start(): void {
    this.startedMs = this.now();
    if (!this.tty) return;
    process.stdout.write(HIDE);
    this.installCleanup();
    this.ticker = setInterval(() => this.repaint(), 1000);
    if (typeof this.ticker.unref === "function") this.ticker.unref();
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
  /** Set the activity word + kaomoji (from phaseVerb). */
  setVerb(verb: string, kao: string): void {
    this.verb = verb;
    this.kao = kao;
    this.repaint();
  }
  /** Cumulative output tokens streamed this run (telemetry.tokens). */
  setStreamed(n: number): void {
    this.streamed = n;
    this.repaint();
  }
  /** Legacy no-op: stage now drives the verb via setVerb in code.ts. */
  setStage(_stage: string, _art: string): void {}
  setProgress(used: number, cap: number): void {
    this.used = used;
    this.cap = cap;
    this.repaint();
  }

  /** Tear down: clear the pinned line, restore the cursor. */
  end(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    if (!this.tty) return;
    process.stdout.write(CLR_LINE + SHOW);
  }

  private repaint(): void {
    if (!this.tty) return;
    process.stdout.write(CLR_LINE + this.composeLine());
  }

  /** The pinned heartbeat line. Reads the injected clock — public for tests. */
  composeLine(): string {
    const hb = theme.cyan(this.hb);
    const kao = this.kao ? theme.dim(this.kao) + " " : "";
    const head = `${kao}${theme.bold(this.verb)}…`;
    const elapsed = formatElapsed(this.now() - this.startedMs);
    const up = this.streamed > 0 ? ` · ↑ ${humanTokens(this.streamed)} tokens` : "";
    const uvt =
      this.mode === "api" && this.cap > 0
        ? `  ${theme.dim(`UVT ${humanTokens(this.used)}/${humanTokens(this.cap)} ${this.bar()}`)}`
        : "";
    return `${hb}  ${head} ${theme.dim(`(${elapsed}${up})`)}${uvt}`;
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
