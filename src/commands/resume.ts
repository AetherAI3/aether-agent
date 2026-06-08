// `aether resume [id]` — replay a prior local session's transcript and show how
// to continue it. With no id, resumes the most recent session.

import type { AppContext } from "../core/context.js";
import { loadSession, latestSession, replayLines } from "../core/session_resume.js";
import { theme } from "../ui/theme.js";

/** The exact command a paused session can be re-entered with. */
export function resumeHint(sessionId: string): string {
  return `session paused — resume with:  aether code --resume ${sessionId}`;
}

export async function cmdResume(_ctx: AppContext, id: string): Promise<number> {
  const s = id ? loadSession(id) : latestSession();
  if (!s) {
    process.stderr.write('no sessions to resume (run `aether code "<task>"` first)\n');
    return 1;
  }
  process.stdout.write(theme.dim(`▸ ${s.manifest.sessionId} · ${s.manifest.task}\n\n`));
  for (const line of replayLines(s.events)) process.stdout.write(line + "\n");
  process.stdout.write(
    "\n" +
      theme.dim(`status: ${s.manifest.finalStatus ?? "running"} · continue with: `) +
      `aether code --resume ${s.manifest.sessionId}\n`,
  );
  return 0;
}
