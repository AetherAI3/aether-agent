// `aether [prompt]` — one-shot if a prompt is given, else an interactive REPL.
// This is the coding front door: build an envelope, POST to the universal
// stream, decode frames, render. The agent brain runs on Aether's servers.

import { createInterface } from "node:readline";
import type { AppContext, GlobalFlags } from "../core/context.js";
import { theme } from "../ui/theme.js";
import { buildChatRequest } from "../core/envelope.js";
import { CHAT_STREAM_PATH, CHAT_PATH } from "../core/transport.js";
import { decodeSse } from "../core/stream.js";
import { Renderer } from "../core/render.js";
import { StreamUnavailableError } from "../core/errors.js";
import { appendCustody } from "../core/custody.js";
import { handleSlash, primeCatalog } from "./slash.js";
import { userInfo } from "node:os";
import { renderSplash } from "../ui/splash.js";
import { promptPrefix } from "../ui/prompt.js";
import { InputBuffer } from "../ui/input_line.js";
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

/** Apply a confirmed model/agent switch: set the new selection, clear the other,
 * and let the caller start a fresh session (context cleared). */
export function applyRestart(flags: GlobalFlags, r: { model?: string; agent?: string }): void {
  if (r.model) {
    flags.model = r.model;
    flags.agent = undefined;
  } else if (r.agent) {
    flags.agent = r.agent;
    flags.model = undefined;
  }
}

export async function cmdChat(ctx: AppContext, prompt: string): Promise<number> {
  if (prompt.trim()) {
    try {
      await runTurn(ctx, prompt);
      return 0;
    } catch (err) {
      printError(err);
      return 1;
    }
  }
  return repl(ctx);
}

export type Key =
  | { kind: "char"; value: string }
  | { kind: "submit" }
  | { kind: "backspace" }
  | { kind: "interrupt" }
  | { kind: "eof" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "home" }
  | { kind: "end" }
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "word-delete" }
  | { kind: "paste-start" }
  | { kind: "paste-end" }
  | { kind: "ignore" };

/** Decode one raw stdin sequence into a Key. Pure — unit-tested in chat_keys. */
export function decodeKey(seq: string): Key {
  switch (seq) {
    case "\r":
    case "\n":
      return { kind: "submit" };
    case "\x7f":
    case "\b":
      return { kind: "backspace" };
    case "\x03":
      return { kind: "interrupt" };
    case "\x04":
      return { kind: "eof" };
    case "\x17":
      return { kind: "word-delete" }; // ctrl-w
    case "\x1b[D":
      return { kind: "left" };
    case "\x1b[C":
      return { kind: "right" };
    case "\x1b[H":
    case "\x1b[1~":
      return { kind: "home" };
    case "\x1b[F":
    case "\x1b[4~":
      return { kind: "end" };
    case "\x1b[A":
      return { kind: "up" };
    case "\x1b[B":
      return { kind: "down" };
    case "\x1b[200~":
      return { kind: "paste-start" };
    case "\x1b[201~":
      return { kind: "paste-end" };
    default:
      if (seq.length === 1 && seq >= " ") return { kind: "char", value: seq };
      return { kind: "ignore" };
  }
}

