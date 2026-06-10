// `aether [prompt]` — one-shot if a prompt is given, else an interactive REPL.
// This is the coding front door: build an envelope, POST to the universal
// stream, decode frames, render. The agent brain runs on Aether's servers.

import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import type { AppContext, GlobalFlags } from "../core/context.js";
import { theme } from "../ui/theme.js";
import { buildChatRequest } from "../core/envelope.js";
import { CHAT_STREAM_PATH, CHAT_PATH } from "../core/transport.js";
import { decodeSse } from "../core/stream.js";
import { Renderer } from "../core/render.js";
import { StreamUnavailableError } from "../core/errors.js";
import { appendCustody } from "../core/custody.js";
import { handleSlash, primeCatalog } from "./slash.js";
import { applyPromptMode } from "./prompt_modes.js";
import { userInfo } from "node:os";
import { renderSplash } from "../ui/splash.js";
import { promptPrefix } from "../ui/prompt.js";
import { InputBuffer } from "../ui/input_line.js";
import { renderInputView } from "../ui/input_render.js";
import { decodeKey, splitKeys } from "../ui/keys.js";
import { ThinkingPulse } from "../ui/thinking.js";
import { registerRestore } from "../ui/restore.js";
import { completeSlash } from "./slash_registry.js";
import { hintFor, isAbortError } from "../core/error_hints.js";
import { loadHistory, appendHistory, historyPath, historyEnabled } from "../core/history_store.js";
import { VERSION } from "../version.js";

// Key decoding lives in ui/keys.ts (shared with pickers/viewers); re-exported
// here so existing imports keep working.
export { decodeKey, type Key } from "../ui/keys.js";

// the Aether API ChatResponse: { response, commitment_hash, verified, threat_level }.
interface ChatJsonResponse {
  response?: string;
  commitment_hash?: string;
}

