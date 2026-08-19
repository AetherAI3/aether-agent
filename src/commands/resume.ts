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

/** Load by id, or the newest session in this workspace when no id is given. */
function pick(ctx: AppContext, id: string): LoadedSession | null {
  return id ? loadSession(id, logsRoot(), ctx.flags.cwd) : latestSession(ctx.flags.cwd);
}

function noSessions(): number {
  process.stderr.write('no sessions to resume (run `aether agent "<task>"` first)\n');
  return 1;
}

/** `aether resume export [id] [--out <file>]`. */
function cmdResumeExport(ctx: AppContext, id: string, out: string | undefined): number {
  let s: LoadedSession | null;
  try {
    s = pick(ctx, id);
  } catch (err) {
    process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
    return 1;
  }
  if (!s) return noSessions();
  const target = out?.trim() ? out.trim() : join(ctx.flags.cwd, DEFAULT_HANDOFF_FILE);
  const handoff = buildHandoff(s, { repo: readRepoIdentity(ctx.flags.cwd, defaultRunner()) });
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

export async function cmdResume(ctx: AppContext, id: string, out?: string): Promise<number> {
  if (id === "export") return cmdResumeExport(ctx, "", out);
  if (id.startsWith("export ")) return cmdResumeExport(ctx, id.slice("export ".length).trim(), out);
  let s;
  try {
    s = pick(ctx, id);
  } catch (err) {
    process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
    return 1;
  }
  if (!s) return noSessions();
  process.stdout.write(theme.dim(`▸ ${s.manifest.sessionId} · ${s.manifest.task}\n\n`));
  for (const line of replayLines(s.events)) process.stdout.write(line + "\n");
  process.stdout.write(
    "\n" +
      theme.dim(`status: ${s.manifest.finalStatus ?? "running"} · continue with: `) +
      `aether agent --resume ${s.manifest.sessionId}\n` +
      theme.dim("  moving machines? ") +
      `aether resume export ${s.manifest.sessionId}\n`,
  );
  return 0;
}

