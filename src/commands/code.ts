// `aether code [--local] "<task>"` — the hybrid coding terminal. One host loop
// drives a pluggable brain: cloud (Aether API, UVT-metered) by default, or the
// local Python/Ollama brain with --local. Same host, same render, same tools,
// same commands — only the brain transport differs (specs/aethercode_bridge.md).
//
// The loop is the seam: the brain decides (emits events); the host renders every
// event and executes every tool_call locally, then replies. That is why local
// and cloud are indistinguishable UX.

import { createInterface } from "node:readline";
import type { AppContext } from "../core/context.js";
import type { Brain, TaskCommand } from "../core/brain.js";
import type { BrainEvent } from "../core/brain_protocol.js";
import type { ToolResult } from "../core/tool_executor.js";
import { LocalBrain } from "../core/brain_local.js";
import { CloudBrain } from "../core/brain_cloud.js";
import { ToolExecutor } from "../core/tool_executor.js";
import { HostRenderer } from "../ui/host_render.js";
import { SessionLog } from "../core/session_log.js";

export interface CodeOpts {
  /** Use the local Python/Ollama brain instead of the cloud API. */
  local: boolean;
  /** Pool size in GB (sets the status-bar denominator: pool x 233M). */
  pool: number;
  /** Effort tier (LOW..CODEPRO) — passed to the brain as a budget ceiling. */
  effort?: string;
  /** Command the grounding gate runs (default pytest -q, host-executed). */
  testCmd?: string;
  /** Strip the personality frames to plain lines. */
  quiet: boolean;
  /** Auto-pause at each stage boundary to accept a /steer (TTY only). */
  interactive?: boolean;
  /** Disable the local session log. */
  noLog?: boolean;
}

const nowIso = (): string => new Date().toISOString();

export async function cmdCode(ctx: AppContext, task: string, opts: CodeOpts): Promise<number> {
  if (!task.trim()) {
    process.stderr.write('✗ nothing to do — try: aether code "fix the failing tests"\n');
    return 1;
  }
  const cwd = ctx.flags.cwd;
  const poolGb = opts.pool > 0 ? opts.pool : 5;
  const brainKind: "local" | "cloud" = opts.local ? "local" : "cloud";

  const brain: Brain = opts.local ? new LocalBrain() : new CloudBrain(ctx.api);
  const exec = new ToolExecutor(cwd, opts.testCmd);
  const renderer = new HostRenderer({ poolGb, quiet: opts.quiet, json: ctx.flags.json });
  const log = opts.noLog
    ? null
    : new SessionLog({ task, model: ctx.flags.model ?? "", poolGb, brain: brainKind }, nowIso());

  const taskCmd: TaskCommand = {
    type: "task",
    text: task,
    cwd,
    poolGb,
    effort: opts.effort,
    model: ctx.flags.model,
  };

  const interactive = Boolean(opts.interactive) && Boolean(process.stdin.isTTY);

  const onEvent = async (ev: BrainEvent): Promise<void> => {
    renderer.event(ev);
    log?.event(ev, nowIso());
    if (interactive && ev.type === "stage") await stageGate(brain, ev.name);
  };
  const onToolResult = (id: string, result: ToolResult): void => log?.toolResult(id, result, nowIso());

  const code = await hostLoop(brain, exec, onEvent, taskCmd, onToolResult);
  log?.close(code === 0 ? "ok" : "failed", nowIso());
  if (log) process.stderr.write(`\n  ⤷ log: ${log.dir}\n`);
  return code;
}

/** Pause at a stage boundary; an entered line becomes a /steer, blank resumes. */
async function stageGate(brain: Brain, stage: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const note = await new Promise<string>((res) =>
      rl.question(`\n⏸ ${stage} — [enter] continue, or type a steer: `, res),
    );
    if (note.trim()) brain.control("steer", note.trim());
  } finally {
    rl.close();
  }
}

/**
 * The host loop — the bridge seam, extracted so it is unit-testable with a fake
 * brain. The brain decides (emits events); the host renders each event and
 * executes each tool_call locally, replying with the result. Returns the process
 * exit code (0 = the run finished green). Always tears the brain down.
 */
export async function hostLoop(
  brain: Brain,
  exec: ToolExecutor,
  onEvent: (ev: BrainEvent) => void | Promise<void>,
  task: TaskCommand,
  onToolResult?: (id: string, result: ToolResult) => void,
): Promise<number> {
  let code = 0;
  try {
    for await (const ev of brain.run(task)) {
      await onEvent(ev);
      switch (ev.type) {
        case "tool_call": {
          // The host owns execution + the path-guard; reply with the result.
          const result = exec.execute(ev.name, ev.args);
          onToolResult?.(ev.id, result);
          brain.sendToolResult(ev.id, result);
          break;
        }
        case "done":
          code = ev.ok ? 0 : 1;
          break;
        case "error":
          code = 1;
          break;
      }
    }
  } finally {
    brain.close();
  }
  return code;
}
