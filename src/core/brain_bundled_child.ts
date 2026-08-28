import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Brain, BrainControlResult, TaskCommand } from "./brain.js";
import { EventQueue } from "./brain.js";
import { LineBuffer, type BrainEvent, type ToolName } from "./brain_protocol.js";
import type { ToolResult } from "./tool_executor.js";
import { terminateProcessTree } from "./process_tree_kill.js";

export type BundledChildMode = "ollama" | "selftest";

export interface BundledChildBrainOptions {
  mode?: BundledChildMode;
  diagnostic?: (text: string) => void;
  allowedTools?: readonly ToolName[];
}

export class BundledChildBrain implements Brain {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly queue = new EventQueue();
  private readonly lines = new LineBuffer();
  private controlSequence = 0;
  private readonly pendingControls = new Map<
    string,
    { resolve: (result: BrainControlResult) => void; timer: NodeJS.Timeout }
  >();
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
        let raw: Record<string, unknown>;
        try { raw = JSON.parse(line) as Record<string, unknown>; }
        catch {
          this.queue.push({ type: "error", msg: "bundled brain emitted malformed JSONL" });
          this.close();
          return;
        }
        if (raw["type"] === "control_result") {
          const id = String(raw["id"] ?? "");
          const pending = this.pendingControls.get(id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingControls.delete(id);
            const state = raw["state"] === "paused" || raw["state"] === "closed" ? raw["state"] : "running";
            pending.resolve({
              accepted: raw["accepted"] === true,
              state,
              ...(typeof raw["error"] === "string" ? { error: raw["error"] } : {}),
            });
          }
          continue;
        }
        const event = raw as unknown as BrainEvent;
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
    child.stdin.write(JSON.stringify({ ...task, allowed_tools: this.opts.allowedTools ?? [] }) + "\n");
    return this.queue.drain();
  }

  sendToolResult(id: string, result: ToolResult): void {
    this.send({ type: "tool_result", id, output: result.output, exitCode: result.exitCode });
  }
  control(action: "pause" | "resume" | "steer", note?: string): Promise<BrainControlResult> {
    if (!this.child?.stdin.writable) {
      return Promise.resolve({ accepted: false, state: "closed", error: "bundled brain is not running" });
    }
    const id = `control-${this.controlSequence++}`;
    return new Promise<BrainControlResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingControls.delete(id);
        resolve({ accepted: false, state: "closed", error: "bundled brain did not acknowledge control" });
      }, 2000);
      timer.unref();
      this.pendingControls.set(id, { resolve, timer });
      this.send({ type: "control", id, action, ...(note == null ? {} : { note }) });
    });
  }
  close(): void {
    terminateProcessTree(this.child);
    this.child = null;
    for (const [id, pending] of this.pendingControls) {
      clearTimeout(pending.timer);
      this.pendingControls.delete(id);
      pending.resolve({ accepted: false, state: "closed", error: "bundled brain closed before control acknowledgement" });
    }
    this.queue.end();
  }
  private send(message: Record<string, unknown>): void {
    if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(message) + "\n");
  }
}
