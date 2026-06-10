import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, gateActionFor, decideGate } from "../src/core/autonomy.js";

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

test("gateActionFor gates mutating/shell tools and ignores read-only ones", () => {
  assert.equal(gateActionFor("write_file"), "write");
  assert.equal(gateActionFor("run_shell"), "shell");
  assert.equal(gateActionFor("git_commit"), "shell");
  assert.equal(gateActionFor("read_file"), null);
  assert.equal(gateActionFor("repo_search"), null);
  assert.equal(gateActionFor("run_tests"), null);
  assert.equal(gateActionFor("unknown_tool"), null);
});

test("decideGate: read-only tools always allow regardless of mode/tty", () => {
  assert.equal(decideGate("read_file", "ask", false, { yes: false, isTty: false }), "allow");
  assert.equal(decideGate("run_tests", "ask", false, { yes: false, isTty: false }), "allow");
});

test("decideGate: ask mode prompts on a TTY, FAILS CLOSED (deny) without one", () => {
  assert.equal(decideGate("run_shell", "ask", false, { yes: false, isTty: true }), "prompt");
  assert.equal(decideGate("run_shell", "ask", false, { yes: false, isTty: false }), "deny");
  assert.equal(decideGate("write_file", "ask", false, { yes: false, isTty: false }), "deny");
});

test("decideGate: --yes auto-confirms even on a non-TTY", () => {
  assert.equal(decideGate("run_shell", "ask", false, { yes: true, isTty: false }), "allow");
});

test("decideGate: skip never prompts; auto depends on autoApply", () => {
  assert.equal(decideGate("run_shell", "skip", false, { yes: false, isTty: false }), "allow");
  assert.equal(decideGate("run_shell", "auto", true, { yes: false, isTty: false }), "allow");
  assert.equal(decideGate("run_shell", "auto", false, { yes: false, isTty: true }), "prompt");
  assert.equal(decideGate("run_shell", "auto", false, { yes: false, isTty: false }), "deny");
});
