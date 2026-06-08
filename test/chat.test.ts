import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRestart } from "../src/commands/chat.js";
import type { GlobalFlags } from "../src/core/context.js";

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
