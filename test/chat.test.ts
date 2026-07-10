import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn, ChatTurnError, applyRestart, buildPromptContext, repaintString } from "../src/commands/chat.js";
import { handleSlash } from "../src/commands/slash.js";
import { ApiClient } from "../src/core/transport.js";
import type { GlobalFlags, AppContext } from "../src/core/context.js";
import type { TokenStore } from "../src/core/auth.js";

const tokens = { get: async () => "aek_t" } as unknown as TokenStore;

function sseFetch(events: string[]): typeof globalThis.fetch {
  const body = events.map((e) => `data: ${e}\n\n`).join("");
  return (async () => {
    const bytes = new TextEncoder().encode(body);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: (async function* (): AsyncIterable<Uint8Array> {
        yield bytes;
      })(),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
}

function ctxWith(): AppContext {
  return {
    cfg: {
      baseUrl: "https://stub.test",
      defaultModel: "",
      permissionMode: "ask",
      autoApply: false,
      telemetry: false,
      defaultEffort: "",
      backend: "cloud", // pin cloud so resolveBackend doesn't probe a local Ollama in CI
    },
    flags: { json: true, audit: false, yes: false, cwd: "." }, // json:true keeps stdout output quiet
    tokens,
    api: new ApiClient("https://stub.test", tokens),
  } as unknown as AppContext;
}

// runTurn is void+onFrame (orchestrator-shaped, see resolveBackend/runCloudTurn
// in chat.ts); a streamed `error` frame is signaled by throwing ChatTurnError
// rather than a boolean return, since the Renderer already paints the "✗ msg"
// line before runTurn can return control to the caller (CONTRACTS.md: a
// rendered error is not the same as a successful turn).
test("runTurn throws ChatTurnError when the server streams an error frame", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = sseFetch([
    JSON.stringify({ type: "delta", text: "partial" }),
    JSON.stringify({ type: "error", msg: "rate limited" }),
  ]);
  try {
    await assert.rejects(() => runTurn(ctxWith(), "hi"), ChatTurnError);
  } finally {
    globalThis.fetch = real;
  }
});

test("runTurn resolves cleanly on a clean stream", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = sseFetch([
    JSON.stringify({ type: "delta", text: "ok" }),
    JSON.stringify({ type: "done", uvt: 1, cents: 0 }),
  ]);
  try {
    await runTurn(ctxWith(), "hi"); // must not throw
  } finally {
    globalThis.fetch = real;
  }
});

test("applyRestart sets the new model and clears the agent", () => {
  const flags = { model: "haiku", agent: "neo", json: false, audit: false, yes: false, cwd: "." } as GlobalFlags;
  applyRestart(flags, { model: "opus" });
  assert.equal(flags.model, "opus");
  assert.equal(flags.agent, undefined);
});

