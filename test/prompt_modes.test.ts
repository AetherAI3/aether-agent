// test/prompt_modes.test.ts — table-driven prompt-mode rewrites (REPL slash modes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPromptMode } from "../src/commands/prompt_modes.js";

test("plain text is not handled", () => {
  assert.deepEqual(applyPromptMode("fix the tests"), { handled: false });
});

test("unknown slash is not handled (falls through to handleSlash)", () => {
  assert.deepEqual(applyPromptMode("/models"), { handled: false });
});

test("/recon rewrites with topic and notice", () => {
  const r = applyPromptMode("/recon auth flow");
  assert.equal(r.handled, true);
  assert.ok(r.prompt!.startsWith("RECONNAISSANCE MODE. Thoroughly research: auth flow."));
  assert.equal(r.notice, '🔎 Recon: "auth flow"');
});

test("/recon without topic returns usage error", () => {
  const r = applyPromptMode("/recon");
  assert.equal(r.handled, true);
  assert.equal(r.error, "usage: /recon <topic>");
});

test("/plan slugs the topic into the save path", () => {
  const r = applyPromptMode("/plan Add OAuth2 Support!");
  assert.equal(r.handled, true);
  assert.ok(r.prompt!.includes(".hermes/plans/add-oauth2-support.md"));
});

test("/self-review and /code-review need no arg", () => {
  assert.ok(applyPromptMode("/self-review").prompt!.startsWith("SELF-REVIEW MODE."));
  assert.ok(applyPromptMode("/code-review").prompt!.startsWith("CODE REVIEW MODE."));
});

test("/review does not swallow /code-review", () => {
  assert.ok(applyPromptMode("/code-review").prompt!.startsWith("CODE REVIEW MODE."));
  assert.ok(applyPromptMode("/review").prompt!.startsWith("REVIEW MODE."));
});

test("/autonomous-execution embeds the task", () => {
  const r = applyPromptMode("/autonomous-execution ship it");
  assert.ok(r.prompt!.endsWith("Task: ship it"));
  assert.equal(r.notice, '🚀 Autonomous execution: "ship it"');
});

test("/subagent-driven-execution and /writing-plans and /research rewrite", () => {
  assert.ok(applyPromptMode("/subagent-driven-execution build x").prompt!.startsWith("EXECUTION MODE: subagent-driven."));
  assert.ok(applyPromptMode("/writing-plans topic").prompt!.startsWith("Write a detailed, actionable implementation plan"));
  assert.ok(applyPromptMode("/research topic").prompt!.startsWith("RESEARCH MODE."));
  assert.ok(applyPromptMode("/writing-skills").prompt!.startsWith("SKILL AUTHORING MODE."));
});
