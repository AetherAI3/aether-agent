import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LineBuffer,
  encodeCommand,
  parseEventLine,
  PROTOCOL_VERSION,
  type BrainEvent,
} from "../src/core/brain_protocol.js";
import { ToolExecutor } from "../src/core/tool_executor.js";
import { EventQueue, type Brain, type TaskCommand } from "../src/core/brain.js";
import { hostLoop, cmdCode } from "../src/commands/code.js";
import type { AppContext } from "../src/core/context.js";

// The fixture is a source asset (not compiled); resolve it from the repo root.
// Compiled location is dist/test/bridge.test.js -> ../.. = repo root.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = join(REPO_ROOT, "test", "fixtures", "bridge_conformance.json");

// --- protocol codec --------------------------------------------------------
test("decodeEvent maps snake_case wire keys to camelCase", () => {
  const ev = parseEventLine('{"type":"status","phase":"grounding","pool_used":100,"pool_cap":500}');
  assert.deepEqual(ev, { type: "status", phase: "grounding", poolUsed: 100, poolCap: 500 });
});

test("decodeEvent reads the skill event", () => {
  const ev = parseEventLine('{"type":"skill","name":"fix-failing-tests","reason":"trigger matched"}');
  assert.deepEqual(ev, { type: "skill", name: "fix-failing-tests", reason: "trigger matched" });
});

test("checkpoint event maps git_sha", () => {
  const ev = parseEventLine('{"type":"checkpoint","git_sha":"a1b2c3d4e5"}');
  assert.deepEqual(ev, { type: "checkpoint", gitSha: "a1b2c3d4e5" });
});

test("turn event maps the per-turn diag fields (null fail_count preserved)", () => {
  const ev = parseEventLine(
    '{"type":"turn","n":4,"tool_calls":2,"malformed":1,"invented":0,"no_call":false,"fail_count":null}',
  );
  assert.deepEqual(ev, {
    type: "turn",
    n: 4,
    toolCalls: 2,
    malformed: 1,
    invented: 0,
    noCall: false,
    failCount: null,
  });
});

test("done carries remaining + reason (ground-truth finalStatus)", () => {
  const ev = parseEventLine('{"type":"done","ok":false,"result":"(incomplete — 24 failing)","remaining":24,"reason":"stalled"}');
  assert.deepEqual(ev, {
    type: "done",
    ok: false,
    result: "(incomplete — 24 failing)",
    remaining: 24,
    reason: "stalled",
  });
});

test("parseEventLine drops blanks and malformed lines", () => {
  assert.equal(parseEventLine(""), null);
  assert.equal(parseEventLine("   "), null);
  assert.equal(parseEventLine("not json"), null);
  assert.equal(parseEventLine('{"no":"type"}'), null);
});

test("encodeCommand writes snake_case wire keys + newline", () => {
  const line = encodeCommand({ type: "tool_result", id: "c1", output: "[exit 0]", exitCode: 0 });
  assert.ok(line.endsWith("\n"));
  assert.deepEqual(JSON.parse(line), { type: "tool_result", id: "c1", output: "[exit 0]", exit_code: 0 });
});

test("encodeCommand task carries pool_gb", () => {
  const line = encodeCommand({ type: "task", text: "fix", cwd: ".", poolGb: 10 });
  assert.equal(JSON.parse(line).pool_gb, 10);
});

// --- NDJSON line buffer (partial-line framing) -----------------------------
test("LineBuffer reassembles a JSON object split across chunks", () => {
  const lb = new LineBuffer();
  assert.deepEqual(lb.push('{"type":"sta'), []);
  assert.deepEqual(lb.push('ge","name":"execute","face":""}\n'), [
    '{"type":"stage","name":"execute","face":""}',
  ]);
  assert.equal(lb.rest(), "");
});

test("LineBuffer yields multiple complete lines in one chunk", () => {
  const lb = new LineBuffer();
  const lines = lb.push('{"a":1}\n{"b":2}\n{"c":3');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  assert.equal(lb.rest(), '{"c":3');
});

