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
import { StatusRenderer } from "../ui/status_renderer.js";
import { AnimationController } from "../ui/animations.js";
import { HeartbeatIndicator } from "../ui/heartbeat.js";
import { LocalAgentSource, bindEventSource } from "../core/agent_events.js";

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
  /** Number of swarm workers (gated — see the swarm guard below). */
  swarm?: number;
}

const nowIso = (): string => new Date().toISOString();

export async function cmdCode(ctx: AppContext, task: string, opts: CodeOpts): Promise<number> {
  if (!task.trim()) {
    process.stderr.write('✗ nothing to do — try: aether code "fix the failing tests"\n');
    return 1;
  }
  // Swarm is GATED on purpose. The brainstorm sequences it last: "never swarm an
  // unproven loop — you'd multiply the failure." It is also LOCAL-ONLY (the cloud
  // path has its own orchestration). The runtime is specified in docs/SWARM_PLAN.md
  // and is built only after single-agent emission is proven (TESTING_HANDOFF §8).
  if ((opts.swarm ?? 1) > 1) {
    process.stderr.write(
      "✗ --swarm is gated.\n" +
        "  N-agent swarms multiply the #1 risk (tool-call emission fraying). Prove the\n" +
        "  single-agent loop first — run TESTING_HANDOFF.md §8 and confirm late-third\n" +
        "  emission holds. The runtime + build order live in docs/SWARM_PLAN.md.\n" +
        "  Swarm is also local-only; it will require --local when enabled.\n",
    );
    return 2;
  }
  const cwd = ctx.flags.cwd;
  const poolGb = opts.pool > 0 ? opts.pool : 5;
  const brainKind: "local" | "cloud" = opts.local ? "local" : "cloud";

  const brain: Brain = opts.local ? new LocalBrain() : new CloudBrain(ctx.api);
  const exec = new ToolExecutor(cwd, opts.testCmd);
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
    testCmd: opts.testCmd,
  };

  const interactive = Boolean(opts.interactive) && Boolean(process.stdin.isTTY);
  const onToolResult = (id: string, result: ToolResult): void => log?.toolResult(id, result, nowIso());

  // Capture the brain's ground-truth terminal event so the manifest's finalStatus
  // comes from a real final test run, never from the loop-exit code.
  let done: Extract<BrainEvent, { type: "done" }> | null = null;
  const capture = (ev: BrainEvent): void => {
    if (ev.type === "done") done = ev;
  };

  // Presentation fork — TTY (and not --json/--quiet) gets the live animated
  // status line; everything else (pipes, --json, --quiet, CI) gets the plain
  // HostRenderer. The animation layer is strictly downstream of the event data,
  // so the §8 emission logs are never polluted.
  const animated =
    !ctx.flags.json && !opts.quiet && Boolean(process.stdout.isTTY) && process.env["AETHER_NO_ANIM"] !== "1";

  let onEvent: (ev: BrainEvent) => void | Promise<void>;
  let teardown = (): void => {};

  if (animated) {
    const sr = new StatusRenderer({ mode: brainKind === "local" ? "local" : "api" });
    sr.start();
    const anim = new AnimationController({
      onFrame: (stage, art) => sr.setStage(stage, art),
      onProgress: (used, c) => sr.setProgress(used, c),
    });
    const hb = new HeartbeatIndicator({ onFrame: (g) => sr.setHeartbeat(g) });
    const source = new LocalAgentSource();
    bindEventSource(source, sr, anim, { hb, heartbeatTimeoutMs: 5000 });
    onEvent = async (ev: BrainEvent): Promise<void> => {
      capture(ev);
      log?.event(ev, nowIso());
      source.feedBrain(ev); // adapter -> animation/status (presentation only)
      if (interactive && ev.type === "stage") await stageGate(brain, ev.name);
    };
    teardown = (): void => {
      source.close();
      anim.stop();
      hb.stop();
      sr.end();
    };
  } else {
    const renderer = new HostRenderer({ poolGb, quiet: opts.quiet, json: ctx.flags.json });
    onEvent = async (ev: BrainEvent): Promise<void> => {
      capture(ev);
      renderer.event(ev);
      log?.event(ev, nowIso());
      if (interactive && ev.type === "stage") await stageGate(brain, ev.name);
    };
  }

  const code = await hostLoop(brain, exec, onEvent, taskCmd, onToolResult);
  teardown();

  // finalStatus from the brain's ground-truth done event (Fix 1), not the exit code.
  const d = done as Extract<BrainEvent, { type: "done" }> | null;
  const finalStatus = d ? (d.ok ? "ok" : d.reason || "incomplete") : "error";
  log?.close(finalStatus, nowIso(), d && !d.ok ? d.remaining : 0);
  if (log) process.stderr.write(`\n  ⤷ log: ${log.dir} · ${finalStatus}\n`);
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
