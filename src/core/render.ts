// Renderer — turns stream frames into terminal output.
// Takes a Writable so the web (xterm.js) bridge can reuse it with a different
// sink. With { json: true } it passes frames through verbatim (machine mode
// future web / Jane / MealPlanner reuse).
//
// Frame set per the UVT streaming wire contract (the Aether streaming contract). Answer
// text is `delta`; pre-answer thinking is `reasoning`; `ping`/`open` are
// liveness/handshake only. Orchestrator runs add task_* lifecycle frames.
//
// Aether audit: signing is server-side and is NOT carried on the wire, so the
// renderer shows no signature. Note surface the sig id (response header or
// audit-list endpoint) during future work, then re-enable an --audit line.

import type { Writable } from "node:stream";
import type { StreamFrame } from "./stream.js";

export interface RenderOptions {
  json: boolean;
  audit: boolean;
  out?: Writable;
  err?: Writable;
}

export class Renderer {
  private readonly out: Writable;
  private readonly err: Writable;

  constructor(private readonly opts: RenderOptions) {
    this.out = opts.out ?? process.stdout;
    this.err = opts.err ?? process.stderr;
  }

  frame(f: StreamFrame): void {
    if (this.opts.json) {
      this.out.write(JSON.stringify(f) + "\n");
      return;
    }
    switch (f.type) {
      case "open":
      case "ping":
      case "connected":
        break; // handshake / liveness only
      case "reasoning":
        this.err.write(f.text); // thinking → stderr, keeps answer on stdout
        break;
      case "delta":
        this.out.write(f.text);
        break;
      case "usage":
        this.err.write(`\r⟢ ${f.uvt} UVT · ${f.cents.toFixed(2)}¢   `);
        break;
      case "progress":
        if (f.text) this.err.write(`\n· ${f.text}\n`);
        break;
      case "task_start":
        this.out.write(`\n[task ${f.taskId ?? ""}${f.label ? ` · ${f.label}` : ""}]\n`);
        break;
      case "task_progress":
        if (f.delta) this.out.write(f.delta);
        if (f.uvt != null) this.err.write(`\r⟢ ${f.uvt} UVT · ${(f.cents ?? 0).toFixed(2)}¢   `);
        break;
      case "task_done":
        this.out.write(`\n✓ task ${f.taskId ?? ""} done\n`);
        break;
      case "task_failed":
        this.err.write(`\n✗ task ${f.taskId ?? ""} failed${f.msg ? `: ${f.msg}` : ""}\n`);
        break;
      case "task_blocked":
        this.err.write(`\n⏸ task ${f.taskId ?? ""} blocked${f.msg ? `: ${f.msg}` : ""}\n`);
        break;
      case "project_done":
        this.out.write(`\n✓ project done\n`);
        break;
      case "done":
        this.done(f);
        break;
      case "error":
        this.error(f);
        break;
    }
  }

  private done(f: Extract<StreamFrame, { type: "done" }>): void {
    this.err.write("\r");
    this.out.write("\n");
    this.err.write(`— ${f.uvt} UVT · ${f.cents.toFixed(2)}¢\n`);
  }

  private error(f: Extract<StreamFrame, { type: "error" }>): void {
    this.err.write(`\n✗ ${f.msg}`);
    if (f.errorCode) this.err.write(` [${f.errorCode}]`);
    if (f.refId) this.err.write(` (ref ${f.refId})`);
    this.err.write("\n");
  }
}
