// `aether [prompt]` — one-shot if a prompt is given, else an interactive REPL.
// This is the coding front door: build an envelope, POST to the universal
// stream, decode frames, render. The agent brain runs on Aether's servers.

import { createInterface } from "node:readline";
import type { AppContext } from "../core/context.js";
import { buildChatRequest } from "../core/envelope.js";
import { CHAT_STREAM_PATH, CHAT_PATH } from "../core/transport.js";
import { decodeSse } from "../core/stream.js";
import { Renderer } from "../core/render.js";
import { StreamUnavailableError, errorHint, isAbortError } from "../core/errors.js";
import { appendCustody } from "../core/custody.js";
import { handleSlash } from "./slash.js";
import { userInfo } from "node:os";
import { join } from "node:path";
import { renderSplash } from "../ui/splash.js";
import { promptPrefix } from "../ui/prompt.js";
import { errTheme } from "../ui/theme.js";
import { KAOMOJI } from "../ui/kaomoji.js";
import { ThinkingPulse } from "../ui/thinking.js";
import { configDir } from "../core/config.js";
import { loadHistory, appendHistory } from "./history.js";
import { slashCompletions } from "./slash_registry.js";
import { VERSION } from "../version.js";

// the Aether API ChatResponse: { response, commitment_hash, verified, threat_level }.
interface ChatJsonResponse {
  response?: string;
  commitment_hash?: string;
}

/** Run a single coding turn end to end. Exported for `run.ts` (orchestrators).
 * `signal` cancels the turn client-side (stream AND the fail-soft fallback) —
 * orchestrator runs inherit cancelability through this same seam. */
export async function runTurn(ctx: AppContext, prompt: string, signal?: AbortSignal): Promise<void> {
  const req = buildChatRequest({
    prompt,
    model: ctx.flags.model ?? ctx.cfg.defaultModel,
    agent: ctx.flags.agent ?? "",
    // Only an explicit --model this invocation counts as a manual pick.
    manualModel: ctx.flags.model != null,
  });
  const renderer = new Renderer({ json: ctx.flags.json, audit: ctx.flags.audit });
  // Dead-air killer: pulse on stderr from submit until the first frame lands.
  const pulse = new ThinkingPulse({
    enabled:
      Boolean(process.stderr.isTTY) && !ctx.flags.json && process.env["AETHER_NO_ANIM"] !== "1",
  });
  pulse.start();
  try {
    const stream = await ctx.api.stream(CHAT_STREAM_PATH, req, signal);
    for await (const frame of decodeSse(stream)) {
      pulse.stop(); // first (and every) frame: real output owns the line now
      // The server signs each turn and returns it; persist the signed receipt
      // locally (best-effort, never breaks the chat).
      if (frame.type === "custody") appendCustody(frame.custody);
      renderer.frame(frame);
    }
  } catch (err) {
    if (err instanceof StreamUnavailableError) {
      // Contract fail-soft: fall back to the non-streaming request/response.
      // Same signal — the fallback leg is cancelable too (arena AT-3d).
      const r = await ctx.api.postJson<ChatJsonResponse>(CHAT_PATH, req, signal);
      pulse.stop();
      process.stdout.write((r.response ?? "") + "\n");
      if (ctx.flags.audit && r.commitment_hash) {
        process.stderr.write(`  signed ✓ ${r.commitment_hash}\n`);
      }
      return;
    }
    throw err;
  } finally {
    pulse.stop();
  }
}

export async function cmdChat(ctx: AppContext, prompt: string): Promise<number> {
  if (prompt.trim()) {
    try {
      await runTurn(ctx, prompt);
      return 0;
    } catch (err) {
      printError(err, ctx.cfg.baseUrl);
      return 1;
    }
  }
  return repl(ctx);
}

async function repl(ctx: AppContext): Promise<number> {
  const username = userInfo().username || "you";
  const p = promptPrefix(username);
  // Real terminal readline: up-arrow history (persisted across sessions),
  // tab-completion for slash commands, and an owned prompt. Non-TTY keeps
  // today's exact byte behavior (rl.prompt() writes the plain prompt string).
  const historyPath = join(configDir(), "history");
  const terminal = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal,
    prompt: p,
    historySize: 200,
    history: loadHistory(historyPath),
    removeHistoryDuplicates: true,
    completer: slashCompletions,
  });
  // In terminal mode readline owns Ctrl+C (no process SIGINT is raised).
  // Mid-turn: cancel the in-flight turn, keep the session. Idle: leave with
  // a goodbye at exit 130 (the status_renderer/tui cleanup convention).
  let inflight: AbortController | null = null;
  rl.on("SIGINT", () => {
    if (inflight) {
      inflight.abort();
      return;
    }
    process.stderr.write(`\n${KAOMOJI.idle}  bye\n`);
    rl.close();
    process.exit(130);
  });
  const model = ctx.flags.model ?? ctx.cfg.defaultModel ?? "auto";
  process.stdout.write(
    renderSplash({
      version: VERSION,
      model: model || "auto",
      effort: ctx.cfg.defaultEffort || "default",
    }) + "\n\n",
  );
  process.stdout.write("Type a prompt, or /help for commands. /exit to quit.\n\n");
  rl.prompt();
  for await (const line of rl) {
    const t = line.trim();
    if (!t) {
      rl.prompt();
      continue;
    }
    appendHistory(historyPath, t);
    if (t.startsWith("/")) {
      try {
        const res = await handleSlash(ctx, t, process.stdout);
        if (res.exit) break;
      } catch (err) {
        printError(err, ctx.cfg.baseUrl);
      }
      rl.prompt();
      continue;
    }
    inflight = new AbortController();
    try {
      await runTurn(ctx, t, inflight.signal);
    } catch (err) {
      if (isAbortError(err)) {
        process.stderr.write("\n" + errTheme.dim("✗ canceled — turn discarded") + "\n");
      } else {
        printError(err, ctx.cfg.baseUrl);
      }
    } finally {
      inflight = null;
    }
    process.stdout.write("\n");
    rl.prompt();
  }
  rl.close();
  process.stdout.write("\n");
  return 0;
}

function printError(err: unknown, baseUrl: string): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\n${errTheme.red("✗")} ${msg}\n`);
  const hint = errorHint(err, baseUrl);
  if (hint) process.stderr.write(errTheme.dim(`  ⤷ ${hint}`) + "\n");
}