// --- tool executor (one path-guard, [exit N] shape) ------------------------
test("ToolExecutor writes then reads a file in the workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-tool-"));
  try {
    const ex = new ToolExecutor(dir);
    const w = ex.execute("write_file", { path: "a.txt", content: "hello" });
    assert.equal(w.exitCode, 0);
    assert.match(w.output, /\[wrote a\.txt/);
    assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "hello");
    const r = ex.execute("read_file", { path: "a.txt" });
    assert.equal(r.output, "hello");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ToolExecutor refuses a path escaping the workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-tool-"));
  try {
    const ex = new ToolExecutor(dir);
    const r = ex.execute("read_file", { path: "../../etc/passwd" });
    assert.equal(r.exitCode, 1);
    assert.match(r.output, /refusing path outside workspace/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown tool returns a clear error, never throws", () => {
  const ex = new ToolExecutor(tmpdir());
  const r = ex.execute("frobnicate", {});
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /unknown tool/);
});

// --- host loop: a fake brain round-trips one tool call ---------------------
class FakeBrain implements Brain {
  private readonly q = new EventQueue();
  readonly toolResults: Array<{ id: string; output: string; exitCode: number }> = [];
  closed = false;

  run(_task: TaskCommand): AsyncIterable<BrainEvent> {
    // Emit a tool_call; the host will execute it and call sendToolResult, which
    // unblocks the rest of the script.
    this.q.push({ type: "stage", name: "execute", face: "" });
    this.q.push({ type: "tool_call", id: "c1", name: "write_file", args: { path: "x.txt", content: "hi" } });
    return this.q.drain();
  }
  sendToolResult(id: string, result: { output: string; exitCode: number }): void {
    this.toolResults.push({ id, output: result.output, exitCode: result.exitCode });
    // The brain "decides" it's done after the tool result lands.
    this.q.push({ type: "done", ok: true, result: "wrote x.txt", remaining: 0, reason: "" });
    this.q.end();
  }
  control(): void {}
  close(): void {
    this.closed = true;
  }
}

