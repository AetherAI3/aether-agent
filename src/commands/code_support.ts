// Support helpers for `aether code`: workspace preparation and host-side UI glue.
// Keeping these out of code.ts lets the command file stay focused on orchestration.

import { resolve } from "node:path";
import type { AppContext } from "../core/context.js";
import type { Brain } from "../core/brain.js";
import type { BrainEvent } from "../core/brain_protocol.js";
import { ToolExecutor } from "../core/tool_executor.js";
import { confirm, ask, parseAgentQuestion, type PromptIO } from "../ui/interact.js";
import {
  ghAuthStatus,
  isGitRepo,
  repoRoot,
  slugify,
  createWorktree,
  linkGhAccount,
  type Runner,
} from "../core/worktree.js";
import { renderDiff } from "../ui/diff.js";
import { kaomoji } from "../ui/kaomoji.js";
import { theme } from "../ui/theme.js";
import { TaskLedger } from "../ui/ledger.js";

// The engine's fixed reasoning pipeline - seeded into the task ledger so the run
// shows broad multi-step progress (n/7) instead of one opaque task.
export const CODE_STAGES = ["recon", "parse", "brainstorm", "write-plans", "execute", "self-review", "reveal"];

export function applyToLedger(ledger: TaskLedger, ev: BrainEvent): void {
  if (ev.type === "stage") ledger.setActive(ev.name);
  else if (ev.type === "done") {
    if (ev.ok) ledger.finishAll();
  } else if (ev.type === "error") ledger.failActive();
}

export function writeDiffLines(exec: ToolExecutor, args: Record<string, unknown>, withFace: boolean): string[] {
  const path = String(args["path"] ?? "");
  if (!path) return [];
  const content = String(args["content"] ?? "");
  const snap = exec.snapshot(path);
  const cols = process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
  const face = withFace ? kaomoji("logging") : undefined;

  if (snap.existed && snap.text === null) {
    const what = snap.reason === "binary" ? "binary" : "large file";
    const bytes = Buffer.byteLength(content);
    const faceStr = face ? "  " + theme.dim(face) : "";
    return [
      `  ${theme.cyan("✎")} ${theme.bold(path)}${faceStr}  ${theme.yellow(`(${what}, wrote ${bytes} b)`)}`,
    ];
  }

  return renderDiff(path, snap.text ?? "", content, { cols, isNew: !snap.existed, kaomoji: face });
}

export async function stageGate(brain: Brain, io: PromptIO, stage: string): Promise<void> {
  const note = (
    await io.question(`\n⏸ ${kaomoji("active")}  ${stage} — [enter] to continue · type a steer: `)
  ).trim();
  if (note) brain.control("steer", note);
}

export async function answerAgentQuestionIfPresent(brain: Brain, io: PromptIO, text: string): Promise<void> {
  const question = parseAgentQuestion(text);
  if (!question) return;
  io.note(`\n${kaomoji("idle")}  the agent has a question:\n  ${question}`);
  const answer = await ask(io, "  your answer (blank to let it decide):");
  if (answer) brain.control("steer", answer);
}

/**
 * 2.0 repo gate + gh-gated worktree. Confirms the target repo before any brain
 * starts. With an authenticated `gh`, a git repo runs in an isolated worktree;
 * otherwise this degrades to confirm-only and runs in place.
 */
export async function prepareWorkspace(
  ctx: AppContext,
  task: string,
  io: PromptIO,
  run: Runner,
): Promise<{ cwd: string; proceed: boolean }> {
  const autoYes = ctx.flags.yes;
  let cwd = resolve(ctx.flags.cwd || ".");

  // Pipe / CI / test: cannot ask + must take no side effects - run in place.
  if (!io.tty && !autoYes) return { cwd, proceed: true };

  let root = repoRoot(run, cwd) ?? cwd;

  // The gate. Exact wording is mirrored in predator-cli - keep it identical.
  const here = await confirm(io, `Are you working in this repo?\n  ${root}`, { default: true, autoYes });
  if (!here) {
    const alt = await ask(io, "No problem — which directory should I work in? (blank to cancel)", { autoYes });
    if (!alt) {
      io.note("Okay, standing down — nothing was changed.");
      return { cwd, proceed: false };
    }
    cwd = resolve(alt);
    root = repoRoot(run, cwd) ?? cwd;
    io.note(`Got it — working in ${root}.`);
  }

  const gh = ghAuthStatus(run);
  if (gh.authed) {
    if (gh.user) {
      linkGhAccount(gh.user, gh.host);
      io.note(`✓ GitHub ${gh.user} linked to this Aether session.`);
    }
    if (isGitRepo(run, root)) {
      io.note("Spinning up an isolated worktree so your branch stays untouched…");
      const wt = createWorktree(run, root, slugify(task));
      if (wt.ok && wt.path) {
        io.note(`⟢ ${wt.branch} ready  ·  ${wt.path}`);
        return { cwd: wt.path, proceed: true };
      }
      io.note(`(couldn't create a worktree: ${wt.error ?? "unknown"} — working in place)`);
    }
  } else {
    io.note("Heads up: gh isn't authenticated, so I'll work in place. Run `gh auth login` for an isolated worktree.");
  }
  return { cwd: root, proceed: true };
}