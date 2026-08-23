import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Brain, TaskCommand } from "../src/core/brain.js";
import type { BrainEvent } from "../src/core/brain_protocol.js";
import type { ToolResult } from "../src/core/tool_executor.js";
import type { AppContext } from "../src/core/context.js";
import {
  ControlLedger,
  HEADLESS_CONTROL_PROTOCOL,
  HEADLESS_MAX_LINE_BYTES,
  HeadlessWriter,
  parseControlFrame,
  validateHeadlessFrames,
} from "../src/core/headless_protocol.js";
import { runHeadlessExec } from "../src/commands/exec.js";

class FakeBrain implements Brain {
  readonly results: Array<{ id: string; result: ToolResult }> = [];
  readonly controls: string[] = [];
  closed = false;
  constructor(private readonly events: readonly BrainEvent[]) {}
  async *run(_task: TaskCommand): AsyncIterable<BrainEvent> { for (const event of this.events) yield event; }
  sendToolResult(id: string, result: ToolResult): void { this.results.push({ id, result }); }
  control(action: "pause" | "resume" | "steer", note?: string): void { this.controls.push(`${action}:${note ?? ""}`); }
  close(): void { this.closed = true; }
}

function context(cwd: string): AppContext {
  return {
    cfg: {
      baseUrl: "http://invalid.local", defaultModel: "local-test", permissionMode: "ask",
      autoApply: false, telemetry: false, defaultEffort: "LOW", backend: "local",
    },
    api: {} as AppContext["api"], tokens: {} as AppContext["tokens"],
    flags: { json: false, audit: false, yes: false, cwd }, confirm: async () => false,
  };
}

test("writer sequences frames, redacts secrets, bounds large payloads, and writes terminal once", () => {
  const root = mkdtempSync(join(tmpdir(), "aether-headless-"));
  const lines: string[] = [];
  const writer = new HeadlessWriter(root, (line) => lines.push(line.trimEnd()), "session-test");
  writer.emit("session", { token: "top-secret", message: "Bearer abcdefghijklmnop" });
  const bounded = writer.emit("result", { output: "x".repeat(HEADLESS_MAX_LINE_BYTES * 2) });
  writer.terminal({ ok: true });
  assert.equal(writer.terminal({ ok: false }), null);
  assert.deepEqual(validateHeadlessFrames(lines), []);
  assert.equal(JSON.parse(lines[0]!).token, "[REDACTED]");
  assert.equal(JSON.parse(lines[0]!).message, "[REDACTED]");
  assert.equal(bounded["payload_bounded"], true);
  const artifact = (bounded["artifact"] as { path: string }).path;
  assert.match(readFileSync(join(root, artifact), "utf8"), /"output": "x+/);
});

test("frame validator catches malformed, duplicate, truncated, and duplicate-terminal streams", () => {
  assert.match(validateHeadlessFrames(["{"]).join(";"), /malformed JSON.*missing terminal/);
  const duplicate = [
    JSON.stringify({ protocol: "aether.exec/1", sequence: 0, correlation_id: "x", type: "session" }),
    JSON.stringify({ protocol: "aether.exec/1", sequence: 0, correlation_id: "x", type: "terminal" }),
  ];
  assert.match(validateHeadlessFrames(duplicate).join(";"), /expected sequence 1/);
  assert.match(validateHeadlessFrames(duplicate.slice(0, 1)).join(";"), /missing terminal/);
  const after = [...duplicate.slice(0, 1),
    JSON.stringify({ protocol: "aether.exec/1", sequence: 1, correlation_id: "x", type: "terminal" }),
    JSON.stringify({ protocol: "aether.exec/1", sequence: 2, correlation_id: "x", type: "terminal" }),
  ];
  assert.match(validateHeadlessFrames(after).join(";"), /duplicate terminal frame/);
});

test("controls are versioned and reject duplicates and commands after cancellation", () => {
  assert.deepEqual(parseControlFrame("{"), { ok: false, error: "malformed JSON" });
  const make = (sequence: number, action: "cancel" | "steer") => ({
    protocol: HEADLESS_CONTROL_PROTOCOL, sequence, correlation_id: "controller", action,
  } as const);
  const parsed = parseControlFrame(JSON.stringify(make(0, "cancel")));
  assert.equal(parsed.ok, true);
  const ledger = new ControlLedger();
  assert.deepEqual(ledger.accept((parsed as { ok: true; frame: ReturnType<typeof make> }).frame), { accepted: true });
  assert.deepEqual(ledger.accept(make(0, "cancel")), { accepted: false, error: "duplicate control sequence" });
  assert.deepEqual(ledger.accept(make(1, "steer")), { accepted: false, error: "session cancelled" });
});

test("undeclared tools and permission escalation are denied with receipts", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-headless-"));
  const brain = new FakeBrain([
    { type: "tool_call", id: "u1", name: "write_file", args: { path: "x", content: "x" } },
    { type: "tool_call", id: "u2", name: "run_shell", args: { command: "echo nope" } },
    { type: "tool_call", id: "u3", name: "read_file", args: { path: "../outside" } },
    { type: "tool_call", id: "u4", name: "web_fetch", args: { url: "https://example.com" } },
    { type: "done", ok: true, result: "done", remaining: 0, reason: "" },
  ]);
  const lines: string[] = [];
  const code = await runHeadlessExec(context(root), "inspect", {
    permission: "workspace-write", allowedTools: ["run_shell", "read_file", "web_fetch"], capabilityPacks: ["test"],
    timeoutMs: 5000, verifyCommand: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`,
    brain, writeLine: (line) => lines.push(line.trimEnd()), sessionId: "fixed",
  });
  assert.equal(code, 0);
  assert.match(brain.results[0]!.result.output, /undeclared-tool/);
  assert.match(brain.results[1]!.result.output, /permission-escalation/);
  assert.match(brain.results[2]!.result.output, /outside workspace/);
  assert.match(brain.results[3]!.result.output, /network-disabled/);
  assert.equal(lines.filter((line) => JSON.parse(line).type === "terminal").length, 1);
  assert.deepEqual(validateHeadlessFrames(lines), []);
});

test("failed or absent authoritative verification can never exit zero", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-headless-"));
  const event: BrainEvent = { type: "done", ok: true, result: "claimed success", remaining: 0, reason: "" };
  const failed = await runHeadlessExec(context(root), "task", {
    permission: "deny", allowedTools: [], capabilityPacks: [], timeoutMs: 5000,
    verifyCommand: `${JSON.stringify(process.execPath)} -e "process.exit(7)"`, brain: new FakeBrain([event]), writeLine: () => {},
  });
  const absent = await runHeadlessExec(context(root), "task", {
    permission: "deny", allowedTools: [], capabilityPacks: [], timeoutMs: 5000,
    brain: new FakeBrain([event]), writeLine: () => {},
  });
  assert.equal(failed, 1);
  assert.equal(absent, 4);
});
