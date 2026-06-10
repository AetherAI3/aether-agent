// `aether agent [--local] "<task>"` — the hybrid coding terminal. One host loop
// drives a pluggable brain: cloud (Aether API, UVT-metered) by default, or the
// local Python/Ollama brain with --local. Same host, same render, same tools,
// same commands — only the brain transport differs (specs/aethercode_bridge.md).
//
// The loop is the seam: the brain decides (emits events); the host renders every
// event and executes every tool_call locally, then replies. That is why local
// and cloud are indistinguishable UX.

import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppContext } from "../core/context.js";
import type { Brain, TaskCommand } from "../core/brain.js";
import type { BrainEvent } from "../core/brain_protocol.js";
import type { ToolResult } from "../core/tool_executor.js";
import { LocalBrain } from "../core/brain_local.js";
import { CloudBrain } from "../core/brain_cloud.js";
import { ToolExecutor } from "../core/tool_executor.js";
import { HostRenderer } from "../ui/host_render.js";
import { SessionLog } from "../core/session_log.js";
import { finalVerify, type BrainDone } from "../core/verify_gate.js";
import { StatusRenderer } from "../ui/status_renderer.js";
import { AnimationController } from "../ui/animations.js";
import { HeartbeatIndicator } from "../ui/heartbeat.js";
import { LocalAgentSource, bindEventSource } from "../core/agent_events.js";
import { phaseVerb } from "../ui/phase_verb.js";
import { lineDiff, renderDiff } from "../ui/diff_render.js";
import { loadSession, replayLines } from "../core/session_resume.js";
import { resumeHint } from "./resume.js";
import { createWorktree, mergeHint, type Worktree } from "../core/worktree.js";
import { parseRepoSpec, ensureLocalClone, prCreateHint, type RepoSpec } from "../core/repo.js";
import { decideGate } from "../core/autonomy.js";

/** Approve (or refuse) one brain-emitted tool call before the host executes it. */
export type ToolGate = (call: { name: string; args: Record<string, unknown> }) => Promise<boolean>;

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
  /** Resume a prior local session id: replay its transcript before this run. */
  resume?: string;
  /** Isolate the run in a fresh git worktree on an auto-named branch. */
  worktree?: boolean;
  /** Work on a GitHub repo (owner/name): clone via gh/git, then worktree it. */
  repo?: string;
}

const nowIso = (): string => new Date().toISOString();

/** Map a BrainEvent onto the pinned status line (verb + streamed tokens).
 * Exported so the wiring is unit-testable without a real brain. */
export function applyEventToStatus(
  sr: { setVerb(v: string, k: string): void; setStreamed(n: number): void },
  ev: BrainEvent,
  tick: number,
): void {
  if (ev.type === "stage") {
    const v = phaseVerb(ev.name, tick);
    sr.setVerb(v.verb, v.kao);
  } else if (ev.type === "telemetry") {
    sr.setStreamed(ev.tokens);
  }
}

/** Colorized diff preview for a write_file edit, or null if not an edit. Reads
 * the on-disk file as the "before". */
export function editPreview(cwd: string, ev: BrainEvent): string | null {
  if (ev.type !== "tool_call" || ev.name !== "write_file") return null;
  const path = String(ev.args["path"] ?? "");
  const next = String(ev.args["content"] ?? "");
  if (!path) return null;
  const abs = resolve(cwd, path);
  const prev = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  const ops = lineDiff(prev, next);
  if (ops.length === 0) return null;
  return renderDiff(path, ops);
}

/** Replay a prior local session's transcript into the active surface. Fail-soft:
 * a missing/unreadable session prints a note and does not abort the new run. */