/** Run a single coding turn end to end. Exported for `run.ts` (orchestrators). */
export async function runTurn(ctx: AppContext, prompt: string, signal?: AbortSignal): Promise<void> {
  const req = buildChatRequest({
    prompt,
    model: ctx.flags.model ?? ctx.cfg.defaultModel,
    agent: ctx.flags.agent ?? "",
    // Only an explicit --model this invocation counts as a manual pick.
    manualModel: ctx.flags.model != null,
  });
  // Interactive TTY chat gets styled markdown + a pre-first-byte pulse;
  // pipes/--json stay byte-identical raw streams.
  const interactive = Boolean(process.stdout.isTTY) && !ctx.flags.json;
  const renderer = new Renderer({ json: ctx.flags.json, audit: ctx.flags.audit, markdown: interactive });
  const pulse = interactive ? new ThinkingPulse((s) => process.stdout.write(s)) : null;
  pulse?.start();
  try {
    const stream = await ctx.api.stream(CHAT_STREAM_PATH, req, signal);
    for await (const frame of decodeSse(stream)) {
      // Clear the pulse before the first visible frame so it never interleaves.
      if (pulse && frame.type !== "open" && frame.type !== "ping") pulse.stop();
      // The server signs each turn and returns it; persist the signed receipt
      // locally (best-effort, never breaks the chat).
      if (frame.type === "custody") appendCustody(frame.custody);
      renderer.frame(frame);
    }
  } catch (err) {
    if (err instanceof StreamUnavailableError) {
      // Contract fail-soft: fall back to the non-streaming request/response.
      // The pulse keeps breathing through the (unstreamed) wait.
      const r = await ctx.api.postJson<ChatJsonResponse>(CHAT_PATH, req);
      pulse?.stop();
      process.stdout.write((r.response ?? "") + "\n");
      if (ctx.flags.audit && r.commitment_hash) {
        process.stderr.write(`  signed ✓ ${r.commitment_hash}\n`);
      }
      return;
    }
    throw err;
  } finally {
    pulse?.stop();
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

/** Build a prompt with optional steering and btw context prepended.
 *  Clears steering and btwNotes in the returned result so callers
 *  can use single-shot semantics.  Exported for testing. */
export function buildPromptContext(
  base: string,
  steering: string | null,
  btwNotes: string[],
): { prompt: string; steering: string | null; btwNotes: string[] } {
  const ctxParts: string[] = [];
  if (steering) ctxParts.push(`STEERING: ${steering}`);
  if (btwNotes.length) ctxParts.push(`NOTE: ${btwNotes.join("; ")}`);
  const prompt = ctxParts.length ? ctxParts.join("\n") + "\n\n" + base : base;
  return { prompt, steering: null, btwNotes: [] };
}

/** One composer repaint: clear the row, draw the cursor-windowed view, and put
 *  the hardware cursor at the caret's real column. Pure — unit-tested. */
export function repaintString(prompt: string, value: string, cursor: number, cols: number): string {
  const v = renderInputView(prompt, value, cursor, cols);
  return "\r\x1b[2K" + v.text + `\x1b[${v.cursorCol}G`;
}

/** What one Ctrl+C should do, given the REPL's state. A state machine, not a
 *  kill switch:
 *    mid-paste           → exit (a stuck paste must never brick raw mode)
 *    turn streaming      → abort the TURN, session lives (again → quit)
 *    draft in the buffer → clear the line
 *    idle, empty buffer  → press twice within the window to quit
 *  Pure — unit-tested. */
export type CtrlCAction = "exit" | "abort-turn" | "arm-quit" | "clear-line" | "arm-exit";
export function ctrlCDecision(s: {
  pasting: boolean;
  busy: boolean;
  abortable: boolean;
  hasDraft: boolean;
  armed: boolean;
}): CtrlCAction {
  if (s.pasting) return "exit";
  if (s.busy) {
    if (s.abortable) return "abort-turn";
    return s.armed ? "exit" : "arm-quit";
  }
  if (s.hasDraft) return "clear-line";
  return s.armed ? "exit" : "arm-exit";
}

// A trailing partial escape sequence (CSI/SS3/OSC intro with no final byte) —
// held back until the next stdin chunk so markers/arrows split across chunk
// boundaries reassemble instead of degrading into garbage or a stuck paste.
// A BARE trailing ESC is NOT held: that's the Esc key (or an Alt chord whose
// tail lands in the same chunk), and holding it would delay it forever.
const PARTIAL_ESC_RE = /\x1b(?:\[[0-9;:<=>?]*[ -/]*|O|\])$/;

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
  const histPath = historyPath();
  if (historyEnabled()) buf.loadHistory(loadHistory(histPath));
  const remember = (line: string): void => {
    if (historyEnabled()) appendHistory(line, histPath);
  };
  const prompt = promptPrefix(username);
  // A turn/slash is async; Node still delivers stdin 'data' events while we
  // await. While busy, the buffer still ACCUMULATES (type-ahead, /steer, /queue)
  // but repaint is suppressed — a mid-stream "\r\x1b[2K" would stomp the line
  // the answer is currently streaming onto.
  let busy = false;
  const repaint = (): void => {
    if (busy) return;
    process.stdout.write(repaintString(prompt, buf.value, buf.pos, process.stdout.columns ?? 80));
  };
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write("\x1b[?2004h"); // bracketed paste ON
  // Crash-safe: even an uncaught throw restores cooked mode + paste-off.
  const unregisterRestore = registerRestore(() => {
    process.stdout.write("\x1b[?2004l\x1b[?25h");
    try {
      process.stdin.setRawMode(false);
    } catch {
      /* terminal already gone */
    }
  });
  repaint();

  let pasting = false;
  let pasteAcc = "";
  let carry = ""; // partial escape sequence held across chunk boundaries
  const queue: string[] = [];
  let steering: string | null = null;
  const btwNotes: string[] = [];
  let turnAbort: AbortController | null = null; // live while a cloud turn streams
  let ctrlCArmedAt = 0; // double-press window for quitting
  const CTRL_C_WINDOW_MS = 1500;
  return await new Promise<number>((resolve) => {
    const onResize = (): void => repaint();
    const cleanup = (): void => {
      process.stdout.write("\x1b[?2004l\x1b[?25h"); // paste off + cursor shown
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* terminal already gone */
      }
      unregisterRestore();
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.removeListener("resize", onResize);
    };
    const finish = (code: number): void => {
      cleanup();
      process.stdout.write("\n");
      resolve(code);
    };

    /** Run one turn. Returns true when the user aborted it (Ctrl+C). */
    const runQueuedTurn = async (text: string): Promise<boolean> => {
      const built = buildPromptContext(text, steering, btwNotes);
      steering = built.steering;
      btwNotes.length = 0;
      turnAbort = new AbortController();
      try {
        await runTurn(ctx, built.prompt, turnAbort.signal);
        return false;
      } catch (err) {
        if (isAbortError(err)) {
          // User said stop: drop the queued follow-ups too.
          queue.length = 0;
          process.stdout.write("\n" + theme.dim("✗ turn aborted") + "\n");
          return true;
        }
        printError(err);
        return false;
      } finally {
        turnAbort = null;
      }
    };

    const onCtrlC = (): void => {
      const now = Date.now();
      const armed = now - ctrlCArmedAt <= CTRL_C_WINDOW_MS && ctrlCArmedAt > 0;
      const action = ctrlCDecision({
        pasting,
        busy,
        abortable: turnAbort != null && !turnAbort.signal.aborted,
        hasDraft: buf.value.length > 0,
        armed,
      });
      switch (action) {
        case "exit":
          finish(0);
          return;
        case "abort-turn":
          turnAbort!.abort();
          ctrlCArmedAt = now;
          return;
        case "arm-quit":
          ctrlCArmedAt = now;
          process.stdout.write("\n" + theme.dim("(ctrl+c again to quit)") + "\n");
          return;
        case "clear-line":
          buf.clear();
          ctrlCArmedAt = 0;
          repaint();
          return;
        case "arm-exit":
          ctrlCArmedAt = now;
          process.stdout.write("\n" + theme.dim("(ctrl+c again to exit)") + "\n");
          repaint();
          return;
      }
    };

    const onSubmit = async (): Promise<void> => {
      let t = buf.value.trim();
      // ── mid-turn Enter: bypass commands + type-ahead queueing ──
      if (busy) {
        if (t.startsWith("/steer ")) {
          steering = t.slice(7).trim() || steering;
          remember(buf.value);
          buf.commit(buf.value);
          if (steering) process.stdout.write(`\n🎯 Steering set: "${steering}"\n`);
          return;
        }
        if (t.startsWith("/btw ")) {
          const note = t.slice(5).trim();
          remember(buf.value);
          buf.commit(buf.value);
          if (note) {
            btwNotes.push(note);
            process.stdout.write(`\n📝 Noted: "${note}"\n`);
          }
          return;
        }
        if (t.startsWith("/queue ")) t = t.slice(7).trim();
        remember(buf.value);
        buf.commit(buf.value);
        if (!t || t.startsWith("/")) return; // other slashes wait for the turn
        queue.push(t);
        const preview = t.length > 55 ? t.slice(0, 55) + "…" : t;
        process.stdout.write(`\n⏳ Queued (${queue.length}): "${preview}"\n`);
        return;
      }

      process.stdout.write("\n");
      remember(buf.value);
      buf.commit(buf.value);
      if (!t) {
        repaint();
        return;
      }
      // ── /steer /btw /queue — stateful, stay inline ──
      if (t.startsWith("/steer ") || t === "/steer") {
        const guidance = t.slice(6).trim();
        if (!guidance) { process.stdout.write("usage: /steer <guidance>\n"); repaint(); return; }
        steering = guidance;
        process.stdout.write(`🎯 Steering set: "${guidance}"\n`);
        repaint(); return;
      }
      if (t.startsWith("/btw ") || t === "/btw") {
        const note = t.slice(4).trim();
        if (!note) { process.stdout.write("usage: /btw <note>\n"); repaint(); return; }
        btwNotes.push(note);
        process.stdout.write(`📝 Noted: "${note}"\n`);
        repaint(); return;
      }
      if (t.startsWith("/queue ") || t === "/queue") {
        const task = t.slice(6).trim();
        if (!task) { process.stdout.write("usage: /queue <task>\n"); repaint(); return; }
        // not busy — run immediately as a normal turn
        process.stdout.write(`⏳ Running: "${task}"\n`);
        t = task;
      }
      // ── stateless prompt-rewrite modes (/recon, /plan, /research, …) ──
      const mode = applyPromptMode(t);
      if (mode.handled) {
        if (mode.error) { process.stdout.write(mode.error + "\n"); repaint(); return; }
        process.stdout.write(mode.notice + "\n");
        t = mode.prompt!;
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
        // An aborted turn skips the drain entirely — even an item that slipped
        // into the queue during abort teardown must not auto-run.
        let aborted = await runQueuedTurn(t);
        while (!aborted && queue.length > 0) {
          const next = queue.shift()!;
          const preview = next.length > 55 ? next.slice(0, 55) + "…" : next;
          process.stdout.write(`\n→ Queued: "${preview}"\n`);
          aborted = await runQueuedTurn(next);
        }
      } finally {
        busy = false;
      }
      repaint();
    };

    // SYNC on purpose: every key is fully processed before the next token, so
    // out-of-order edits are impossible. Submits are fired un-awaited — the
    // busy flag is set synchronously inside onSubmit before its first await,
    // so later tokens correctly land in the type-ahead path.
    const processSeq = (seq: string): void => {
      // Ctrl-C is handled BEFORE paste accumulation so a stuck paste or hung
      // stream can never hard-lock the terminal in raw mode.
      if (seq === "\x03") {
        onCtrlC();
        return;
      }
      if (pasting) {
        const k = decodeKey(seq);
        if (k.kind === "paste-end") {
          buf.paste(pasteAcc);
          pasteAcc = "";
          pasting = false;
          repaint();
        } else {
          pasteAcc += seq; // raw bytes — pasted content may legitimately contain escapes
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
        case "delete":
          buf.deleteForward();
          repaint();
          return;
        case "word-delete":
          buf.deleteWord();
          repaint();
          return;
        case "kill-end":
          buf.killToEnd();
          repaint();
          return;
        case "kill-start":
          buf.killToStart();
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
        case "word-left":
          buf.wordLeft();
          repaint();
          return;
        case "word-right":
          buf.wordRight();
          repaint();
          return;
        case "tab": {
          // Slash-command completion: complete to the unambiguous prefix, or
          // show the candidates. Plain text Tab is ignored (no file paths yet).
          if (busy) return;
          const v = buf.value;
          if (v.startsWith("/") && !/\s/.test(v) && buf.pos === [...v].length) {
            const r = completeSlash(v);
            if (r.completed) {
              buf.clear();
              buf.insert(r.completed);
            } else if (r.matches.length > 1) {
              const shown = r.matches.slice(0, 12).map((m) => "/" + m).join("  ");
              const more = r.matches.length > 12 ? `  … +${r.matches.length - 12} more` : "";
              process.stdout.write("\n" + theme.dim(shown + more) + "\n");
            }
            repaint();
          }
          return;
        }
        case "clear-screen":
          if (!busy) {
            process.stdout.write("\x1b[2J\x1b[H");
            repaint();
          }
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
          onCtrlC();
          return;
        case "eof":
          if (!buf.value) finish(0);
          return;
        case "submit":
          void onSubmit().catch((err) => printError(err));
          return;
        case "escape":
          return; // ignore — picker handles its own escape
        default:
          return; // ignore
      }
    };

    // StringDecoder: a multibyte UTF-8 char split across chunks must not be
    // decoded as two replacement chars.
    const decoder = new StringDecoder("utf8");
    const onData = (chunk: Buffer): void => {
      let data = carry + decoder.write(chunk);
      carry = "";
      const partial = PARTIAL_ESC_RE.exec(data);
      if (partial && partial[0].length > 0 && partial.index + partial[0].length === data.length) {
        carry = partial[0];
        data = data.slice(0, partial.index);
      }
      for (const seq of splitKeys(data)) {
        processSeq(seq);
      }
    };
    process.stdin.on("data", onData);
    process.stdout.on("resize", onResize);
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
  const hint = hintFor(err);
  if (hint) process.stderr.write(theme.dim(`  ↳ ${hint}`) + "\n");
}
