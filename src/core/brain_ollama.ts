// OllamaBrain — the fully-local brain, in TypeScript (no Python subprocess).
//
// It runs the same agentic chat+tool loop the headless Python brain does, but
// inline: it calls Ollama (core/ollama.ts) with the 8 canonical tools, and on a
// tool_call it emits a {type:"tool_call"} event and AWAITS the host's
// tool_result via sendToolResult — mirroring LocalBrain's queue handoff so the
// host loop (commands/code.ts hostLoop) drives it identically to local/cloud.
//
// The brain DECIDES (emits events); the host RENDERS and EXECUTES every tool
// call, replying with a tool_result. One tool implementation, one path-guard —
// so the local-Ollama path is indistinguishable from cloud by construction.
//
// No new deps: it reuses ollamaChat + the EventQueue. close() aborts the loop.

import type { Brain, TaskCommand } from "./brain.js";
import { EventQueue } from "./brain.js";
import type { BrainEvent } from "./brain_protocol.js";
import { TOOLS } from "./brain_protocol.js";
import type { ToolResult } from "./tool_executor.js";
import {
  ollamaChat,
  type ChatMessage,
  type ChatReply,
  type ToolCall,
  type ToolSchema,
} from "./ollama.js";

// The chat seam — overridable in tests with a scripted fake (no real socket).
export type OllamaChatFn = (
  messages: readonly ChatMessage[],
  opts?: { readonly host?: string; readonly model?: string; readonly tools?: readonly ToolSchema[] },
) => Promise<ChatReply>;

export interface OllamaBrainOptions {
  /** Ollama host (default $OLLAMA_HOST or http://localhost:11434). */
  host?: string;
  /** Model tag (default from the task.model, else the ollama default). */
  model?: string;
  /** Max chat<->tool turns before the loop breaks (runaway guard). */
  maxTurns?: number;
  /** Test seam: inject a fake chat. Production omits it and uses ollamaChat. */
  chat?: OllamaChatFn;
}

const DEFAULT_MAX_TURNS = 24;

// The 8 canonical tools, advertised to the model as OpenAI function schemas. The
// ONE implementation lives host-side in tool_executor.ts; this only describes
// them so the model can request them. Names are pinned by TOOLS (protocol v3).
const TOOL_SCHEMAS: readonly ToolSchema[] = buildToolSchemas();

const SYSTEM_PERSONA =
  "You are Aether Code, an autonomous coding agent running locally. You work in " +
  "a real repository and make progress by CALLING TOOLS, not by describing what " +
  "you would do. Read before you write. After editing, run the tests. When the " +
  "task is genuinely complete and the tests pass, reply with a short final " +
  "answer and DO NOT call any tool — that ends the turn.";

export class OllamaBrain implements Brain {
  private readonly queue = new EventQueue();
  private readonly opts: OllamaBrainOptions;
  private readonly chat: OllamaChatFn;
  // Pending tool result: the loop awaits this promise after emitting a
  // tool_call; sendToolResult resolves it (mirrors LocalBrain's stdin reply).
  private pending: ((r: ToolResult) => void) | null = null;
  private aborted = false;

  constructor(opts: OllamaBrainOptions = {}) {
    this.opts = opts;
    this.chat = opts.chat ?? defaultChat;
  }

  run(task: TaskCommand): AsyncIterable<BrainEvent> {
    // Kick the loop off (don't await) and hand back the drain generator; the
    // host consumes events while the loop awaits tool results via sendToolResult.
    void this.loop(task);
    return this.queue.drain();
  }

  sendToolResult(_id: string, result: ToolResult): void {
    if (this.pending) {
      const resolve = this.pending;
      this.pending = null;
      resolve(result);
    }
  }

  control(_action: "pause" | "resume" | "steer", _note?: string): void {
    // Steering is not yet wired for the local-Ollama brain (single-pass loop).
    // The seam exists so the host can call it uniformly; it is a safe no-op.
  }

  close(): void {
    this.aborted = true;
    // Unblock a loop parked on a tool result so it can observe the abort.
    if (this.pending) {
      const resolve = this.pending;
      this.pending = null;
      resolve({ output: "[aborted]", exitCode: 130 });
    }
    this.queue.end();
  }