function replaySession(id: string, emit: (line: string) => void): void {
  try {
    const prior = loadSession(id);
    for (const line of replayLines(prior.events)) emit(line);
  } catch (err) {
    process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export async function cmdCode(ctx: AppContext, task: string, opts: CodeOpts): Promise<number> {
  if (!task.trim()) {
    process.stderr.write('✗ nothing to do — try: aether agent "fix the failing tests"\n');
    return 1;
  }
  // Swarm is GATED on purpose: never swarm an unproven loop — N agents multiply
  // the #1 failure (tool-call emission fraying). It is also LOCAL-ONLY (the cloud
  // path has its own orchestration). Stays gated until the single-agent loop is
  // proven on real long sessions.
  if ((opts.swarm ?? 1) > 1) {
    process.stderr.write(
      "✗ --swarm is not enabled yet.\n" +
        "  N-agent swarms multiply the #1 risk (tool-call emission fraying), so the\n" +
        "  single-agent loop is proven first. Swarm will also be local-only (--local).\n",
    );
    return 2;
  }
  // --repo owner/name: bring the user's GitHub repo local (their own gh/git
  // auth — no backend token) so the agent can work on it. --repo implies a
  // worktree so the run lands on an isolated branch ready for a PR.
  let repoSpec: RepoSpec | null = null;
  let repoRoot = ctx.flags.cwd;
  if (opts.repo) {
    try {
      repoSpec = parseRepoSpec(opts.repo);
      const co = ensureLocalClone(repoSpec);
      repoRoot = co.dir;
      process.stderr.write(`⎇ repo ${repoSpec.full} ${co.cloned ? "(cloned)" : "(reusing local clone)"}\n  ${co.dir}\n`);
    } catch (err) {
      process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }
  // --worktree (or implied by --repo): cut a fresh git worktree off the repo and
  // run the agent there, so its edits land on an isolated branch, not your tree.
  let worktree: Worktree | null = null;
  if (opts.worktree || opts.repo) {
    try {
      worktree = createWorktree(repoRoot, task);
      process.stderr.write(`⌥ worktree ${worktree.branch}\n  ${worktree.dir}\n`);
    } catch (err) {
      process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }
  const cwd = worktree ? worktree.dir : ctx.flags.cwd;
  const poolGb = opts.pool > 0 ? opts.pool : 5;
  const brainKind: "local" | "cloud" = opts.local ? "local" : "cloud";

  const brain: Brain = opts.local ? new LocalBrain() : new CloudBrain(ctx.api);
  const exec = new ToolExecutor(cwd, opts.testCmd);
  const log = opts.noLog
    ? null
    : new SessionLog({ task, model: ctx.flags.model ?? "", poolGb, brain: brainKind }, nowIso());

  // Ctrl-C prints the exact command to re-enter this session. Registered BEFORE
  // the renderer's own SIGINT handler so this fires first.
  if (log) {
    process.once("SIGINT", () => {
      process.stderr.write("\n" + resumeHint(log.sessionId) + "\n");
      process.exit(130);
    });
  }

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

  // Permission gate: every brain-emitted mutating/shell tool call is approved
  // here before the host runs it. Honors the configured permission mode + auto-
  // apply; in `ask` (the default) on a TTY the user gets a y/N prompt, and on a
  // non-TTY (CI/pipe) an un-pre-approved call FAILS CLOSED rather than running
  // unattended. `--yes` or `permissionMode: skip` opt out.
  const gate: ToolGate = async ({ name, args }) => {
    const outcome = decideGate(name, ctx.cfg.permissionMode, ctx.cfg.autoApply, {
      yes: ctx.flags.yes,
      isTty: Boolean(process.stdin.isTTY),
    });
    if (outcome === "allow") return true;
    if (outcome === "deny") {
      process.stderr.write(
        `✗ blocked ${name} — permission mode "${ctx.cfg.permissionMode}" needs confirmation but there is no TTY.\n` +
          `  re-run with --yes, or set a less strict mode: aether config set permissionMode skip\n`,
      );
      return false;
    }
    const detail = String(args["command"] ?? args["path"] ?? args["message"] ?? "");
    const shown = detail.length > 200 ? detail.slice(0, 197) + "…" : detail;
    return ctx.confirm(`\n⚠ ${name}${shown ? ` ${shown}` : ""} — run it? [y/N] `);
  };

  // Presentation fork — TTY (and not --json/--quiet) gets the live animated
  // status line; everything else (pipes, --json, --quiet, CI) gets the plain
  // HostRenderer. The animation layer is strictly downstream of the event data,
  // so the §8 emission logs are never polluted.
  const animated =
    !ctx.flags.json && !opts.quiet && Boolean(process.stdout.isTTY) && process.env["AETHER_NO_ANIM"] !== "1";

  let onEvent: (ev: BrainEvent) => void | Promise<void>;
  let teardown = (): void => {};

  // Capture the brain's terminal event — advisory input to the host verify gate.
  // `done` (the brain finished its loop): its breaker reason enriches a red result
  // but never upgrades a red run to "ok". `error` (the brain CRASHED mid-run): the
  // run is untrustworthy, so a coincidentally-green tree is reported "error", not "ok".
  let lastDone: BrainDone | null = null;
  let sawError = false;
  const captureDone = (ev: BrainEvent): void => {
    if (ev.type === "done") lastDone = { ok: ev.ok, remaining: ev.remaining, reason: ev.reason };
    else if (ev.type === "error") sawError = true;
  };

  if (animated) {
    const sr = new StatusRenderer({ mode: brainKind === "local" ? "local" : "api" });
    sr.start();
    if (opts.resume) replaySession(opts.resume, (line) => sr.log(line));
    const anim = new AnimationController({
      onFrame: (stage, art) => sr.setStage(stage, art),
      onProgress: (used, c) => sr.setProgress(used, c),
    });
    const hb = new HeartbeatIndicator({ onFrame: (g) => sr.setHeartbeat(g) });
    const source = new LocalAgentSource();
    bindEventSource(source, sr, anim, { hb, heartbeatTimeoutMs: 5000 });
    let tick = 0;
    onEvent = async (ev: BrainEvent): Promise<void> => {
      log?.event(ev, nowIso());
      applyEventToStatus(sr, ev, tick++);
      const dp = editPreview(cwd, ev);
      if (dp) sr.log(dp);
      captureDone(ev);
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
    if (opts.resume) replaySession(opts.resume, (line) => process.stdout.write(line + "\n"));
    onEvent = async (ev: BrainEvent): Promise<void> => {
      renderer.event(ev);
      log?.event(ev, nowIso());
      const dp = editPreview(cwd, ev);
      if (dp) process.stdout.write(dp + "\n");
      captureDone(ev);
      if (interactive && ev.type === "stage") await stageGate(brain, ev.name);
    };
  }

  const code = await hostLoop(brain, exec, onEvent, taskCmd, onToolResult, gate);
  teardown();

  // ── Final verification gate: ground truth, never the brain's self-report ──
  // The host re-runs the test command ITSELF and derives finalStatus from the real
  // exit code (verify_gate.ts). The brain's `done` is advisory — it only enriches a
  // red result with its breaker reason and can never upgrade a red run to "ok".
  const { status: finalStatus, remaining, exitCode: verifyExit } = finalVerify(exec, opts.testCmd, lastDone, sawError);
  log?.close(finalStatus, nowIso(), remaining);
  if (log) {
    const tail = remaining > 0 ? ` (${remaining} failing)` : "";
    process.stderr.write(`\n  ⤷ log: ${log.dir} · ${finalStatus}${tail}\n`);
  }
  if (worktree) process.stderr.write(mergeHint(worktree));
  if (repoSpec && worktree) process.stderr.write(prCreateHint(repoSpec, worktree.branch));
  // Process exit follows the HOST: 0 only on a verified-green run. With no gate
  // ("unverified") there is no ground truth, so the loop's own code stands.
  if (finalStatus === "ok") return 0;
  if (finalStatus === "unverified") return code;
  return verifyExit !== 0 ? verifyExit : 1;
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
  gate?: ToolGate,
): Promise<number> {
  let code = 0;
  try {
    for await (const ev of brain.run(task)) {
      await onEvent(ev);
      switch (ev.type) {
        case "tool_call": {
          // The host owns execution + the path-guard. A tool call is gated FIRST
          // (permission mode); a denied call is never executed — the brain gets a
          // synthetic refusal result so the loop continues without running it.
          const approved = gate ? await gate({ name: ev.name, args: ev.args }) : true;
          const result: ToolResult = approved
            ? exec.execute(ev.name, ev.args)
            : { output: `[denied: ${ev.name} not approved by user]`, exitCode: 1 };
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
