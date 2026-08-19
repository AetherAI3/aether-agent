// `aether resume [id]` — replay a prior local session's transcript and show how
// to continue it. With no id, resumes the most recent session.
//
// `aether resume export [id] [--out <file>]` writes the same session out as a
// portable handoff (core/handoff.ts): the file you copy to another machine so
// `aether agent --resume <file>` can carry the project context across.

import { join } from "node:path";
import type { AppContext } from "../core/context.js";
import { loadSession, latestSession, replayLines, type LoadedSession } from "../core/session_resume.js";
import { logsRoot } from "../core/session_log.js";
import { buildHandoff, readRepoIdentity, writeHandoff } from "../core/handoff.js";
import { defaultRunner } from "../core/worktree.js";
import { theme } from "../ui/theme.js";

/** The exact command a paused session can be re-entered with. */
export function resumeHint(sessionId: string): string {
  return `session paused — resume with:  aether agent --resume ${sessionId}`;
}

/** Default filename for `aether resume export` when --out is not given. */
export const DEFAULT_HANDOFF_FILE = "aether-handoff.json";

/** Load by id, or the newest session in this workspace when no id is given.
 *  Reports the failure itself and returns null, so both entry points share one
 *  error path instead of two copies that must be kept in step. */
function pick(ctx: AppContext, id: string): LoadedSession | null {
  let session: LoadedSession | null;
  try {
    session = id ? loadSession(id, logsRoot(), ctx.flags.cwd) : latestSession(ctx.flags.cwd);
  } catch (err) {
    process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
    return null;
  }
  if (!session) process.stderr.write('no sessions to resume (run `aether agent "<task>"` first)\n');
  return session;
}

/** `aether resume export [id] [--out <file>]`. */
export function cmdResumeExport(ctx: AppContext, id: string, out?: string): number {
  const session = pick(ctx, id);
  if (!session) return 1;
  const target = out?.trim() ? out.trim() : join(ctx.flags.cwd, DEFAULT_HANDOFF_FILE);
  const handoff = buildHandoff(session, { repo: readRepoIdentity(ctx.flags.cwd, defaultRunner()) });
  try {
    writeHandoff(target, handoff);
  } catch (err) {
    process.stderr.write(`✗ could not write ${target}: ${err instanceof Error ? err.message : err}\n`);
    return 1;
  }
  process.stdout.write(
    `${theme.cyan("⇄ handoff written")} ${theme.bold(target)}\n` +
      theme.dim(
        `  session ${handoff.sessionId} · ${handoff.finalStatus} · ` +
          `${handoff.filesTouched.length} file(s) · ${handoff.highlights.length} step(s)\n`,
      ) +
      theme.dim("  continue anywhere with:  ") +
      `aether agent --resume ${target} "<what to do next>"\n`,
  );
  return 0;
}

export function cmdResume(ctx: AppContext, id: string): number {
  const session = pick(ctx, id);
  if (!session) return 1;
  process.stdout.write(theme.dim(`▸ ${session.manifest.sessionId} · ${session.manifest.task}\n\n`));
  for (const line of replayLines(session.events)) process.stdout.write(line + "\n");
  process.stdout.write(
    "\n" +
      theme.dim(`status: ${session.manifest.finalStatus ?? "running"} · continue with: `) +
      `aether agent --resume ${session.manifest.sessionId}\n` +
      theme.dim("  moving machines? ") +
      `aether resume export ${session.manifest.sessionId}\n`,
  );
  return 0;
}
