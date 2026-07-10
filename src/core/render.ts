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
import { TaskLedger } from "../ui/ledger.js";
import { errTheme } from "../ui/theme.js";

export interface RenderOptions {
  json: boolean;
  audit: boolean;
  out?: Writable;
  err?: Writable;
}

export class Renderer {
  private readonly out: Writable;
  private readonly err: Writable;
  private agentHeader = false;
  private tasksStarted = 0;
  private tasksDone = 0;
  // Live checklist of orchestrator tasks — concurrent (peers don't auto-complete
  // each other), recapped as a ✓/✗ panel at project completion.
  private readonly ledger = new TaskLedger();
  private readonly taskLedgerLabels = new Map<string, string>();

  constructor(private readonly opts: RenderOptions) {
    this.out = opts.out ?? process.stdout;
    this.err = opts.err ?? process.stderr;
  }

  /** Project completion fraction so far (done / started). */
  private projFrac(): number {
    return this.tasksStarted > 0 ? this.tasksDone / this.tasksStarted : 0;
  }

  /** Stable ledger label for a task id (falls back to `task <id>`). */
  private labelFor(taskId?: string): string {
    if (taskId && this.taskLedgerLabels.has(taskId)) return this.taskLedgerLabels.get(taskId)!;
    return taskId ? `task ${taskId}` : "task";
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
        // thinking → stderr (keeps the answer on stdout), dimmed so it reads
        // as a different voice than the answer. errTheme: keyed off stderr.
        this.err.write(errTheme.dim(f.text));
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
      case "task_start": {
        this.ensureHeader();
        this.tasksStarted += 1;
        const label = f.label ?? `task ${f.taskId ?? ""}`;
        const ledgerLabel = f.taskId ? `${label} (${f.taskId})` : label;
        if (f.taskId) this.taskLedgerLabels.set(f.taskId, ledgerLabel);
        this.ledger.setActive(ledgerLabel, false); // peers stay active - these run concurrently
        this.out.write("\n" + actionLine(label, "active", f.taskId ?? "", this.projFrac()) + "\n");
        break;
      }
      case "task_progress":
        if (f.delta) this.out.write(f.delta);
        if (f.uvt != null) this.err.write(`\r⟢ ${f.uvt} UVT · ${(f.cents ?? 0).toFixed(2)}¢   `);
        break;
      case "task_done":
        this.tasksDone += 1;
        this.ledger.setState(this.labelFor(f.taskId), "done");
        this.out.write("\n" + actionLine(`${f.taskId ?? "task"} done`, "logging", "", this.projFrac()) + "\n");
        break;
      case "task_failed":
        this.ledger.setState(this.labelFor(f.taskId), "failed");
        this.err.write("\n" + actionLine(`${f.taskId ?? "task"} failed`, "error", f.msg ?? "", this.projFrac()) + "\n");
        break;
      case "task_blocked":
        this.err.write("\n" + actionLine(`${f.taskId ?? "task"} blocked`, "idle", f.msg ?? "", this.projFrac()) + "\n");
        break;
      case "project_done":
        this.ledger.finishAll();
        this.out.write("\n" + actionLine("project complete", "active", "", 1) + "\n");
        for (const line of this.ledger.panel()) this.out.write(line + "\n");
        break;
      case "custody": {
        // Persistence happens in the chat loop; here we only confirm receipt.
        const orderId = String(f.custody["order_id"] ?? "");
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
    this.err.write("\r");
    this.out.write("\n");
    this.err.write(`— ${f.uvt} UVT · ${f.cents.toFixed(2)}¢\n`);
  }

  private error(f: Extract<StreamFrame, { type: "error" }>): void {
    this.err.write(`\n${errTheme.red("✗")} ${f.msg}`);
    if (f.errorCode) this.err.write(` [${f.errorCode}]`);
    if (f.refId) this.err.write(` (ref ${f.refId})`);
    this.err.write("\n");
  }
}
