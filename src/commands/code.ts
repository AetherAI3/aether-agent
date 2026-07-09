// `aether code [--local] "<task>"` — the hybrid coding terminal. One host loop
// drives a pluggable brain: cloud (Aether API, UVT-metered) by default, or the
// local Python/Ollama brain with --local. Same host, same render, same tools,
// same commands — only the brain transport differs (specs/aethercode_bridge.md).
//
// The loop is the seam: the brain decides (emits events); the host renders every
// event and executes every tool_call locally, then replies. That is why local
// and cloud are indistinguishable UX.

import type { AppContext } from "../core/context.js";
import type { Brain, TaskCommand } from "../core/brain.js";
import type { BrainEvent } from "../core/brain_protocol.js";
import type { ToolResult } from "../core/tool_executor.js";
import { LocalBrain } from "../core/brain_local.js";
import { CloudBrain } from "../core/brain_cloud.js";
import { ToolExecutor } from "../core/tool_executor.js";
import { stdioPrompt } from "../ui/interact.js";
import { defaultRunner } from "../core/worktree.js";
import { HostRenderer } from "../ui/host_render.js";
import { SessionLog } from "../core/session_log.js";
import { StatusRenderer } from "../ui/status_renderer.js";
import { AnimationController } from "../ui/animations.js";
import { HeartbeatIndicator } from "../ui/heartbeat.js";
import { LocalAgentSource, bindEventSource } from "../core/agent_events.js";
import { TaskLedger } from "../ui/ledger.js";
import {
  CODE_STAGES,
  answerAgentQuestionIfPresent,
  applyToLedger,
  prepareWorkspace,
  stageGate,
  writeDiffLines,
} from "./code_support.js";

