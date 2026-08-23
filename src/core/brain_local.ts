// LocalBrain — the local transport. Spawns the headless Python brain
// (`python -m aether_agent.headless`) and speaks NDJSON over its stdio:
// events arrive on the child's stdout (line-buffered), commands go to stdin.
//
// The Python brain runs the Unlimited Context engine + Ollama inference and
// DECIDES; it executes no tools and renders nothing. This host executes every
// tool_call and replies, so the local path is identical to cloud by
// construction (see specs/aethercode_bridge.md).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { sanitizeTerm } from "../ui/text.js";
import type { Brain, TaskCommand } from "./brain.js";
import { EventQueue } from "./brain.js";
import {
  LineBuffer,
  encodeCommand,
  parseEventLine,
  type BrainEvent,
  type HostCommand,
} from "./brain_protocol.js";
import type { ToolResult } from "./tool_executor.js";

/**
 * How the brain subprocess is started. Injected so the local path is testable
 * without a Python installation: LocalBrain speaks a line protocol over stdio,
 * and a fake that speaks the same protocol is indistinguishable from the real
 * child. Without this seam nothing could drive LocalBrain at all, which is why
 * the local-vs-Ollama parity canary could not be written.
 */
export type BrainSpawner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

export interface LocalBrainOptions {
  /** Override how the child is started. Defaults to node's spawn. */
  spawn?: BrainSpawner;
  /** Python interpreter (default: $AETHER_PYTHON or "python"). */
  python?: string;
  /** Module to run as the brain (default: aether_agent.headless). */
  module?: string;
  /** Extra env for the child (e.g. AETHER_MODEL, OLLAMA_HOST). */
  env?: Record<string, string>;
  /** Override child stderr handling. The default preserves the human CLI. */
  diagnostic?: (text: string) => void;
}

export class LocalBrain implements Brain {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly queue = new EventQueue();
  private readonly lines = new LineBuffer();
  private readonly opts: LocalBrainOptions;

  constructor(opts: LocalBrainOptions = {}) {
    this.opts = opts;
  }

  run(task: TaskCommand): AsyncIterable<BrainEvent> {
    // `||` not `??` — an empty AETHER_PYTHON ("" from a failed shell export) must
    // fall back to "python", or spawn() throws "argument 'file' cannot be empty".
    const python = this.opts.python || process.env["AETHER_PYTHON"] || "python";
    const mod = this.opts.module ?? "aether_agent.headless";
    const start: BrainSpawner =
      this.opts.spawn ??
      ((command, args, options) =>
        spawn(command, [...args], { ...options, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams);
    const child = start(python, ["-m", mod], {
      cwd: task.cwd,
      // PYTHONUTF8 belt-and-suspenders alongside the ASCII-escaped wire: the
      // child's stdio never falls back to cp1252 on Windows.
      env: { ...process.env, PYTHONUTF8: "1", ...(this.opts.env ?? {}) },
    });
    this.child = child;

    // A dead child's stdin raises EPIPE asynchronously; without a listener
    // that's an uncaught exception that kills the whole CLI mid-run (and the
    // session log never closes). The close/exit path already surfaces the
    // brain's death; the write error itself is noise.
    child.stdin.on("error", () => {});

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      for (const line of this.lines.push(chunk)) {
        const ev = parseEventLine(line);
        if (ev) {
          this.queue.push(ev);
          if (ev.type === "done" || ev.type === "error") this.queue.end();
        }
      }
    });
    // The child's stderr is its own diagnostics (tracebacks); forward dimmed so
    // a brain crash is visible rather than a silent hang.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) =>
      (this.opts.diagnostic ?? ((text) => process.stderr.write(text)))(sanitizeTerm(d)),
    );

    child.on("error", (err) => {
      this.queue.push({ type: "error", msg: `cannot start local brain (${python}): ${err.message}` });
      this.queue.end();
    });
    child.on("close", () => this.queue.end());

    // Kick off the run with the task command.
    this.send(task);
    return this.queue.drain();
  }

  sendToolResult(id: string, result: ToolResult): void {
    this.send({ type: "tool_result", id, output: result.output, exitCode: result.exitCode });
  }

  control(action: "pause" | "resume" | "steer", note?: string): void {
    this.send({ type: "control", action, note });
  }

  close(): void {
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    this.queue.end();
  }

  private send(cmd: HostCommand): void {
    if (this.child && this.child.stdin.writable) {
      this.child.stdin.write(encodeCommand(cmd));
    }
  }
}
