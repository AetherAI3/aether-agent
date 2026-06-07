// The kill-gate regression. The host's final status MUST come from a real test
// run, never the brain's self-report. These tests lock that contract shut so the
// old "trust done.ok" bug cannot return. See specs/aethercode_loop_fixes.md §12.1.
import { test } from "node:test";
import assert from "node:assert/strict";

import { finalVerify, parseFailCount, type BrainDone } from "../src/core/verify_gate.js";
import type { ToolResult } from "../src/core/tool_executor.js";

/** A scripted ToolExecutor stand-in that records its calls and returns a fixed result. */
function fakeExec(result: ToolResult) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    execute(name: string, args: Record<string, unknown>): ToolResult {
      calls.push({ name, args });
      return result;
    },
  };
}

const RED = (n: number): ToolResult => ({ output: `[exit 1]\n=== ${n} failed in 3.2s ===`, exitCode: 1 });
const GREEN: ToolResult = { output: "[exit 0]\n=== 24 passed in 3.2s ===", exitCode: 0 };

test("parseFailCount matches the brain regex (\\d+\\s+failed)", () => {
  assert.equal(parseFailCount("[exit 1]\n=== 24 failed, 0 passed ==="), 24);
  assert.equal(parseFailCount("[exit 1]\n24  failed"), 24); // two spaces — the single-space regex missed this
  assert.equal(parseFailCount("[exit 0]\n=== 12 passed ==="), null);
  assert.equal(parseFailCount("segfault, no summary"), null);
});

// ── THE regression: the brain lies, the host catches it ─────────────────────
test("brain done.ok=true while host tests are RED → never ok", () => {
  const exec = fakeExec(RED(1));
  const out = finalVerify(exec, "pytest -q", { ok: true, remaining: 0, reason: "" });
  assert.notEqual(out.status, "ok"); // the old bug returned "ok" here
  assert.equal(out.status, "incomplete");
  assert.equal(out.remaining, 1);
  assert.equal(out.exitCode, 1);
});

test("24-bug corpus: brain self-reports ok but 24 still failing → incomplete, remaining 24", () => {
  const exec = fakeExec(RED(24));
  const out = finalVerify(exec, "pytest -q", { ok: true, remaining: 0, reason: "" });
  assert.equal(out.status, "incomplete");
  assert.equal(out.remaining, 24);
});

test("host GREEN → ok even if the brain gave up (host is authoritative)", () => {
  const exec = fakeExec(GREEN);
  const out = finalVerify(exec, "pytest -q", { ok: false, remaining: 24, reason: "stalled" });
  assert.equal(out.status, "ok");
  assert.equal(out.remaining, 0);
  assert.equal(out.exitCode, 0);
});

test("no test command → unverified, never ok (no ground truth to assert)", () => {
  const exec = fakeExec(GREEN);
  const out = finalVerify(exec, undefined, { ok: true, remaining: 0, reason: "" });
  assert.equal(out.status, "unverified");
  assert.equal(exec.calls.length, 0); // must NOT run anything when there is no gate
});

test("breaker reason is surfaced through a RED host (stalled/max-turns, not flat incomplete)", () => {
  const stalled = finalVerify(fakeExec(RED(5)), "pytest -q", { ok: false, remaining: 5, reason: "stalled" });
  assert.equal(stalled.status, "stalled");
  const maxTurns = finalVerify(fakeExec(RED(2)), "pytest -q", { ok: false, remaining: 2, reason: "max-turns" });
  assert.equal(maxTurns.status, "max-turns");
});

test("RED with unparseable output falls back to the brain's remaining, not a -1 sentinel", () => {
  const exec = fakeExec({ output: "[exit 1]\nsegfault, no summary line", exitCode: 1 });
  const out = finalVerify(exec, "pytest -q", { ok: false, remaining: 7, reason: "" });
  assert.equal(out.status, "incomplete");
  assert.equal(out.remaining, 7);
});

test("null done (brain never reported) + RED → incomplete with the parsed count", () => {
  const out = finalVerify(fakeExec(RED(3)), "pytest -q", null);
  assert.equal(out.status, "incomplete");
  assert.equal(out.remaining, 3);
});

test("the gate runs the host's own test command via run_tests", () => {
  const exec = fakeExec(GREEN);
  finalVerify(exec, "pytest -q tests/unit", { ok: true, remaining: 0, reason: "" });
  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0]?.name, "run_tests");
  assert.equal(exec.calls[0]?.args["command"], "pytest -q tests/unit");
});

// ── brain ERROR is distinct from brain DONE ─────────────────────────────────
// A `done` event means the brain finished its loop (its self-doubt on a green tree
// is overruled — that is a genuine success). An `error` event means the brain
// CRASHED mid-run; a coincidentally-green tree must NOT be reported as a clean
// success. (Regression guard: the gate used to mask this and exit 0.)
test("brain ERROR + host GREEN → error, never ok (a crashed run is not a success)", () => {
  const exec = fakeExec(GREEN);
  const out = finalVerify(exec, "pytest -q", { ok: false, remaining: 0, reason: "" }, true);
  assert.equal(out.status, "error");
  assert.notEqual(out.exitCode, 0);
});

test("brain ERROR + no test command → error (not unverified)", () => {
  const out = finalVerify(fakeExec(GREEN), undefined, null, true);
  assert.equal(out.status, "error");
});

test("brain ERROR + host RED → error, with the parsed failing count", () => {
  const out = finalVerify(fakeExec(RED(4)), "pytest -q", null, true);
  assert.equal(out.status, "error");
  assert.equal(out.remaining, 4);
});

test("brain DONE self-reporting failure on a green tree stays ok (errored defaults false)", () => {
  // The intentional 'host is authoritative' rule — a COMPLETED brain, not a crash.
  const out = finalVerify(fakeExec(GREEN), "pytest -q", { ok: false, remaining: 9, reason: "stalled" });
  assert.equal(out.status, "ok");
});

// Type-level: BrainDone is the subset of the done event the gate consumes.
test("BrainDone shape is { ok, remaining, reason }", () => {
  const d: BrainDone = { ok: false, remaining: 1, reason: "stalled" };
  assert.equal(d.reason, "stalled");
});
