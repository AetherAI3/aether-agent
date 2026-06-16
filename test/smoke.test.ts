// Tests for the aether-code terminal smoke runner (src/core/smoke.ts).
// Pure logic only — no real Ollama, no network. IO checks use injected fakes.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runChecks,
  drainTurn,
  checkSsrf,
  checkLocalTurn,
  checkAuth,
  checkCloudTurn,
  checkWebSearch,
  checkWebFetch,
} from "../src/core/smoke.js";
import type { Brain, TaskCommand } from "../src/core/brain.js";
import type { BrainEvent } from "../src/core/brain_protocol.js";
import type { ToolResult } from "../src/core/tool_executor.js";
import { StaticTokenStore } from "../src/core/auth.js";

function fakeBrain(events: readonly BrainEvent[]): Brain {
  return {
    run(_t: TaskCommand): AsyncIterable<BrainEvent> {
      return (async function* () {
        for (const e of events) yield e;
      })();
    },
    sendToolResult(): void {},
    control(): void {},
    close(): void {},
  };
}

const noExec = { executeAsync: async (): Promise<ToolResult> => ({ output: "", exitCode: 0 }) };

test("runChecks returns 0 when no fail", () => {
  let out = "";
  const rc = runChecks(
    [
      { name: "a", status: "PASS", detail: "" },
      { name: "b", status: "SKIP", detail: "" },
    ],
    (s) => {
      out += s;
    },
  );
  assert.equal(rc, 0);
  assert.match(out, /PASS/);
  assert.match(out, /SKIP/);
});

test("runChecks returns 1 on any fail", () => {
  const rc = runChecks(
    [
      { name: "a", status: "PASS", detail: "" },
      { name: "b", status: "FAIL", detail: "boom" },
    ],
    () => {},
  );
  assert.equal(rc, 1);
});

test("checkSsrf passes by refusing internal targets", () => {
  const c = checkSsrf();
  assert.equal(c.status, "PASS", c.detail);
});

test("drainTurn collects done text", async () => {
  const b = fakeBrain([
    { type: "monologue", text: "thinking", depth: 0 },
    { type: "done", ok: true, result: "pong", remaining: 0, reason: "" },
  ]);
  const r = await drainTurn(b, noExec);
  assert.equal(r.ok, true);
  assert.match(r.text, /pong/);
});

test("drainTurn reports error event", async () => {
  const b = fakeBrain([{ type: "error", msg: "model exploded" }]);
  const r = await drainTurn(b, noExec);
  assert.equal(r.ok, false);
  assert.match(r.err, /model exploded/);
});

test("checkLocalTurn skips when ollama down", async () => {
  const c = await checkLocalTurn("http://localhost:11434", "m", { up: async () => false });
  assert.equal(c.status, "SKIP");
  assert.match(c.detail.toLowerCase(), /ollama/);
});

test("checkLocalTurn passes with injected brain", async () => {
  const b = fakeBrain([{ type: "done", ok: true, result: "pong", remaining: 0, reason: "" }]);
  const c = await checkLocalTurn("http://localhost:11434", "m", {
    up: async () => true,
    brain: b,
    exec: noExec,
  });
  assert.equal(c.status, "PASS");
});

test("checkAuth reports logged out", async () => {
  const c = await checkAuth("https://api.aethersystems.net/cloud", new StaticTokenStore(""));
  assert.equal(c.status, "PASS");
  assert.match(c.detail.toLowerCase(), /not signed in/);
});

test("checkCloudTurn skips when logged out", async () => {
  const c = await checkCloudTurn("https://api.aethersystems.net/cloud", "m", new StaticTokenStore(""));
  assert.equal(c.status, "SKIP");
  assert.match(c.detail.toLowerCase(), /auth login/);
});

test("checkWebSearch passes on results, skips on error", async () => {
  const pass = await checkWebSearch(async () => "1. Title\n   https://x\n   snippet");
  assert.equal(pass.status, "PASS");
  const skip = await checkWebSearch(async () => "[web_search error: offline]");
  assert.equal(skip.status, "SKIP");
});

test("checkWebFetch passes on text, skips on error, fails on wrong refusal", async () => {
  const pass = await checkWebFetch(async () => "Example Domain — for documentation");
  assert.equal(pass.status, "PASS");
  const skip = await checkWebFetch(async () => "[web_fetch error: offline]");
  assert.equal(skip.status, "SKIP");
  const fail = await checkWebFetch(async () => "[web_fetch refused: loopback]");
  assert.equal(fail.status, "FAIL");
});
