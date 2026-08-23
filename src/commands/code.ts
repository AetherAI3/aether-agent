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
import { OllamaBrain } from "../core/brain_ollama.js";
import { resolveHostedModel, resolveLocalModelSelection } from "../core/local_ollama.js";
import { CloudBrain } from "../core/brain_cloud.js";
import { ToolExecutor } from "../core/tool_executor.js";
import { stdioPrompt } from "../ui/interact.js";
import { defaultRunner } from "../core/worktree.js";
import { isCurrentWorkspace } from "../core/workspace_scope.js";
import { HostRenderer, routingDriftLines } from "../ui/host_render.js";
import { SessionLog } from "../core/session_log.js";
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
import { continuationTask, resolveResume, resumeReplayLines, wroteFile, type ResolvedResume } from "../core/handoff.js";
import { resumeHint } from "./resume.js";
import { createWorktree, mergeHint, type Worktree } from "../core/worktree.js";
import { parseRepoSpec, ensureLocalClone, type RepoSpec } from "../core/repo.js";
import { chooseBackend, chooseLocalBrain } from "../core/backend.js";
import { decideGate } from "../core/autonomy.js";
import { openRunSession, refusalToolResult } from "../core/skills/run_session.js";
import type { SessionContext } from "../core/session_resume.js";
import type { SkillSessionProvenance } from "../core/skills/skill_session.js";
import type { SkillRefusal } from "../core/skills/skill_errors.js";

export { prepareWorkspace } from "./code_support.js";

/**
 * Exit code 3 — ROUTING REFUSED.
 *
 * The run asked for a transport with LOCAL authority and the server would not
 * give it (agent dev sessions disabled / route absent), so the host refused to
 * continue on a transport that executes tools somewhere else.
 *
 * Distinct from the existing table (COMMANDS.md "Exit codes"): 0 success, 1
 * runtime error, 2 usage error — and 130/143 are the signal conventions the UI
 * already uses. A refusal is neither a crash nor a mistyped argument: a script
 * that sees 3 knows nothing ran and that retrying without an operator change
 * will produce the same answer.
 */
export const EXIT_ROUTING_REFUSED = 3;

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
  /** Continue a prior session: a local session id, or the path to a handoff
   *  file exported from another machine. The prior context is summarized into
   *  the brief the brain reads (core/handoff.ts), not just replayed on screen. */
  resume?: string;
  /** Isolate the run in a fresh git worktree on an auto-named branch. */
  worktree?: boolean;
  /** Work on a GitHub repo (owner/name): clone via gh/git, then worktree it. */
  repo?: string;
  /** `--skill <id>`: load this skill explicitly (id, short name, or command alias). */
  skill?: string;
  /** `--no-skills`: load no skill. The project's own AGENTS.md still applies. */
  noSkills?: boolean;
}

const nowIso = (): string => new Date().toISOString();

/** Resolve the hosted model once for both the wire command and durable provenance. */
export function resolveHostedSessionModel(explicit: string | undefined, configured: string): string {
  return resolveHostedModel(explicit, configured);
}

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

