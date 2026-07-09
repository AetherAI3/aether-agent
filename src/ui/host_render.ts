// Host renderer — turns BrainEvents into the neo-lite personality frames. The
// brain emits state; THIS is the only thing that draws, so local and cloud runs
// look identical. All frames are cheap strings off the hot path; `quiet` or a
// non-TTY collapses to plain lines (the personality is for humans at a terminal,
// never for machines parsing logs). See specs/neo_lite_terminal_personality.md.

import type { Writable } from "node:stream";
import { theme } from "./theme.js";
import { renderStatusBar } from "./statusbar.js";
import type { BrainEvent } from "../core/brain_protocol.js";

const STAGE_FACE: Record<string, string> = {
  recon: "( ⚆ _ ⚆ )",
  parse: "＿φ(°-°=)",
  brainstorm: "[•_•]→[•‿•]",
  "write-plans": "[⌐■_■]",
  execute: "(ง'̀-'́)ง",
  "self-review": "(¬_¬\")→[•‿•]",
  reveal: "ᕙ(`▽`)ᕗ",
};

export interface HostRenderOptions {
  poolGb: number;
  quiet?: boolean;
  json?: boolean;
  out?: Writable;
  err?: Writable;
}

export class HostRenderer {
  private readonly out: Writable;
  private readonly err: Writable;
  private headerShown = false;
  private barLive = false;

  constructor(private readonly opts: HostRenderOptions) {
    this.out = opts.out ?? process.stdout;
    this.err = opts.err ?? process.stderr;
  }

  private header(): void {
    if (!this.headerShown) {
      this.out.write("\n" + theme.bold("Aether AI") + theme.dim(" · neo-lite") + "\n");
      this.headerShown = true;
    }
  }

  /** Clear a live status-bar line before printing a permanent line over it. */
  private breakBar(): void {
    if (this.barLive) {
      this.err.write("\n");
      this.barLive = false;
    }
  }

  /**
   * Write pre-styled transcript lines (e.g. a rendered diff) as permanent
   * output. No-op in --json mode — the diff is presentation, never machine data,
   * so log/JSON consumers see only the raw tool_call. Clears any live status bar
   * first so the diff doesn't smear over it.
   */
  writeLines(lines: string[]): void {
    if (this.opts.json || lines.length === 0) return;
    this.header();
    this.breakBar();
    for (const line of lines) this.out.write(line + "\n");
  }

  event(ev: BrainEvent): void {
    if (this.opts.json) {
      this.out.write(JSON.stringify(ev) + "\n");
      return;
    }
    switch (ev.type) {
      case "stage": {
        this.header();
        this.breakBar();
        const face = ev.face || STAGE_FACE[ev.name] || "";
        this.out.write(theme.cyan("* ") + ev.name + "  " + theme.dim(face) + "\n");
        break;
      }
      case "skill": {
        // Procedure pinned — a one-line flourish (the local-hardening move).
        this.breakBar();
        const why = ev.reason ? theme.dim(` (${ev.reason})`) : "";
        this.out.write(theme.iceBlue("  ⌁ skill ") + ev.name + why + "\n");
        break;
      }
      case "monologue": {
        this.breakBar();
        const indent = "  " + "  ".repeat(Math.max(0, ev.depth));
        const branch = ev.depth > 0 ? "└─ " : "";
        this.out.write(theme.dim(indent + branch + ev.text) + "\n");
        break;
      }
      case "tool_call": {
        // The host executes this; show what it's running.
        this.breakBar();
        this.out.write(theme.dim(`  : ${ev.name} ${argHint(ev.args)}`) + "\n");
        break;
      }
      case "status": {
        const line = renderStatusBar(ev.poolUsed, this.opts.poolGb, ev.phase, 30, ev.poolCap);
        if (!this.opts.quiet) {
          this.err.write("\r" + line);
          this.barLive = true;
        }
        break;
      }
      case "telemetry": {
        if (!this.opts.quiet && ev.tps > 0) {
          this.err.write(theme.dim(`\r  └─ speed: ${ev.tps.toFixed(1)}k t/s · vram ${ev.vram}%   `));
          this.barLive = true;
        }
        break;
      }
      case "checkpoint": {
        this.breakBar();
        this.out.write(theme.cyan("  [▪]→[▪▪] ") + theme.dim(`checkpoint ${ev.gitSha}`) + "\n");
        break;
      }
      case "done": {
        this.breakBar();
        const flag = ev.ok ? theme.cyan("[ OKAY ]") : "[ FAIL ]";
        const mark = ev.ok ? "ᕙ(`▽`)ᕗ" : "o(TヘTo)";
        this.out.write("\n" + `${mark} ${ev.result || (ev.ok ? "done" : "stopped")} ` + flag + "\n");
        break;
      }
      case "error": {
        this.breakBar();
        this.err.write("\n" + theme.bold("✗ ") + ev.msg + "\n");
        break;
      }
    }
  }
}

/** A short, single-line hint of a tool call's primary arg. */
function argHint(args: Record<string, unknown>): string {
  const k = args["path"] ?? args["command"] ?? args["query"] ?? args["message"] ?? "";
  const s = String(k);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}