export { prepareWorkspace } from "./code_support.js";

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
  // One interaction channel for the whole run: the repo gate, friendly stage
  // pauses, and agent questions all speak through it (stderr-backed, so piped
  // stdout stays clean; auto-answers in non-TTY / --yes).
  const io = stdioPrompt();

  // ── 2.0 repo gate ──────────────────────────────────────────────────────
  // Before any brain touches your tree, confirm "are you working in this repo?"
  // (identical wording in predator-cli). When `gh` is authenticated and this is
  // a git repo, run inside a REAL isolated worktree on a fresh aether/<slug>
  // branch; otherwise it's confirm-only and we run in place. A non-TTY run
  // without --yes proceeds in place with zero prompts/side effects, so pipes,
  // CI, and tests never hang.
  const ws = await prepareWorkspace(ctx, task, io, defaultRunner());
  if (!ws.proceed) return 0;
  const cwd = ws.cwd;
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

  // Presentation fork — TTY (and not --json/--quiet) gets the live animated
  // status line; everything else (pipes, --json, --quiet, CI) gets the plain
  // HostRenderer. The animation layer is strictly downstream of the event data,
  // so the §8 emission logs are never polluted.
  const animated =
    !ctx.flags.json && !opts.quiet && Boolean(process.stdout.isTTY) && process.env["AETHER_NO_ANIM"] !== "1";

  // Multi-task ledger over the reasoning pipeline — drives the pinned n/7 counter
  // (animated) and the end-of-run checklist recap (✓ down the pipeline, ✗ where
  // it broke) on both paths. Seeded with the fixed stages so progress is forward
  // looking from the first frame.
  const ledger = new TaskLedger(CODE_STAGES);
  const cols = process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;

  let onEvent: (ev: BrainEvent) => void | Promise<void>;
  let teardown = (): void => {};

  if (animated) {
    const sr = new StatusRenderer({ mode: brainKind === "local" ? "local" : "api" });
    sr.start();
    const anim = new AnimationController({
      onFrame: (stage, art) => sr.setStage(stage, art),
      onProgress: (used, c) => sr.setProgress(used, c),
    });
    const hb = new HeartbeatIndicator({
      onFrame: (g, beats) => {
        sr.setHeartbeat(g);
        sr.setBeats(beats); // feed the thinking timer's live heartbeat count
      },
    });
    const source = new LocalAgentSource();
    bindEventSource(source, sr, anim, { hb, heartbeatTimeoutMs: 5000 });
    onEvent = async (ev: BrainEvent): Promise<void> => {
      log?.event(ev, nowIso());
      applyToLedger(ledger, ev);
      // Intercept the whole-file write to render a live green/red diff into
      // scrollback — the old file is still on disk because hostLoop runs onEvent
      // BEFORE exec.execute. Skip feedBrain for it so we don't ALSO print the
      // "  : write_file …" line; the animated kaomoji status line keeps pulsing
      // below, so the diff and the live state stay in sync.
      const diff =
        ev.type === "tool_call" && ev.name === "write_file" ? writeDiffLines(exec, ev.args, true) : null;
      if (diff && diff.length) {
        for (const line of diff) sr.log(line);
      } else {
        source.feedBrain(ev); // adapter -> animation/status (presentation only)
      }
      // Refresh the pinned multi-step counter only on stage changes — never after
      // a terminal event (feedBrain's done case already calls sr.end()).
      if (ev.type === "stage") sr.setTasks(ledger.progress());
      if (interactive && ev.type === "stage") await stageGate(brain, io, ev.name);
      if (interactive && ev.type === "monologue") await answerAgentQuestionIfPresent(brain, io, ev.text);
    };
    teardown = (): void => {
      // Final multi-step recap into scrollback, then drop the pinned line.
      const recap = ledger.panel(cols);
      if (recap.length) {
        sr.log("");
        for (const line of recap) sr.log(line);
      }
      source.close();
      anim.stop();
      hb.stop();
      sr.end();
    };
  } else {
    const renderer = new HostRenderer({ poolGb, quiet: opts.quiet, json: ctx.flags.json });
    onEvent = async (ev: BrainEvent): Promise<void> => {
      applyToLedger(ledger, ev);
      // Same diff interception for the non-animated path (pipes / NO_ANIM /
      // --quiet). Suppressed under --json so machine consumers still receive the
      // raw tool_call event, never the rendered diff.
      const diff =
        !ctx.flags.json && ev.type === "tool_call" && ev.name === "write_file"
          ? writeDiffLines(exec, ev.args, false)
          : null;
      if (diff && diff.length) renderer.writeLines(diff);
      else renderer.event(ev);
      // End-of-run checklist recap (writeLines is a no-op under --json).
      if (ev.type === "done") renderer.writeLines(ledger.panel(cols));
      log?.event(ev, nowIso());
      if (interactive && ev.type === "stage") await stageGate(brain, io, ev.name);
      if (interactive && ev.type === "monologue") await answerAgentQuestionIfPresent(brain, io, ev.text);
    };
  }

  const code = await hostLoop(brain, exec, onEvent, taskCmd, onToolResult);
  teardown();

  // ── Final verification gate: ground truth, never the brain's self-report ──
  // The host runs the test command ITSELF and derives finalStatus from the exit
  // code — it does not trust the brain's done event. Only "ok" when the final
  // verify is green; "incomplete" (with the failing count) whenever tests fail.
  let finalStatus: "ok" | "incomplete" | "unverified" = "unverified";
  let remaining = 0;
  if (opts.testCmd) {
    const verify = exec.execute("run_tests", {});
    if (verify.exitCode === 0) {
      finalStatus = "ok";
    } else {
      finalStatus = "incomplete";
      const m = verify.output.match(/(\d+) failed/);
      remaining = m ? parseInt(m[1]!, 10) : -1;
    }
  }
  log?.close(finalStatus, nowIso(), remaining);
  if (log) process.stderr.write(`\n  ⤷ log: ${log.dir} · ${finalStatus}\n`);
  return finalStatus === "incomplete" ? 1 : code;
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