// Regression: the thinking pulse is presentation-only, like every other
// status/diagnostic writer in this codebase (StatusRenderer, HostRenderer's
// status/telemetry). It must target stderr so stdout stays byte-identical
// for redirection/piping — even when stdout is a still-TTY sink (script(1),
// pty recorders). A prior merge resolution accidentally routed it to stdout.
test("interactive TTY chat pulse writes only to stderr, never stdout", async () => {
  const real = globalThis.fetch;
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origStdoutIsTTY = process.stdout.isTTY;
  const origStderrIsTTY = process.stderr.isTTY;

  let stdoutBytes = "";
  let stderrBytes = "";
  (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
  (process.stderr as unknown as { isTTY: boolean }).isTTY = true;
  process.stdout.write = ((chunk: unknown): boolean => {
    stdoutBytes += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown): boolean => {
    stderrBytes += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  globalThis.fetch = sseFetch([
    JSON.stringify({ type: "delta", text: "ok" }),
    JSON.stringify({ type: "done", uvt: 1, cents: 0 }),
  ]);
  try {
    const ctx = ctxWith();
    ctx.flags.json = false; // json:true would suppress the pulse entirely; must be off to exercise it
    await runTurn(ctx, "hi");
    assert.doesNotMatch(stdoutBytes, /thinking/, "pulse frames must never reach stdout");
  } finally {
    globalThis.fetch = real;
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    (process.stdout as unknown as { isTTY: boolean | undefined }).isTTY = origStdoutIsTTY;
    (process.stderr as unknown as { isTTY: boolean | undefined }).isTTY = origStderrIsTTY;
  }
  void stderrBytes; // presence on stderr is covered by thinking.test.ts; this test's contract is "never on stdout"
});

test("applyRestart sets the new agent and clears the model", () => {
  const flags = { model: "haiku", agent: undefined, json: false, audit: false, yes: false, cwd: "." } as GlobalFlags;
  applyRestart(flags, { agent: "kronus" });
  assert.equal(flags.agent, "kronus");
  assert.equal(flags.model, undefined);
});

// ── /steer passthrough in handleSlash ──

test("/steer shows handled-in-REPL message", async () => {
  const out: string[] = [];
  const res = await handleSlash(fakeCtx(), "/steer use typescript", { write: (s: string) => out.push(s) } as never);
  assert.equal(res.exit, false);
  assert.match(out.join(""), /is handled directly in the interactive REPL/i);
});

// ── /btw passthrough in handleSlash ──

test("/btw shows handled-in-REPL message", async () => {
  const out: string[] = [];
  const res = await handleSlash(fakeCtx(), "/btw auth was refactored", { write: (s: string) => out.push(s) } as never);
  assert.equal(res.exit, false);
  assert.match(out.join(""), /is handled directly in the interactive REPL/i);
});

// ── /queue passthrough in handleSlash ──

test("/queue shows handled-in-REPL message", async () => {
  const out: string[] = [];
  const res = await handleSlash(fakeCtx(), "/queue fix login bug", { write: (s: string) => out.push(s) } as never);
  assert.equal(res.exit, false);
  assert.match(out.join(""), /is handled directly in the interactive REPL/i);
});

// ── /writing-plans passthrough in handleSlash ──

test("/writing-plans shows handled-in-REPL message", async () => {
  const out: string[] = [];
  const res = await handleSlash(fakeCtx(), "/writing-plans auth module", { write: (s: string) => out.push(s) } as never);
  assert.equal(res.exit, false);
  assert.match(out.join(""), /is handled directly in the interactive REPL/i);
});

// ── /subagent-driven-execution passthrough in handleSlash ──

test("/subagent-driven-execution shows handled-in-REPL message", async () => {
  const out: string[] = [];
  const res = await handleSlash(fakeCtx(), "/subagent-driven-execution refactor auth", { write: (s: string) => out.push(s) } as never);
  assert.equal(res.exit, false);
  assert.match(out.join(""), /is handled directly in the interactive REPL/i);
});

// ── buildPromptContext ──

test("buildPromptContext returns base prompt unchanged when no context", () => {
  const result = buildPromptContext("fix the bug", null, []);
  assert.equal(result.prompt, "fix the bug");
  assert.equal(result.steering, null);
  assert.deepEqual(result.btwNotes, []);
});

test("buildPromptContext prepends STEERING before the base prompt", () => {
  const result = buildPromptContext("fix the bug", "use TypeScript interfaces", []);
  assert.equal(result.prompt, "STEERING: use TypeScript interfaces\n\nfix the bug");
  assert.equal(result.steering, null); // cleared after use
  assert.deepEqual(result.btwNotes, []);
});

test("buildPromptContext prepends NOTE before the base prompt", () => {
  const result = buildPromptContext("fix the bug", null, ["auth refactored", "db is postgres 16"]);
  assert.equal(result.prompt, "NOTE: auth refactored; db is postgres 16\n\nfix the bug");
  assert.equal(result.steering, null);
  assert.deepEqual(result.btwNotes, []); // cleared after use
});

test("buildPromptContext combines steering and btw notes in correct order", () => {
  const result = buildPromptContext("fix the login bug", "use TypeScript", ["auth refactored", "db is postgres 16"]);
  // Steering first, then notes, then user prompt
  assert.equal(
    result.prompt,
    "STEERING: use TypeScript\nNOTE: auth refactored; db is postgres 16\n\nfix the login bug",
  );
  assert.equal(result.steering, null);
  assert.deepEqual(result.btwNotes, []);
});

test("buildPromptContext clears steering after a single use (single-shot)", () => {
  const result = buildPromptContext("task one", "guidance one", []);
  assert.equal(result.steering, null);
  // Second call with no new steering should return no steering
  const result2 = buildPromptContext("task two", null, []);
  assert.equal(result2.steering, null);
  assert.equal(result2.prompt, "task two");
});

test("buildPromptContext clears btwNotes after a single use (single-shot)", () => {
  const result = buildPromptContext("task one", null, ["note one"]);
  assert.deepEqual(result.btwNotes, []);
  // Second call with empty notes should stay empty
  const result2 = buildPromptContext("task two", null, []);
  assert.deepEqual(result2.btwNotes, []);
  assert.equal(result2.prompt, "task two");
});

// ── repaintString ──

test("repaintString clears the row, draws the view, and places the caret", () => {
  const s = repaintString("> ", "abc", 1, 40);
  assert.ok(s.startsWith("\r\x1b[2K"));
  assert.ok(s.includes("> abc"));
  assert.ok(s.endsWith("\x1b[4G")); // 2 prompt cols + 1 char + 1
});

test("repaintString keeps the caret on-row for overflowing input", () => {
  const s = repaintString("> ", "x".repeat(200), 200, 30);
  const col = Number(/\x1b\[(\d+)G$/.exec(s)![1]);
  assert.ok(col <= 30);
});

// ── helpers ──

function fakeCtx(): AppContext {
  return {
    flags: { yes: false, json: false, audit: false, cwd: "." },
    cfg: { defaultModel: "haiku", baseUrl: "x" },
    api: {},
    confirm: async () => true,
  } as unknown as AppContext;
}