async function repl(ctx: AppContext): Promise<number> {
  const username = userInfo().username || "you";
  const model = ctx.flags.model ?? ctx.cfg.defaultModel ?? "auto";
  process.stdout.write(
    renderSplash({ version: VERSION, model: model || "auto", effort: "default" }) + "\n\n",
  );
  process.stdout.write("Type a prompt, or /help for commands. /exit to quit.\n\n");
  if (!process.stdin.isTTY) return replLines(ctx);
  void primeCatalog(ctx); // non-blocking warm; first /models is then instant

  const buf = new InputBuffer();
  const prompt = promptPrefix(username);
  const repaint = (): void => {
    process.stdout.write("\r\x1b[2K" + prompt + buf.value);
  };
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write("\x1b[?2004h"); // bracketed paste ON
  repaint();

  let pasting = false;
  let pasteAcc = "";
  // A turn/slash is async; Node still delivers stdin 'data' events while we await.
  // `busy` blocks edit/submit keys mid-turn so the buffer can't be corrupted by a
  // reentrant handler. Ctrl-C is always honored (handled before this guard).
  let busy = false;
  return await new Promise<number>((resolve) => {
    const cleanup = (): void => {
      process.stdout.write("\x1b[?2004l");
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* terminal already gone */
      }
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    };
    const onData = async (chunk: Buffer): Promise<void> => {
      const seq = chunk.toString("utf8");
      // Ctrl-C interrupts even mid-turn; everything else waits until the turn ends.
      if (!pasting && seq === "\x03") {
        cleanup();
        process.stdout.write("\n");
        resolve(0);
        return;
      }
      if (busy) return;
      if (pasting) {
        const end = seq.indexOf("\x1b[201~");
        if (end >= 0) {
          pasteAcc += seq.slice(0, end);
          buf.paste(pasteAcc);
          pasteAcc = "";
          pasting = false;
          repaint();
        } else {
          pasteAcc += seq;
        }
        return;
      }
      const k = decodeKey(seq);
      switch (k.kind) {
        case "paste-start":
          pasting = true;
          pasteAcc = "";
          return;
        case "char":
          buf.insert(k.value);
          repaint();
          return;
        case "backspace":
          buf.backspace();
          repaint();
          return;
        case "word-delete":
          buf.deleteWord();
          repaint();
          return;
        case "left":
          buf.left();
          repaint();
          return;
        case "right":
          buf.right();
          repaint();
          return;
        case "home":
          buf.home();
          repaint();
          return;
        case "end":
          buf.end();
          repaint();
          return;
        case "up":
          buf.historyUp();
          repaint();
          return;
        case "down":
          buf.historyDown();
          repaint();
          return;
        case "interrupt":
          cleanup();
          process.stdout.write("\n");
          resolve(0);
          return;
        case "eof":
          if (!buf.value) {
            cleanup();
            process.stdout.write("\n");
            resolve(0);
          }
          return;
        case "submit": {
          const t = buf.value.trim();
          process.stdout.write("\n");
          buf.commit(buf.value);
          if (!t) {
            repaint();
            return;
          }
          busy = true;
          if (t.startsWith("/")) {
            try {
              const res = await handleSlash(ctx, t, process.stdout);
              if (res.exit) {
                cleanup();
                resolve(0);
                return;
              }
              if (res.restart) {
                applyRestart(ctx.flags, res.restart);
                process.stdout.write(theme.dim("session restarted — context cleared.\n"));
              }
            } catch (err) {
              printError(err);
            } finally {
              busy = false;
            }
            repaint();
            return;
          }
          try {
            await runTurn(ctx, t);
          } catch (err) {
            printError(err);
          } finally {
            busy = false;
          }
          repaint();
          return;
        }
        default:
          return; // ignore
      }
    };
    process.stdin.on("data", onData);
  });
}

/** Non-TTY fallback (pipes / CI): the original line-oriented readline loop. */
async function replLines(ctx: AppContext): Promise<number> {
  const rl = createInterface({ input: process.stdin });
  const p = promptPrefix(userInfo().username || "you");
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
        if (res.restart) {
          applyRestart(ctx.flags, res.restart);
          process.stdout.write(theme.dim("session restarted — context cleared.\n\n"));
        }
      } catch (err) {
        printError(err);
      }
      process.stdout.write(p);
      continue;
    }
    try {
      await runTurn(ctx, t);
    } catch (err) {
      printError(err);
    }
    process.stdout.write("\n" + p);
  }
  rl.close();
  process.stdout.write("\n");
  return 0;
}

function printError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\n✗ ${msg}\n`);
}