export async function cmdCode(ctx: AppContext, task: string, opts: CodeOpts): Promise<number> {
  // --resume carries the prior session's context forward, so it is also a task
  // of its own: with no new instruction the run continues the ORIGINAL task.
  // Resolved ONCE — the handoff the brain reads and the lines the human sees
  // come from the same read, so a session log is never parsed twice and the
  // file-vs-id decision is made in exactly one place.
  let resumed: ResolvedResume | null = null;
  if (opts.resume) {
    try {
      resumed = resolveResume(opts.resume, ctx.flags.cwd);
    } catch (err) {
      process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }
  const handoff = resumed?.handoff ?? null;
  const replay = (emit: (line: string) => void): void => {
    if (!resumed || !opts.resume) return;
    for (const line of resumeReplayLines(resumed, opts.resume)) emit(line);
  };
  if (!task.trim() && !handoff) {
    process.stderr.write('✗ nothing to do — try: aether agent "fix the failing tests"\n');
    return 1;
  }
  // What the run is CALLED (worktree branch, session manifest, summary) stays
  // the human-sized instruction; the brief below is what the brain reads.
  const label = task.trim() || handoff!.task;
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
  // The exact revision a --repo worktree must start from. Null for a plain
  // --worktree run, where the user's own checkout is the intended base.
  let repoBase: string | null = null;
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
        // Refuse rather than branch off a base nobody can name. git fetch moves
        // remote refs, not the mirror's HEAD, so without a known tip the run
        // would silently start from whatever was on disk while having just
        // printed a reassuring fetch line.
        if (co.freshness.state !== "fresh" || !co.freshness.remoteTip) {
          process.stderr.write(
            `✗ refusing to start: the base for ${repoSpec.full} is not known to match the remote.\n` +
              `  ${co.freshness.reason ?? "no revision was resolved"}\n` +
              "  a worktree cut now would branch off whatever the mirror already had.\n" +
              "  reconnect and retry, or work in a local checkout you control.\n",
          );
          return 1;
        }
        repoBase = co.freshness.remoteTip;
      } catch (err) {
        process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    try {
      // Pin the worktree to the revision the mirror actually fetched. git fetch
      // moves remote refs, not the mirror's HEAD, so an unpinned `worktree add`
      // branches off a base that can be well behind the tip just reported.
      worktree = createWorktree(repoRoot, label, undefined, repoBase ?? undefined);
      process.stderr.write(`⌥ worktree ${worktree.branch}\n  ${worktree.dir}\n`);
    } catch (err) {
      process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
    cwd = worktree.dir;
  } else {
    const ws = await prepareWorkspace(ctx, label, io, defaultRunner());
    if (!ws.proceed) return 0;
    cwd = ws.cwd;
  }

  // ── Rules and skills enter the run here ─────────────────────────────────
  // Opened against `cwd` — the tree the run actually works in, which is the
  // worktree when there is one, not the directory the user typed the command
  // in. A run must be governed by the AGENTS.md of the code it is editing.
  //
  // This is the ONE seam: the brief composed below is what the cloud
  // dev-session POSTs as `task` and what the local Ollama brain puts in its
  // chat messages, byte for byte, and the policy printed in the header is the
  // policy hostLoop enforces a moment later. A refusal here ends the run — a
  // named skill that cannot be trusted or loaded never degrades into a quiet
  // skill-free run that looks like it worked.
  const opened = openRunSession({
    projectRoot: cwd,
    prompt: task || label,
    ...(opts.skill ? { explicitSkill: opts.skill } : {}),
    ...(opts.noSkills ? { noSkills: true } : {}),
  });
  if (!opened.ok) {
    for (const line of opened.lines) process.stderr.write(line + "\n");
    return 2;
  }
  const run = opened.run;
  for (const line of run.headerLines) process.stderr.write("  " + line + "\n");

  // ── Resuming under the same rules it started under ───────────────────────
  // A session id names a conversation. It does not name the instructions that
  // conversation was conducted under, and those live in files anyone can edit
  // between two runs. Continuing under the old session identity while the rules
  // underneath have changed is the quiet failure this check exists to prevent.
  //
  // A changed SKILL digest refuses: the user named that skill once, its body is
  // executable guidance, and a different body under the same id and version is
  // not the thing they approved. A changed instruction graph is ANNOUNCED but
  // does not refuse — editing AGENTS.md between runs is ordinary work, and
  // refusing it would make resume unusable — but it is never silent.
  if (handoff?.context) {
    const drift = contextDrift(handoff.context, run.session.provenance);
    for (const line of drift.announcements) process.stderr.write("  " + line + "\n");
    if (drift.refusals.length) {
      process.stderr.write("\n✗ refusing to resume " + handoff.sessionId + " under different skills:\n");
      for (const line of drift.refusals) process.stderr.write("  " + line + "\n");
      process.stderr.write(
        "  review what changed, then start a new session, or re-run with --no-skills to continue\n" +
          "  under the project's rules alone.\n",
      );
      return 2;
    }
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
  const localSelection = goLocal
    ? resolveLocalModelSelection(ctx.flags.model, ctx.cfg.localModel ?? "", { allowBareExplicit: opts.local })
    : null;
  const resolvedHostedModel = goLocal ? "" : resolveHostedSessionModel(ctx.flags.model, ctx.cfg.defaultModel);
  // Provenance uses a namespace; the Ollama wire protocol receives only the
  // tag. That makes a handoff unambiguous without changing Ollama's API.
  const resolvedModel = localSelection?.id ?? resolvedHostedModel;

  // The offline path drives the SAME Ollama brain the REPL's `--local` turns
  // already use (commands/chat.ts runLocalTurn) — pure TypeScript, shipped in
  // the npm package, no extra runtime. The headless Python brain is a separate
  // install, so it is opt-in through AETHER_LOCAL_BRAIN=python; before this the
  // one-shot form spawned it unconditionally and a plain npm install could only
  // ever answer `spawn python ENOENT`.
  const brain: Brain = goLocal
    ? chooseLocalBrain(process.env["AETHER_LOCAL_BRAIN"]) === "python"
      ? new LocalBrain()
      : new OllamaBrain()
    : // `aether agent` is a coding session over THIS checkout, so it may not
      // silently accept the one-way chat transport, whose tools run
      // server-side against the cloud vault (brain_cloud CloudBrainOptions).
      new CloudBrain(ctx.api, undefined, { requireLocalAuthority: true });
  const exec = new ToolExecutor(cwd, opts.testCmd);
  // Scope the session manifest to the ORIGINAL launch directory (ctx.flags.cwd),
  // not the possibly-substituted `cwd` (an auto-created worktree, or a manually
  // redirected directory from the repo gate) — resume always compares against
  // ctx.flags.cwd of the *next* invocation (resume.ts, latestSession), which is
  // where the user is standing, not where this run ended up executing.
  const log = opts.noLog
    ? null
    : new SessionLog(
        {
          task: label,
          model: resolvedModel,
          poolGb,
          brain: brainKind,
          cwd: ctx.flags.cwd,
          // Where the run actually executed, when that is not where it was
          // launched from (an auto-created worktree, or a redirect from the
          // repo gate). Recorded so the library can say which checkout the work
          // is in, and so the branch it reports is the branch the commits
          // landed on rather than the launch directory's. (Lane AA-CONT-04.)
          ...(cwd && ctx.flags.cwd && !isCurrentWorkspace(cwd, ctx.flags.cwd) ? { worktree: cwd } : {}),
          ...(opts.testCmd ? { testCmd: opts.testCmd } : {}),
          // Digests and paths, never content: enough for the next run (or the
          // next machine) to tell that the rules moved, and nothing more.
          context: {
            skills: run.session.provenance.skills.map((skill) => ({
              id: skill.id,
              version: skill.version,
              digest: skill.digest,
              invocation: skill.invocation,
              trust: skill.trust,
              lock: skill.lock,
            })),
            instructionSources: [...run.session.provenance.instructionSources],
            instructionGraphDigest: run.session.provenance.instructionGraphDigest,
            conflicts: [...run.session.provenance.conflicts],
          },
        },
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
    // On a resume the brain reads the prior session's continuation brief FIRST,
    // then the new instruction — that, and not the on-screen replay, is what
    // lets a different model (or a different machine) pick the thread up.
    //
    // run.brief() wraps that with the project's rules, the loaded skill bodies,
    // and the effective host policy. With no rules and no skills it returns the
    // task unchanged, so an unskilled run is byte-identical to one without this
    // seam at all.
    text: run.brief(handoff ? continuationTask(handoff, task) : task),
    // The typed channel, for a brain that reads the NDJSON command frame.
    // Additive and optional (brain_protocol.AgentContextPacket): a brain that
    // predates it sees no key. The brief above is what reaches the Ollama and
    // cloud brains, which never touch encodeCommand.
    ...(run.contextPacket ? { context: run.contextPacket } : {}),
    cwd,
    poolGb,
    // --effort wins; otherwise the /effort dial saved in the Aether config
    // (same backend: TaskCommand.effort reaches the cloud brain unchanged).
    effort: opts.effort ?? (ctx.cfg.defaultEffort || undefined),
    model: localSelection?.tag ?? (resolvedHostedModel || undefined),
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
  // Same predicate a handoff uses for `filesTouched`, so the live blast radius
  // and the exported record can never disagree about what "wrote a file" means.
  const trackWrites = (ev: BrainEvent): void => {
    const written = wroteFile(ev);
    if (written) touched.add(written);
  };

  let onEvent: (ev: BrainEvent) => void | Promise<void>;
  let teardown = (): void => {};

  // Capture the brain's terminal event — advisory input to the host verify gate.
  // `done` (the brain finished its loop): its breaker reason enriches a red result
  // but never upgrades a red run to "ok". `error` (the brain CRASHED mid-run): the
  // run is untrustworthy, so a coincidentally-green tree is reported "error", not "ok".
  let lastDone: BrainDone | null = null;
  let sawError = false;
  // A refused transport downgrade (brain_cloud). Captured on BOTH presentation
  // paths so the process exit code cannot depend on whether a TTY was attached.
  let fatalDrift: Extract<BrainEvent, { type: "routing_drift" }> | null = null;
  const captureDone = (ev: BrainEvent): void => {
    if (ev.type === "done") lastDone = { ok: ev.ok, remaining: ev.remaining, reason: ev.reason };
    else if (ev.type === "error") sawError = true;
    else if (ev.type === "routing_drift" && ev.fatal) fatalDrift = ev;
  };

  if (animated) {
    const sr = new StatusRenderer({ mode: brainKind === "local" ? "local" : "api" });
    sr.start();
    replay((line) => sr.log(line));
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
      if (ev.type === "routing_drift") {
        // The animated path never touches HostRenderer, so without this the
        // drift banner would exist only for piped runs — invisible to exactly
        // the user sitting at the terminal it was written for.
        log?.event(ev, nowIso());
        captureDone(ev);
        for (const line of routingDriftLines(ev)) sr.log(line);
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
    replay((line) => process.stdout.write(line + "\n"));
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
    code = await hostLoop(brain, exec, onEvent, taskCmd, onToolResult, gate, run.guard);
  } finally {
    // A brain that throws mid-run must still clear the pinned status line and
    // print the ledger recap — otherwise stale animation sits over the error.
    teardown();
  }

  // ── Routing refused: nothing ran, so there is nothing to verify ──────────
  // Returning BEFORE finalVerify is the point: the gate would run the project's
  // test command and report on a tree no brain ever touched, dressing a refusal
  // up as a red (or, on a green tree, a passing) run.
  if (fatalDrift) {
    // No second copy of the remediation: the ROUTING_DRIFT banner already
    // carried it (host_render.routingDriftLines prints it on a fatal drift),
    // on this path and on the animated one alike.
    log?.close("incomplete", nowIso(), 0);
    if (log) process.stderr.write(`  ⤷ log: ${log.dir}\n`);
    return EXIT_ROUTING_REFUSED;
  }

  // ── Final verification gate: ground truth, never the brain's self-report ──
  // The host re-runs the test command ITSELF and derives finalStatus from the real
  // exit code (verify_gate.ts). The brain's `done` is advisory — it only enriches a
  // red result with its breaker reason and can never upgrade a red run to "ok".
  const { status: finalStatus, remaining, exitCode: verifyExit } = await finalVerify(
    exec,
    opts.testCmd,
    lastDone,
    sawError,
  );
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
  if (repoSpec && worktree) {
    // This used to be `process.stderr.write(prCreateHint(...))` — a printed gh
    // incantation the user had to retype, and the reason nothing in this
    // repository ever exercised PR creation. It is an offer now: on a terminal
    // it asks, and on a yes it runs the same rail `aether ship` runs (publish
    // the head branch, then open the pull request behind a confirmation screen
    // that shows every argv element in full). A pipe/CI run still gets a line
    // it can act on, but the command it names now exists.
    const { offerShip } = await import("./ship.js");
    await offerShip(ctx, process.stderr, repoSpec, worktree.dir, worktree.branch);
  }
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
 * Compare the rules and skills a prior session ran under against the ones this
 * run just resolved. Exported for tests: the comparison is the whole point, so
 * it must be assertable without cutting a worktree and driving a brain.
 *
 * A skill present THEN and absent NOW is reported, not refused — the user may
 * simply not have named it this time, and the run is narrower, never wider.
 */
export function contextDrift(
  before: SessionContext,
  now: SkillSessionProvenance,
): { refusals: string[]; announcements: string[] } {
  const refusals: string[] = [];
  const announcements: string[] = [];
  const current = new Map(now.skills.map((skill) => [skill.id, skill]));
  for (const prior of before.skills) {
    const live = current.get(prior.id);
    if (!live) {
      announcements.push("Note    " + prior.id + " ran in the prior session and is not loaded now");
      continue;
    }
    if (live.digest !== prior.digest) {
      refusals.push(
        prior.id +
          " changed since the prior session (" +
          prior.digest.slice(0, 19) +
          " then, " +
          live.digest.slice(0, 19) +
          " now)",
      );
      continue;
    }
    if (live.trust !== prior.trust) {
      refusals.push(prior.id + " trust changed: " + prior.trust + " then, " + live.trust + " now");
    }
  }
  if (
    before.instructionGraphDigest &&
    now.instructionGraphDigest &&
    before.instructionGraphDigest !== now.instructionGraphDigest
  ) {
    announcements.push(
      "Note    the project's rules changed since the prior session - this run uses the CURRENT ones",
    );
    const priorSources = new Set(before.instructionSources);
    const added = now.instructionSources.filter((path) => !priorSources.has(path));
    const removed = before.instructionSources.filter((path) => !now.instructionSources.includes(path));
    if (added.length) announcements.push("Note    now in force: " + added.join(", "));
    if (removed.length) announcements.push("Note    no longer in force: " + removed.join(", "));
  }
  return { refusals, announcements };
}

/**
 * The host loop — the bridge seam, extracted so it is unit-testable with a fake/**
 * The host loop — the bridge seam, extracted so it is unit-testable with a fake
 * brain. The brain decides (emits events); the host renders each event and
 * executes each tool_call locally, replying with the result. Returns the process
 * exit code (0 = the run finished green). Always tears the brain down.
 *
 * `skillGuard` is where a loaded skill's narrowing becomes real. It runs BEFORE
 * the operator permission gate, never instead of it: the skill subtracts from
 * the tool surface, then the operator gate decides about what is left. That
 * ordering is the whole never-widen invariant — there is no path by which a
 * manifest can add a tool, add a permission, or skip a confirmation, because
 * nothing a manifest says is ever consulted after this point.
 */
export async function hostLoop(
  brain: Brain,
  exec: ToolExecutor,
  onEvent: (ev: BrainEvent) => void | Promise<void>,
  task: TaskCommand,
  onToolResult?: (id: string, result: ToolResult) => void,
  gate?: ToolGate,
  skillGuard?: (tool: string) => SkillRefusal | null,
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
          // Skill policy first. A tool no active skill declares — or one whose
          // permission a skill forbids, or one outside the operator envelope —
          // is refused HERE, before the user is ever asked to approve it and
          // before a byte of it runs. The brain gets a structured refusal as a
          // normal failed tool result, so the loop continues and the model
          // learns why instead of silently retrying.
          const refusal = skillGuard ? skillGuard(ev.name) : null;
          if (refusal) {
            const denied: ToolResult = refusalToolResult(refusal);
            onToolResult?.(ev.id, denied);
            brain.sendToolResult(ev.id, denied);
            break;
          }
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
