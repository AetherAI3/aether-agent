import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/core/autonomy.js";

test("skip mode never prompts", () => {
  const d = evaluate("edit", "skip", false);
  assert.equal(d.allowed, true);
  assert.equal(d.needsPrompt, false);
});

test("auto mode prompts only when autoApply is off", () => {
  assert.equal(evaluate("edit", "auto", true).needsPrompt, false);
  assert.equal(evaluate("edit", "auto", false).needsPrompt, true);
});

test("ask mode always prompts", () => {
  assert.equal(evaluate("shell", "ask", true).needsPrompt, true);
});
