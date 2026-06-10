// Renderer — turns stream frames into terminal output.
// Takes a Writable so the web (xterm.js) bridge can reuse it with a different
// sink. With { json: true } it passes frames through verbatim (machine mode
// future web / Jane / MealPlanner reuse).
//
// Orchestrator runs render through the agentic-visibility surface (src/ui):
// a bold "Aether AI" header, kaomoji-personified action lines, and a
// project-level progress bar (tasks done / tasks started). Plain chat just
// streams `delta` text.

import type { Writable } from "node:stream";
import type { StreamFrame } from "./stream.js";
import { header, actionLine } from "../ui/agent.js";
import { sanitizeTerm } from "../ui/text.js";
import { MdStream } from "../ui/md_stream.js";

export interface RenderOptions {
  json: boolean;
  audit: boolean;
  out?: Writable;
  err?: Writable;
  /** Style streamed markdown (headers/bold/inline-code/fences). TTY chat only —
   *  defaults off so pipes, --json, and embed sinks stay byte-identical. */
  markdown?: boolean;
}

export class Renderer {
  private readonly out: Writable;
  private readonly err: Writable;
  private readonly md: MdStream;
  private agentHeader = false;
  private tasksStarted = 0;
  private tasksDone = 0;

  constructor(private readonly opts: RenderOptions) {
    this.out = opts.out ?? process.stdout;
    this.err = opts.err ?? process.stderr;
    this.md = new MdStream(Boolean(opts.markdown) && !opts.json);
  }

  /** Project completion fraction so far (done / started). */
  private projFrac(): number {
    return this.tasksStarted > 0 ? this.tasksDone / this.tasksStarted : 0;
  }

  private ensureHeader(): void {
    if (!this.agentHeader) {
      this.out.write("\n" + header() + "\n");
      this.agentHeader = true;
    }
  }

  frame(f: StreamFrame): void {
    if (this.opts.json) {
      this.out.write(JSON.stringify(f) + "\n");
      return;
    }
    switch (f.type) {
      case "open":
      case "ping":
        break; // handshake / liveness only
      case "connected":
        this.ensureHeader();
        break;
      case "reasoning":
        // thinking → stderr, keeps answer on stdout. Stream-sourced text is
        // sanitized: a hostile/buggy server must not be able to emit OSC/CSI
        // (title/clipboard rewrite, screen clear, hidden text) into the TTY.
        this.err.write(sanitizeTerm(f.text));
        break;
      case "delta": {
        const styled = this.md.feed(sanitizeTerm(f.text));
        if (styled) this.out.write(styled);
        break;
      }
      case "usage":
        // Interim ticker suppressed: a "\r⟢ …" mid-stream stomps the line the
        // answer is currently streaming onto. `done` reports the final figure.
        break;
      case "progress":
        if (f.text) this.err.write(`\n· ${sanitizeTerm(f.text)}\n`);
        break;
      case "task_start": {
        this.ensureHeader();
        this.tasksStarted += 1;
        const label = sanitizeTerm(f.label ?? `task ${f.taskId ?? ""}`);
        this.out.write("\n" + actionLine(label, "active", sanitizeTerm(f.taskId ?? ""), this.projFrac()) + "\n");
        break;
      }
      case "task_progress":
        if (f.delta) this.out.write(sanitizeTerm(f.delta));
        break;
      case "task_done":
        this.tasksDone += 1;
        this.out.write("\n" + actionLine(`${sanitizeTerm(f.taskId ?? "task")} done`, "logging", "", this.projFrac()) + "\n");
        break;
      case "task_failed":
        this.err.write("\n" + actionLine(`${sanitizeTerm(f.taskId ?? "task")} failed`, "error", sanitizeTerm(f.msg ?? ""), this.projFrac()) + "\n");
        break;
      case "task_blocked":
        this.err.write("\n" + actionLine(`${sanitizeTerm(f.taskId ?? "task")} blocked`, "idle", sanitizeTerm(f.msg ?? ""), this.projFrac()) + "\n");
        break;
      case "project_done":
        this.out.write("\n" + actionLine("project complete", "active", "", 1) + "\n");
        break;
      case "custody": {
        // Persistence happens in the chat loop; here we only confirm receipt.
        const orderId = sanitizeTerm(String(f.custody["order_id"] ?? ""));
        this.err.write(`  ⛓ signed · ${orderId.slice(0, 8)}\n`);
        break;
      }
      case "done":
        this.done(f);
        break;
      case "error":
        this.error(f);
        break;
    }
  }

  private done(f: Extract<StreamFrame, { type: "done" }>): void {
    const rest = this.md.flush();
    if (rest) this.out.write(rest);
    this.out.write("\n");
    this.err.write(`— ${f.uvt} UVT · ${f.cents.toFixed(2)}¢\n`);
  }

  private error(f: Extract<StreamFrame, { type: "error" }>): void {
    const rest = this.md.flush();
    if (rest) this.out.write(rest);
    this.err.write(`\n✗ ${sanitizeTerm(f.msg)}`);
    if (f.errorCode) this.err.write(` [${sanitizeTerm(f.errorCode)}]`);
    if (f.refId) this.err.write(` (ref ${sanitizeTerm(f.refId)})`);
    this.err.write("\n");
  }
}
