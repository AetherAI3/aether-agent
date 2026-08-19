// `aether agent [--local] "<task>"` — the hybrid coding terminal. One host loop
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
import { SessionLog, logsRoot } from "../core/session_log.js";
import { finalVerify, type BrainDone } from "../core/verify_gate.js";
import { StatusRenderer } from "../ui/status_renderer.js";
import { AnimationController } from "../ui/animations.js";
import { HeartbeatIndicator } from "../ui/heartbeat.js";
import { LocalAgentSource, bindEventSource } from "../core/agent_events.js";
import { phaseVerb } from "../ui/phase_verb.js";
import { TaskLedger } from "../ui/ledger.js";
import {
  CODE_STAGES,
  answerAgentQuestionIfPresent,
  applyToLedger,
  prepareWorkspace,
  runSummary,
  stageGate,
  writeDiffLines,
} from "./code_support.js";
import { loadSession, replayLines } from "../core/session_resume.js";
import { resumeHint } from "./resume.js";
import { createWorktree, mergeHint, type Worktree } from "../core/worktree.js";
import { parseRepoSpec, ensureLocalClone, prCreateHint, type RepoSpec } from "../core/repo.js";
import { chooseBackend } from "../core/backend.js";
import { decideGate } from "../core/autonomy.js";

export { prepareWorkspace } from "./code_support.js";

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

/** Replay a prior local session's transcript into the active surface. Fail-soft:
 * a missing/unreadable session prints a note and does not abort the new run. */
