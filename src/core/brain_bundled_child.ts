import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Brain, TaskCommand } from "./brain.js";
import { EventQueue } from "./brain.js";
import { LineBuffer, type BrainEvent } from "./brain_protocol.js";
import type { ToolResult } from "./tool_executor.js";
import { terminateProcessTree } from "./process_tree_kill.js";

export type BundledChildMode = "ollama" | "selftest";

export interface BundledChildBrainOptions {
  mode?: BundledChildMode;
  diagnostic?: (text: string) => void;
}

export class BundledChildBrain implements Brain {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly queue = new EventQueue();
  private readonly lines = new LineBuffer();
  constructor(private readonly opts: BundledChildBrainOptions = {}) {}

  run(task: TaskCommand): AsyncIterable<BrainEvent> {
    const entry = fileURLToPath(new URL("./headless_brain_child.js", import.meta.url));
    const child = spawn(process.execPath, [entry, this.opts.mode ?? "ollama"], {
      cwd: task.cwd,
      env: { ...process.env },
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdin.on("error", () => {});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      for (const line of this.lines.push(chunk)) {
        let event: BrainEvent;
        try { event = JSON.parse(line) as BrainEvent; }
        catch {
          this.queue.push({ type: "error", msg: "bundled brain emitted malformed JSONL" });
          this.close();
          return;
        }
        if (!event || typeof event !== "object" || typeof event.type !== "string") {
          this.queue.push({ type: "error", msg: "bundled brain emitted an invalid event" });
          this.close();
          return;
        }
        this.queue.push(event);
        if (event.type === "done" || event.type === "error") this.queue.end();
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => this.opts.diagnostic?.(text));
    child.on("error", (error) => {
      this.queue.push({ type: "error", msg: `cannot start bundled brain: ${error.message}` });
      this.queue.end();
    });
    child.on("close", () => {
      if (this.lines.rest().trim()) this.queue.push({ type: "error", msg: "bundled brain emitted truncated JSONL" });
      this.queue.end();
    });
    child.stdin.write(JSON.stringify(task) + "\n");
    return this.queue.drain();
  }

  sendToolResult(id: string, result: ToolResult): void {
    this.send({ type: "tool_result", id, output: result.output, exitCode: result.exitCode });
  }
  control(): void { /* host reports v1 control actions as unsupported */ }
  close(): void {
    terminateProcessTree(this.child);
    this.child = null;
    this.queue.end();
  }
  private send(message: Record<string, unknown>): void {
    if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(message) + "\n");
  }
}
