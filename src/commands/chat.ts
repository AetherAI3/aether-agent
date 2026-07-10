// `aether [prompt]` — one-shot if a prompt is given, else an interactive REPL.
// This is the coding front door: build an envelope, POST to the universal
// stream, decode frames, render. The agent brain runs on Aether's servers.

import { createInterface } from "node:readline";
import type { AppContext } from "../core/context.js";
import { buildChatRequest } from "../core/envelope.js";
import { CHAT_STREAM_PATH, CHAT_PATH } from "../core/transport.js";
import { decodeSse } from "../core/stream.js";
import { Renderer } from "../core/render.js";
import { StreamUnavailableError, errorHint } from "../core/errors.js";
import { appendCustody } from "../core/custody.js";
import { handleSlash } from "./slash.js";
import { userInfo } from "node:os";
import { renderSplash } from "../ui/splash.js";
import { promptPrefix } from "../ui/prompt.js";
import { errTheme } from "../ui/theme.js";
import { VERSION } from "../version.js";

// the Aether API ChatResponse: { response, commitment_hash, verified, threat_level }.
interface ChatJsonResponse {
  response?: string;
  commitment_hash?: string;
}

/** Run a single coding turn end to end. Exported for `run.ts` (orchestrators). */
export async function runTurn(ctx: AppContext, prompt: string): Promise<void> {
  const req = buildChatRequest({
    prompt,
    model: ctx.flags.model ?? ctx.cfg.defaultModel,
    agent: ctx.flags.agent ?? "",
    // Only an explicit --model this invocation counts as a manual pick.
    manualModel: ctx.flags.model != null,
  });
  const renderer = new Renderer({ json: ctx.flags.json, audit: ctx.flags.audit });
  try {
    const stream = await ctx.api.stream(CHAT_STREAM_PATH, req);
    for await (const frame of decodeSse(stream)) {
      // The server signs each turn and returns it; persist the signed receipt
      // locally (best-effort, never breaks the chat).
      if (frame.type === "custody") appendCustody(frame.custody);
      renderer.frame(frame);
    }
  } catch (err) {
    if (err instanceof StreamUnavailableError) {
      // Contract fail-soft: fall back to the non-streaming request/response.
      const r = await ctx.api.postJson<ChatJsonResponse>(CHAT_PATH, req);
      process.stdout.write((r.response ?? "") + "\n");
      if (ctx.flags.audit && r.commitment_hash) {
        process.stderr.write(`  signed ✓ ${r.commitment_hash}\n`);
      }
      return;
    }
    throw err;
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
  const rl = createInterface({ input: process.stdin });
  const username = userInfo().username || "you";
  const p = promptPrefix(username);
  const model = ctx.flags.model ?? ctx.cfg.defaultModel ?? "auto";
  process.stdout.write(
    renderSplash({
      version: VERSION,
      model: model || "auto",
      effort: ctx.cfg.defaultEffort || "default",
    }) + "\n\n",
  );
  process.stdout.write("Type a prompt, or /help for commands. /exit to quit.\n\n");
  process.stdout.write(p);
  for await (const line of rl) {
    const t = line.trim();
    if (!t) {
      process.stdout.write(p);
      continue;
    }
    if (t.startsWith("/")) {
      try {
        const res = await handleSlash(ctx, t, process.stdout);
        if (res.exit) break;
      } catch (err) {
        printError(err, ctx.cfg.baseUrl);
      }
      process.stdout.write(p);
      continue;
    }
    try {
      await runTurn(ctx, t);
    } catch (err) {
      printError(err, ctx.cfg.baseUrl);
    }
    process.stdout.write("\n" + p);
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
