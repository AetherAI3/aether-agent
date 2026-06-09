import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRestart, buildPromptContext } from "../src/commands/chat.js";
import { handleSlash } from "../src/commands/slash.js";
import type { GlobalFlags, AppContext } from "../src/core/context.js";

test("applyRestart sets the new model and clears the agent", () => {
  const flags = { model: "haiku", agent: "neo", json: false, audit: false, yes: false, cwd: "." } as GlobalFlags;
  applyRestart(flags, { model: "opus" });
  assert.equal(flags.model, "opus");
  assert.equal(flags.agent, undefined);
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

// ── helpers ──

function fakeCtx(): AppContext {
  return {
    flags: { yes: false, json: false, audit: false, cwd: "." },
    cfg: { defaultModel: "haiku", baseUrl: "x" },
    api: {},
    confirm: async () => true,
  } as unknown as AppContext;
}
