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

// Key decoding lives in ui/keys.ts (shared with pickers/viewers); re-exported
// here so existing imports keep working.
import { decodeKey } from "../ui/keys.js";
export { decodeKey, type Key } from "../ui/keys.js";

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
  const queue: string[] = [];
  let steering: string | null = null;
  const btwNotes: string[] = [];
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
      if (busy) {
        // Allow /steer, /btw, /queue even mid-turn
        if (!pasting && (seq === "\r" || seq === "\n")) {
          const peek = buf.value.trim();
          if (
            !peek.startsWith("/steer ") &&
            !peek.startsWith("/btw ") &&
            !peek.startsWith("/queue ")
          ) {
            return;
          }
          // fall through to submit handler for bypass commands
        } else {
          return;
        }
      }
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
          let t = buf.value.trim();
          process.stdout.write("\n");
          buf.commit(buf.value);
          if (!t) {
            repaint();
            return;
          }
          // ── /steer /btw /queue — work even when busy ──
          if (t.startsWith("/steer ")) {
            const guidance = t.slice(7).trim();
            if (!guidance) { process.stdout.write("usage: /steer <guidance>\n"); repaint(); return; }
            steering = guidance;
            process.stdout.write(`🎯 Steering set: "${guidance}"\n`);
            repaint(); return;
          }
          if (t.startsWith("/btw ")) {
            const note = t.slice(5).trim();
            if (!note) { process.stdout.write("usage: /btw <note>\n"); repaint(); return; }
            btwNotes.push(note);
            process.stdout.write(`📝 Noted: "${note}"\n`);
            repaint(); return;
          }
          if (t.startsWith("/queue ")) {
            const task = t.slice(7).trim();
            if (!task) { process.stdout.write("usage: /queue <task>\n"); repaint(); return; }
            if (busy) {
              queue.push(task);
              const preview = task.length > 55 ? task.slice(0, 55) + "…" : task;
              process.stdout.write(`⏳ Queued (${queue.length}): "${preview}"\n`);
              repaint(); return;
            }
            // not busy — run immediately (fall through to normal turn below)
            process.stdout.write(`⏳ Running: "${task}"\n`);
            t = task; // set t so the normal turn path below runs it
            // fall through — the rest of the submit handler will run it
          }

          // ── /writing-plans /subagent-driven-execution — blocked when busy ──
          if (t.startsWith("/writing-plans ")) {
            if (busy) { process.stdout.write("Agent is busy — use /queue to schedule this.\n"); repaint(); return; }
            const topic = t.slice(15).trim();
            if (!topic) { process.stdout.write("usage: /writing-plans <topic>\n"); repaint(); return; }
            const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
            process.stdout.write(`✎ Writing plan for: "${topic}"\n`);
            t = `Write a detailed, actionable implementation plan for: ${topic}. ` +
              `Save to .hermes/plans/${slug}.md. Include: phases with numbered tasks, ` +
              `file manifest (new + modified), testing strategy, out-of-scope items.`;
            // fall through to normal turn
          }
          if (t.startsWith("/subagent-driven-execution ")) {
            if (busy) { process.stdout.write("Agent is busy — use /queue to schedule this.\n"); repaint(); return; }
            const task = t.slice(28).trim();
            if (!task) { process.stdout.write("usage: /subagent-driven-execution <task>\n"); repaint(); return; }
            process.stdout.write(`⚡ Subagent execution: "${task}"\n`);
            t = `EXECUTION MODE: subagent-driven. ` +
              `Decompose the following task into parallel sub-tasks. Use the delegate_task tool ` +
              `to spawn subagents for each independent workstream. Synthesize all results. Task: ${task}`;
            // fall through to normal turn
          }
          // ── /self-review /recon /plan /writing-skills /autonomous-execution /research /review /code-review ──
          if (t.startsWith("/self-review")) {
            if (busy) { process.stdout.write("Agent is busy — use /queue to schedule this.\n"); repaint(); return; }
            process.stdout.write("🔍 Self-review in progress…\n");
            t = "SELF-REVIEW MODE. Review your own recent work in this session. " +
              "Identify: (1) mistakes made and how to avoid them, (2) improvements that could be made, " +
              "(3) what you would do differently if starting over, (4) patterns that emerged. " +
              "Be honest and critical. Summarize findings concisely.";
            // fall through
          }
          if (t.startsWith("/recon ")) {
            if (busy) { process.stdout.write("Agent is busy — use /queue to schedule this.\n"); repaint(); return; }
            const topic = t.slice(7).trim();
            if (!topic) { process.stdout.write("usage: /recon <topic>\n"); repaint(); return; }
            process.stdout.write(`🔎 Recon: "${topic}"\n`);
            t = `RECONNAISSANCE MODE. Thoroughly research: ${topic}. ` +
              "Explore the codebase — read relevant files, trace dependencies, check git history, " +
              "examine configuration, review related tests. Gather all context needed to understand " +
              "this area completely. Produce a structured recon report with: key files, architecture " +
              "notes, dependencies, potential issues, and recommendations.";
            // fall through
          }
          if (t.startsWith("/plan ")) {
            if (busy) { process.stdout.write("Agent is busy — use /queue to schedule this.\n"); repaint(); return; }
            const topic = t.slice(6).trim();
            if (!topic) { process.stdout.write("usage: /plan <topic>\n"); repaint(); return; }
            const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
            process.stdout.write(`📋 Planning: "${topic}"\n`);
            t = `PLANNING MODE. Write a detailed, actionable implementation plan for: ${topic}. ` +
              `Save to .hermes/plans/${slug}.md. Include: phases with numbered tasks, ` +
              "file manifest (new + modified files), testing strategy, risk assessment, " +
              "and out-of-scope items. Be specific — no hand-waving.";
            // fall through
          }
          if (t.startsWith("/writing-skills")) {
            if (busy) { process.stdout.write("Agent is busy — use /queue to schedule this.\n"); repaint(); return; }
            process.stdout.write("📝 Writing skills…\n");
            t = "SKILL AUTHORING MODE. Based on what you've learned in this session, " +
              "identify reusable patterns and write them as skill definitions. For each skill: " +
              "(1) name (kebab-case), (2) description, (3) trigger phrases, (4) step-by-step " +
              "instructions the agent should follow when triggered. Focus on patterns that " +
              "would save time in future sessions — recurring workflows, common fixes, " +
              "or project-specific conventions.";
            // fall through
          }
          if (t.startsWith("/autonomous-execution ")) {
            if (busy) { process.stdout.write("Agent is busy — use /queue to schedule this.\n"); repaint(); return; }
            const task = t.slice(23).trim();
            if (!task) { process.stdout.write("usage: /autonomous-execution <task>\n"); repaint(); return; }
            process.stdout.write(`🚀 Autonomous execution: "${task}"\n`);
            t = "AUTONOMOUS EXECUTION MODE. Execute the following task without asking for confirmation. " +
              "Plan the approach silently, implement it, test it, and verify the result. " +
              "Only report back when complete or blocked. Do not ask 'should I proceed?' — " +
              "just do it. If you hit a blocker, explain what happened and suggest next steps. " +
              `Task: ${task}`;
            // fall through
          }
          if (t.startsWith("/research ")) {
            if (busy) { process.stdout.write("Agent is busy — use /queue to schedule this.\n"); repaint(); return; }
            const topic = t.slice(10).trim();
            if (!topic) { process.stdout.write("usage: /research <topic>\n"); repaint(); return; }
            process.stdout.write(`📚 Researching: "${topic}"\n`);
            t = `RESEARCH MODE. Research the following topic thoroughly: ${topic}. ` +
              "Gather information from the codebase, git history, configuration files, " +
              "and documentation. If relevant, search the web for context. Produce a " +
              "well-structured research summary with: overview, key findings, relevant files, " +
              "external context (if applicable), and actionable recommendations.";
            // fall through
          }
          if (t.startsWith("/review")) {
            if (busy) { process.stdout.write("Agent is busy — use /queue to schedule this.\n"); repaint(); return; }
            process.stdout.write("🔍 Full review in progress…\n");
            t = "REVIEW MODE. Perform a comprehensive review of the current project state. " +
              "Cover: (1) recent changes — what was modified and why, (2) code quality assessment, " +
              "(3) test coverage gaps, (4) outstanding issues or TODOs, (5) architecture concerns, " +
              "(6) recommendations for improvement. Be thorough but concise.";
            // fall through
          }
          if (t.startsWith("/code-review")) {
            if (busy) { process.stdout.write("Agent is busy — use /queue to schedule this.\n"); repaint(); return; }
            process.stdout.write("🧹 Code review sweep…\n");
            t = "CODE REVIEW MODE. Perform a thorough code review sweep of the project. " +
              "Focus on: (1) dead code — identify and remove unused files, functions, imports, " +
              "(2) complexity — simplify over-engineered logic, (3) readability — improve naming " +
              "and structure, (4) bugs — find and fix any issues, (5) consistency — ensure " +
              "patterns are uniform across the codebase. Fix what you can, flag what needs " +
              "discussion. Be surgical — don't rewrite working code unnecessarily.";
            // fall through
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
            // Build prompt with steering/btw context
            let prompt = t;
            const ctxParts: string[] = [];
            if (steering) { ctxParts.push(`STEERING: ${steering}`); steering = null; }
            if (btwNotes.length) { ctxParts.push(`NOTE: ${btwNotes.join("; ")}`); btwNotes.length = 0; }
            if (ctxParts.length) prompt = ctxParts.join("\n") + "\n\n" + prompt;
            await runTurn(ctx, prompt);
          } catch (err) {
            printError(err);
          } finally {
            while (queue.length > 0) {
              const next = queue.shift()!;
              const preview = next.length > 55 ? next.slice(0, 55) + "…" : next;
              process.stdout.write(`\n→ Queued: "${preview}"\n`);
              try { await runTurn(ctx, next); }
              catch (err) { printError(err); }
            }
            busy = false;
          }
          repaint();
          return;
        }
        case "escape":
          return; // ignore — picker handles its own escape
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
