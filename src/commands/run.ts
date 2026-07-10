// `aether run <agent> <task>` — stream an orchestrator (neo|kronus) multi-step
// run. Same transport as chat; the universal stream emits agent_step/tool_call
// frames which the renderer surfaces.

import type { AppContext } from "../core/context.js";
import { ChatTurnError, runTurn } from "./chat.js";

export async function cmdRun(
  ctx: AppContext,
  agent: string,
  task: string,
): Promise<number> {
  if (!agent) {
    process.stderr.write("usage: aether run <neo|kronus> <task>\n");
    return 2;
  }
  if (!task.trim()) {
    process.stderr.write("usage: aether run <neo|kronus> <task>\n");
    return 2;
  }
  ctx.flags.agent = agent;
  try {
    await runTurn(ctx, task);
    return 0;
  } catch (err) {
    // ChatTurnError: the Renderer already painted "✗ <msg>" for the streamed
    // error frame; printing it again here would double it (see chat.ts).
    if (!(err instanceof ChatTurnError)) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\n✗ ${msg}\n`);
    }
    return 1;
  }
}
