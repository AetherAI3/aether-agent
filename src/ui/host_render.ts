// Host renderer — turns BrainEvents into the neo-lite personality frames. The
// brain emits state; THIS is the only thing that draws, so local and cloud runs
// look identical. All frames are cheap strings off the hot path; `quiet` or a
// non-TTY collapses to plain lines (the personality is for humans at a terminal,
// never for machines parsing logs). See specs/neo_lite_terminal_personality.md.

import type { Writable } from "node:stream";
import { theme, errTheme, clipCodePoints } from "./theme.js";
import { renderStatusBar } from "./statusbar.js";
import { sanitizeTerm } from "./text.js";
import type { BrainEvent, RoutingDriftFrame } from "../core/brain_protocol.js";

/**
 * sanitizeTerm() deliberately keeps literal \n/\t (core/render.ts's markdown
 * feed needs multi-line output). HostRenderer's whole design is one physical
 * terminal line per event, so an embedded newline in a BrainEvent field would
 * break monologue depth/branch indentation and could impersonate an unrelated
 * frame (e.g. a fake "[ OKAY ]" line) on the next line. Collapse it here.
 */
function oneLine(s: string): string {
  return sanitizeTerm(s).replace(/[\n\t]/g, " ");
}

const STAGE_FACE: Record<string, string> = {
  recon: "( ⚆ _ ⚆ )",
  parse: "＿φ(°-°=)",
  brainstorm: "[•_•]→[•‿•]",
  "write-plans": "[⌐■_■]",
  execute: "(ง'̀-'́)ง",
  "self-review": "(¬_¬\")→[•‿•]",
  reveal: "ᕙ(`▽`)ᕗ",
};

/**
 * The transport-drift banner, as plain lines.
 *
 * Exported because BOTH presentation paths must show it: this renderer (pipes,
 * --quiet, CI) and the animated status renderer in commands/code.ts, which
 * never routes events through HostRenderer at all. One formatter, so the two
 * surfaces cannot disagree about what the user was told.
 *
 * The literal token ROUTING_DRIFT carries the meaning; colour only decorates
 * it. A user on a dumb terminal, a piped log, or a screen reader gets exactly
 * the same words — a red-only cue would be no cue at all for them.
 */
export function routingDriftLines(ev: RoutingDriftFrame): string[] {
  const head = `ROUTING_DRIFT  ${ev.requested} -> ${ev.resolved}  (HTTP ${ev.status})`;
  return [
    "",
    errTheme.red("! ") + head,
    `  reason: ${oneLine(ev.reason)}`,
    `  ${oneLine(ev.consequence)}`,
    ...(ev.fatal ? [`  ${oneLine(ev.remediation)}`] : []),
  ];
}

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
        const name = oneLine(ev.name);
        const face = oneLine(ev.face || STAGE_FACE[name] || "");
        this.out.write(theme.cyan("* ") + name + "  " + theme.dim(face) + "\n");
        break;
      }
      case "skill": {
        // Procedure pinned — a one-line flourish (the local-hardening move).
        this.breakBar();
        const why = ev.reason ? theme.dim(` (${oneLine(ev.reason)})`) : "";
        this.out.write(theme.iceBlue("  ⌁ skill ") + oneLine(ev.name) + why + "\n");
        break;
      }
      case "monologue": {
        this.breakBar();
        const indent = "  " + "  ".repeat(Math.max(0, ev.depth));
        const branch = ev.depth > 0 ? "└─ " : "";
        this.out.write(theme.dim(indent + branch + oneLine(ev.text)) + "\n");
        break;
      }
      case "tool_call": {
        // The host executes this; show what it's running.
        this.breakBar();
        this.out.write(theme.dim(`  : ${oneLine(ev.name)} ${argHint(ev.args)}`) + "\n");
        break;
      }
      case "status": {
        if (this.opts.quiet) break;
        const line = renderStatusBar(ev.poolUsed, this.opts.poolGb, ev.phase, 30, ev.poolCap);
        // \r-rewrite is a TTY affordance; piped stderr gets plain lines (the
        // file's own header promises that) and no unclamped wrapping.
        if (process.stderr.isTTY) {
          const cols = (process.stderr.columns || 80) - 1;
          this.err.write("\r" + (line.length > cols ? line.slice(0, cols) : line));
          this.barLive = true;
        } else {
          this.err.write(line + "\n");
        }
        break;
      }
      case "telemetry": {
        if (this.opts.quiet || ev.tps <= 0) break;
        const body = `  └─ speed: ${ev.tps.toFixed(1)}k t/s · vram ${ev.vram}%   `;
        if (process.stderr.isTTY) {
          this.err.write(errTheme.dim("\r" + body));
          this.barLive = true;
        } else {
          this.err.write(body.trimEnd() + "\n");
        }
        break;
      }
      case "checkpoint": {
        this.breakBar();
        this.out.write(theme.cyan("  [▪]→[▪▪] ") + theme.dim(`checkpoint ${oneLine(ev.gitSha)}`) + "\n");
        break;
      }
      case "done": {
        this.breakBar();
        const flag = ev.ok ? theme.cyan("[ OKAY ]") : theme.red("[ FAIL ]");
        const mark = ev.ok ? "ᕙ(`▽`)ᕗ" : "o(TヘTo)";
        this.out.write("\n" + `${mark} ${oneLine(ev.result || (ev.ok ? "done" : "stopped"))} ` + flag + "\n");
        break;
      }
      case "error": {
        this.breakBar();
        this.err.write("\n" + errTheme.red("✗ ") + oneLine(ev.msg) + "\n");
        break;
      }
      case "routing_drift": {
        // stderr, like `error`: the drift is a warning about the run, not part
        // of the model's answer, so a piped stdout stays exactly as clean as
        // before. (--json returned above — machine consumers get the fields.)
        this.breakBar();
        for (const line of routingDriftLines(ev)) this.err.write(line + "\n");
        break;
      }
    }
  }
}

/** A short, single-line hint of a tool call's primary arg. */
function argHint(args: Record<string, unknown>): string {
  const k = args["path"] ?? args["command"] ?? args["query"] ?? args["message"] ?? "";
  return clipCodePoints(oneLine(String(k)), 60);
}