function replaySession(id: string, cwd: string, emit: (line: string) => void): void {
  try {
    const prior = loadSession(id, logsRoot(), cwd);
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
  // One interaction channel for the whole run: the repo gate, friendly stage
  // pauses, and agent questions all speak through it (stderr-backed, so piped
  // stdout stays clean; auto-answers in non-TTY / --yes).
  const io = stdioPrompt();

  // Two ways to land in an isolated worktree, kept as ONE sequence (not two
  // parallel systems) so a run never tries to cut a worktree twice:
  //
  //  - explicit (--repo / --worktree): the user opted in by hand, so honor it
  //    exactly — --repo clones the GitHub repo first (their own gh/git auth,
  //    never a backend token) and implies --worktree so the run lands on an
  //    isolated branch ready for a PR.
  //  - implicit (the 2.0 repo gate): with no explicit flag, confirm "are you
  //    working in this repo?" before any brain touches the tree; when `gh` is
  //    authenticated it auto-upgrades to the same kind of isolated worktree.
  //    A non-TTY run without --yes proceeds in place with zero prompts/side
  //    effects, so pipes, CI, and tests never hang.
  let repoSpec: RepoSpec | null = null;
  let worktree: Worktree | null = null;
  let cwd: string;
  if (opts.repo || opts.worktree) {
    let repoRoot = ctx.flags.cwd;
    if (opts.repo) {
      try {
        repoSpec = parseRepoSpec(opts.repo);
        const co = ensureLocalClone(repoSpec);
        repoRoot = co.dir;
        // Say what actually happened to the mirror. "reusing local clone" was
        // equally true of a mirror last fetched a week ago, which is exactly the
        // case a user needs told rather than hidden behind a reassuring word.
        const tip = co.freshness.remoteTip ? ` @ ${co.freshness.remoteTip.slice(0, 7)}` : "";
        const how = co.cloned
          ? "(cloned)"
          : co.freshness.state === "fresh"
            ? "(fetched)"
            : `(NOT REFRESHED — ${co.freshness.reason ?? "reason unknown"})`;
        process.stderr.write(`⎇ repo ${repoSpec.full} ${how}${tip}\n  ${co.dir}\n`);
        if (co.freshness.state !== "fresh") {
          process.stderr.write(
            "  ! this worktree will branch off whatever the mirror already had;\n" +
              "    its base is not known to match the remote.\n",
          );
        }
      } catch (err) {
        process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    try {
      worktree = createWorktree(repoRoot, task);
      process.stderr.write(`⌥ worktree ${worktree.branch}\n  ${worktree.dir}\n`);
    } catch (err) {
      process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
    cwd = worktree.dir;
  } else {
    const ws = await prepareWorkspace(ctx, task, io, defaultRunner());
    if (!ws.proceed) return 0;
    cwd = ws.cwd;
  }
  const poolGb = opts.pool > 0 ? opts.pool : 5;
  // --local forces the local brain. Otherwise honor the backend preference
  // (AETHER_BACKEND env > config.backend > 'auto'); 'auto' is local-first, so an
  // unauthed user gets the local brain and a signed-in user keeps the cloud default.
  let goLocal = opts.local;
  if (!opts.local) {
    const pref = (process.env["AETHER_BACKEND"] || ctx.cfg.backend || "auto").trim();
    const authed = Boolean(await ctx.tokens.get());
    goLocal = chooseBackend(pref, authed) === "local";
  }
  const brainKind: "local" | "cloud" = goLocal ? "local" : "cloud";

  const brain: Brain = goLocal ? new LocalBrain() : new CloudBrain(ctx.api);
  const exec = new ToolExecutor(cwd, opts.testCmd);
  // Scope the session manifest to the ORIGINAL launch directory (ctx.flags.cwd),
  // not the possibly-substituted `cwd` (an auto-created worktree, or a manually
  // redirected directory from the repo gate) — resume always compares against
  // ctx.flags.cwd of the *next* invocation (resume.ts, latestSession), which is
  // where the user is standing, not where this run ended up executing.
  const log = opts.noLog
    ? null
    : new SessionLog(
        { task, model: ctx.flags.model ?? "", poolGb, brain: brainKind, cwd: ctx.flags.cwd },
        nowIso(),
      );

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
    // --effort wins; otherwise the /effort dial saved in the Aether config
    // (same backend: TaskCommand.effort reaches the cloud brain unchanged).
    effort: opts.effort ?? (ctx.cfg.defaultEffort || undefined),
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

  // Multi-task ledger over the reasoning pipeline — drives the pinned n/7 counter
  // (animated) and the end-of-run checklist recap (✓ down the pipeline, ✗ where
  // it broke) on both paths. Seeded with the fixed stages so progress is forward
  // looking from the first frame.
  const ledger = new TaskLedger(CODE_STAGES);
  const cols = process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
  // Blast radius for the end-of-run summary: every file the brain wrote.
  const touched = new Set<string>();
  const trackWrites = (ev: BrainEvent): void => {
    if (ev.type === "tool_call" && ev.name === "write_file" && typeof ev.args["path"] === "string") {
      touched.add(ev.args["path"] as string);
    }
  };

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
    if (opts.resume) replaySession(opts.resume, ctx.flags.cwd, (line) => sr.log(line));
    const anim = new AnimationController({
      onFrame: (_stage, art) => sr.setAnim(art),
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
    let tick = 0;
    onEvent = async (ev: BrainEvent): Promise<void> => {
      if (ev.type === "memory") {
        log?.event(ev, nowIso());
        sr.memoryEvent(ev);
        return;
      }
      log?.event(ev, nowIso());
      applyEventToStatus(sr, ev, tick++);
      applyToLedger(ledger, ev);
      trackWrites(ev);
      captureDone(ev);
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
    if (opts.resume) replaySession(opts.resume, ctx.flags.cwd, (line) => process.stdout.write(line + "\n"));
    onEvent = async (ev: BrainEvent): Promise<void> => {
      applyToLedger(ledger, ev);
      trackWrites(ev);
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
      captureDone(ev);
      if (interactive && ev.type === "stage") await stageGate(brain, io, ev.name);
      if (interactive && ev.type === "monologue") await answerAgentQuestionIfPresent(brain, io, ev.text);
    };
  }

  const startedAt = Date.now();
  let code: number;
  try {
    code = await hostLoop(brain, exec, onEvent, taskCmd, onToolResult, gate);
  } finally {
    // A brain that throws mid-run must still clear the pinned status line and
    // print the ledger recap — otherwise stale animation sits over the error.
    teardown();
  }

  // ── Final verification gate: ground truth, never the brain's self-report ──
  // The host re-runs the test command ITSELF and derives finalStatus from the real
  // exit code (verify_gate.ts). The brain's `done` is advisory — it only enriches a
  // red result with its breaker reason and can never upgrade a red run to "ok".
  const { status: finalStatus, remaining, exitCode: verifyExit } = finalVerify(exec, opts.testCmd, lastDone, sawError);
  log?.close(finalStatus, nowIso(), remaining);
  // The verdict line — printed even with --no-log (which used to end with
  // NOTHING); suppressed under --json (frames already carry the data). Surfaces
  // the failing-test count the verify gate already computed but used to bury
  // in the log file only. runSummary only distinguishes ok/incomplete/unverified
  // (a breaker reason like "stalled" still reads as "incomplete" to the user —
  // the run didn't finish green either way), so collapse the wider FinalStatus.
  if (!ctx.flags.json) {
    const secs = (Date.now() - startedAt) / 1000;
    const summaryStatus = finalStatus === "ok" || finalStatus === "unverified" ? finalStatus : "incomplete";
    process.stderr.write("\n  " + runSummary(summaryStatus, remaining, touched.size, secs) + "\n");
  }
  if (log) process.stderr.write(`  ⤷ log: ${log.dir}\n`);
  if (worktree) process.stderr.write(mergeHint(worktree));
  if (repoSpec && worktree) process.stderr.write(prCreateHint(repoSpec, worktree.branch));
  // Process exit follows the HOST: 0 only on a verified-green run. With no gate
  // ("unverified") there is no ground truth, so the loop's own code stands.
  // Any other status (incomplete, a breaker reason, or a brain crash) always
  // fails the process even if the loop's own code was 0 — a green exit code
  // must never paper over red tests.
  if (finalStatus === "ok") return 0;
  if (finalStatus === "unverified") return code;
  return verifyExit !== 0 ? verifyExit : 1;
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
          // executeAsync delegates the 6 sync tools to execute() unchanged and
          // awaits the 2 async web tools (web_search/web_fetch) so they run on
          // this path too — otherwise execute() returns "[tool … is async]".
          const approved = gate ? await gate({ name: ev.name, args: ev.args }) : true;
          const result: ToolResult = approved
            ? await exec.executeAsync(ev.name, ev.args)
            : { output: `[denied: ${ev.name} not approved by user]`, exitCode: 1 };
          onToolResult?.(ev.id, result);
          brain.sendToolResult(ev.id, result);
          break;
        }
        case "done":
          // A prior error event keeps its exit code — a later done ok:true
          // must never launder a failed run back to success.
          if (!ev.ok) code = 1;
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