  /** Await the host's reply to the tool_call we just emitted. */
  private waitForTool(): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      this.pending = resolve;
    });
  }

  /** The agentic loop: chat -> (tool calls -> results)* -> final answer. */
  private async loop(task: TaskCommand): Promise<void> {
    const model = this.opts.model || task.model || undefined;
    const maxTurns = this.opts.maxTurns ?? DEFAULT_MAX_TURNS;
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PERSONA },
      { role: "user", content: task.text },
    ];

    let reason = "";
    let ok = true;
    let result = "";
    try {
      for (let turn = 0; turn < maxTurns; turn += 1) {
        if (this.aborted) {
          reason = "aborted";
          ok = false;
          break;
        }
        let reply: ChatReply;
        try {
          reply = await this.chat(messages, {
            ...(model ? { model } : {}),
            ...(this.opts.host ? { host: this.opts.host } : {}),
            tools: TOOL_SCHEMAS,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.queue.push({ type: "error", msg });
          ok = false;
          reason = "unverified";
          break;
        }

        const calls = reply.tool_calls ?? [];
        if (calls.length === 0) {
          // No tool call -> this is the final answer. Surface it and finish.
          result = (reply.content || "").trim() || "done";
          this.queue.push({ type: "monologue", text: result, depth: 0 });
          ok = true;
          reason = "";
          break;
        }

        // Record the assistant turn (with its tool calls) before the replies.
        messages.push(assistantTurn(reply));

        for (const call of calls) {
          if (this.aborted) break;
          const args = parseArgs(call.function.arguments);
          this.queue.push({ type: "tool_call", id: call.id, name: call.function.name, args });
          const toolResult = await this.waitForTool();
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: toolResult.output,
          });
        }

        if (turn === maxTurns - 1) {
          // Ran the budget without a final answer — break, do not hang.
          ok = false;
          reason = "max-turns";
          result = "stopped: reached the turn budget without a final answer.";
        }
      }
    } finally {
      // Always close the stream so the host loop terminates (even on abort/error).
      this.queue.push({
        type: "done",
        ok,
        result: result || (ok ? "done" : "stopped"),
        // The brain does not count failing tests — the host's verify gate does,
        // from a real test run. Reporting a placeholder 1 here made an
        // unreachable-Ollama run print "1 test failing" when no test had run.
        remaining: 0,
        reason,
      });
      this.queue.end();
    }
  }
}

// --- helpers ----------------------------------------------------------------

/** Default production chat seam — the real Ollama client. */
async function defaultChat(
  messages: readonly ChatMessage[],
  opts?: { readonly host?: string; readonly model?: string; readonly tools?: readonly ToolSchema[] },
): Promise<ChatReply> {
  return ollamaChat(messages, opts ?? {});
}

/** Build an assistant ChatMessage that carries the tool calls it requested. */
function assistantTurn(reply: ChatReply): ChatMessage {
  const calls = reply.tool_calls ?? [];
  return {
    role: "assistant",
    content: reply.content || "",
    ...(calls.length > 0 ? { tool_calls: calls as readonly ToolCall[] } : {}),
  };
}

/** Parse a tool_call arguments JSON string into a record (never throws). */
function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Minimal OpenAI function schema per canonical tool (parameters left open). */
function buildToolSchemas(): readonly ToolSchema[] {
  const descriptions: Record<string, string> = {
    read_file: "Read a workspace file. args: {path}",
    write_file: "Write/overwrite a workspace file. args: {path, content}",
    run_shell: "Run a shell command in the workspace. args: {command}",
    run_tests: "Run the project's test command. args: {command?}",
    repo_search: "Grep the repository for a string. args: {query}",
    git_commit: "Stage all changes and commit. args: {message}",
    web_search: "Search the web. args: {query, limit?}",
    web_fetch: "Fetch a web page as readable text. args: {url}",
  };
  return TOOLS.map((name) => ({
    type: "function" as const,
    function: {
      name,
      description: descriptions[name] ?? name,
      parameters: { type: "object", properties: {}, additionalProperties: true },
    },
  }));
}