test("hostLoop executes a tool_call and feeds the result back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-host-"));
  try {
    const brain = new FakeBrain();
    const exec = new ToolExecutor(dir);
    const seen: string[] = [];
    const code = await hostLoop(brain, exec, (ev) => {
      seen.push(ev.type);
    }, {
      type: "task",
      text: "write x.txt",
      cwd: dir,
      poolGb: 5,
    });
    assert.equal(code, 0);
    assert.equal(brain.closed, true);
    assert.equal(brain.toolResults.length, 1);
    assert.equal(brain.toolResults[0]?.exitCode, 0);
    assert.equal(readFileSync(join(dir, "x.txt"), "utf8"), "hi");
    assert.deepEqual(seen, ["stage", "tool_call", "done"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- probe 1: two sequential tool calls stay correlated --------------------
class TwoCallBrain implements Brain {
  private readonly q = new EventQueue();
  readonly pairs: Array<{ id: string; output: string }> = [];
  private step = 0;
  run(_task: TaskCommand): AsyncIterable<BrainEvent> {
    this.q.push({ type: "tool_call", id: "A", name: "read_file", args: { path: "a.txt" } });
    return this.q.drain();
  }
  sendToolResult(id: string, result: { output: string; exitCode: number }): void {
    this.pairs.push({ id, output: result.output });
    this.step += 1;
    if (this.step === 1) {
      this.q.push({ type: "tool_call", id: "B", name: "read_file", args: { path: "b.txt" } });
    } else {
      this.q.push({ type: "done", ok: true, result: "ok", remaining: 0, reason: "" });
      this.q.end();
    }
  }
  control(): void {}
  close(): void {}
}

test("two sequential tool calls: each result pairs to its own id, in order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-corr-"));
  try {
    const exec = new ToolExecutor(dir);
    exec.execute("write_file", { path: "a.txt", content: "AAA" });
    exec.execute("write_file", { path: "b.txt", content: "BBB" });
    const brain = new TwoCallBrain();
    await hostLoop(brain, exec, () => {}, { type: "task", text: "read both", cwd: dir, poolGb: 5 });
    assert.deepEqual(
      brain.pairs.map((p) => p.id),
      ["A", "B"],
    );
    assert.equal(brain.pairs[0]?.output, "AAA"); // A's result is a.txt, not b.txt
    assert.equal(brain.pairs[1]?.output, "BBB");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- probe 2: path-guard canonicalization (the security boundary) ----------
test("path-guard rejects traversal, absolute, and symlink escapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-guard-"));
  const outside = mkdtempSync(join(tmpdir(), "aether-outside-"));
  try {
    const ex = new ToolExecutor(dir);
    // .. traversal
    assert.match(ex.execute("read_file", { path: "../../etc/passwd" }).output, /refusing path/);
    // absolute path outside the workspace
    assert.match(ex.execute("read_file", { path: join(outside, "x") }).output, /refusing path/);
    // symlink inside the workspace pointing outside it
    let linked = false;
    try {
      symlinkSync(outside, join(dir, "link"), "dir");
      linked = true;
    } catch {
      // symlink may need privilege on Windows — skip that leg if unavailable
    }
    if (linked) {
      const r = ex.execute("write_file", { path: "link/escaped.txt", content: "x" });
      assert.match(r.output, /refusing path/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// --- probe 3: shell hardening (non-zero exit + stderr reach the brain) ------
test("run_shell surfaces a non-zero exit code and captures stderr", () => {
  const ex = new ToolExecutor(mkdtempSync(join(tmpdir(), "aether-sh-")));
  const r = ex.execute("run_shell", {
    command: `node -e "process.stderr.write('boom'); process.exit(3)"`,
  });
  assert.equal(r.exitCode, 3);
  assert.match(r.output, /^\[exit 3\]/);
  assert.match(r.output, /boom/);
});

// --- probe 4: schema conformance (drift detector) --------------------------
test("PROTOCOL_VERSION matches the shared fixture", () => {
  const fx = JSON.parse(readFileSync(FIXTURE, "utf8"));
  assert.equal(fx.protocol_version, PROTOCOL_VERSION);
});

test("every fixture event decodes to its declared type", () => {
  const fx = JSON.parse(readFileSync(FIXTURE, "utf8"));
  for (const ev of fx.events) {
    const decoded = parseEventLine(JSON.stringify(ev));
    assert.ok(decoded, `event did not decode: ${ev.type}`);
    assert.equal(decoded?.type, ev.type);
  }
  // every host command re-encodes with snake_case wire keys
  for (const cmd of fx.commands) {
    const wire = JSON.parse(encodeCommand(cmd));
    assert.equal(wire.type, cmd.type);
  }
});

// --- swarm is gated (never swarm an unproven loop) -------------------------
test("--swarm > 1 is refused with exit 2 and never spawns a brain", async () => {
  const ctx = {
    cfg: {},
    api: {},
    tokens: {},
    flags: { json: false, audit: false, yes: false, cwd: process.cwd() },
  } as unknown as AppContext;
  const orig = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = ((s: string) => ((captured += s), true)) as typeof process.stderr.write;
  try {
    const code = await cmdCode(ctx, "fix all the things", { local: true, pool: 5, quiet: true, swarm: 4 });
    assert.equal(code, 2);
    assert.match(captured, /--swarm is gated/);
    assert.match(captured, /SWARM_PLAN\.md/);
  } finally {
    process.stderr.write = orig;
  }
});

// --- probe 5: escaping lossless (CJK + emoji survive an ASCII-escaped line) -
test("unicode survives an ASCII-escaped wire line", () => {
  const fx = JSON.parse(readFileSync(FIXTURE, "utf8"));
  for (const s of [...fx.unicode_round_trip, "日本語テスト", "🤖🔥"]) {
    // simulate the Python side: ensure_ascii escaping, then the host decodes it
    const asciiLine = JSON.stringify({ type: "monologue", text: s, depth: 0 });
    const ev = parseEventLine(asciiLine);
    assert.equal(ev?.type === "monologue" ? ev.text : null, s);
  }
});
