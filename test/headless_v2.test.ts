import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppContext } from "../src/core/context.js";
import type { Brain, BrainControlResult, TaskCommand } from "../src/core/brain.js";
import type { BrainEvent } from "../src/core/brain_protocol.js";
import type { ToolResult } from "../src/core/tool_executor.js";
import { runHeadlessExec } from "../src/commands/exec.js";
import { BundledChildBrain } from "../src/core/brain_bundled_child.js";
import { OllamaBrain } from "../src/core/brain_ollama.js";
import {
  HEADLESS_CONTROL_PROTOCOL_V2,
  HEADLESS_PROTOCOL,
  HEADLESS_PROTOCOL_V2,
  HEADLESS_V2_MAX_STEERS,
  HeadlessWriter,
  V2ControlLedger,
  parseControlFrame,
  validateHeadlessFrames,
  type ControlFrame,
} from "../src/core/headless_protocol.js";
import {
  HEADLESS_AGENT_PROTOCOL,
  HeadlessCheckpointStore,
  confineWithAgentDefinition,
  loadHeadlessAgentDefinition,
} from "../src/core/headless_session.js";

const successfulVerify = `${JSON.stringify(process.execPath)} -e "process.exit(0)"`;
const doneEvent: BrainEvent = { type: "done", ok: true, result: "done", remaining: 0, reason: "" };

class FakeV2Brain implements Brain {
  readonly tasks: TaskCommand[] = [];
  readonly controls: string[] = [];
  closed = false;

  constructor(private readonly events: readonly BrainEvent[] = [doneEvent]) {}

  async *run(task: TaskCommand): AsyncIterable<BrainEvent> {
    this.tasks.push(task);
    for (const event of this.events) yield event;
  }

  sendToolResult(_id: string, _result: ToolResult): void {}

  control(action: "pause" | "resume" | "steer", note?: string): BrainControlResult {
    this.controls.push(`${action}:${note ?? ""}`);
    return { accepted: true, state: action === "pause" ? "paused" : "running" };
  }

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

function git(root: string, args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8", shell: false, windowsHide: true,
  });
  assert.equal(result.status, 0, String(result.stderr));
  return String(result.stdout).trim();
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "aether-headless-v2-repo-"));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "Aether Test"]);
  git(root, ["config", "user.email", "aether-test@example.invalid"]);
  writeFileSync(join(root, "tracked.txt"), "base\n", "utf8");
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return root;
}

function writeAgent(root: string, name: string, overrides: Record<string, unknown> = {}): string {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify({
    protocol: HEADLESS_AGENT_PROTOCOL,
    version: 1,
    id: "reviewer",
    instructions: "Inspect only the committed workspace.",
    allowed_tools: ["read_file", "repo_search"],
    capability_packs: ["core.read.v1"],
    permission_ceiling: "read-only",
    ...overrides,
  }), "utf8");
  return path;
}

function v2Frame(
  sequence: number,
  action: ControlFrame["action"],
  note?: string,
): ControlFrame {
  return {
    protocol: HEADLESS_CONTROL_PROTOCOL_V2,
    sequence,
    correlation_id: "session-v2",
    action,
    ...(note === undefined ? {} : { note }),
  };
}

test("v2 protocol selection is explicit while the v1 writer remains the default", () => {
  const root = mkdtempSync(join(tmpdir(), "aether-headless-v2-writer-"));
  const lines: string[] = [];
  const writer = new HeadlessWriter(root, (line) => lines.push(line.trimEnd()), "session-v2", HEADLESS_PROTOCOL_V2);
  writer.emit("session", { session: "session-v2" });
  writer.terminal({ ok: true, exit_code: 0 });
  assert.deepEqual(validateHeadlessFrames(lines, HEADLESS_PROTOCOL_V2), []);
  assert.match(validateHeadlessFrames(lines, HEADLESS_PROTOCOL).join(";"), /wrong protocol/);

  assert.equal(parseControlFrame(JSON.stringify(v2Frame(0, "pause")), HEADLESS_CONTROL_PROTOCOL_V2).ok, true);
  assert.deepEqual(
    parseControlFrame(JSON.stringify(v2Frame(0, "pause"))),
    { ok: false, error: "unsupported control protocol" },
  );
});

test("v2 control ledger retries idempotently and does not consume gaps or conflicts", () => {
  const ledger = new V2ControlLedger();
  assert.deepEqual(ledger.begin(v2Frame(1, "pause")), { kind: "rejected", error: "expected control sequence 0" });
  const pause = v2Frame(0, "pause");
  assert.deepEqual(ledger.begin(pause), { kind: "new" });
  ledger.complete(pause, { accepted: true, action: "pause", state: "paused" });
  assert.deepEqual(ledger.begin(pause), {
    kind: "duplicate", outcome: { accepted: true, action: "pause", state: "paused" },
  });
  assert.deepEqual(
    ledger.begin(v2Frame(0, "resume")),
    { kind: "rejected", error: "conflicting duplicate control sequence" },
  );
  assert.deepEqual(ledger.begin(v2Frame(1, "resume")), { kind: "new" });

  const bounded = new V2ControlLedger();
  for (let sequence = 0; sequence < HEADLESS_V2_MAX_STEERS; sequence += 1) {
    const steer = v2Frame(sequence, "steer", `direction-${sequence}`);
    assert.deepEqual(bounded.begin(steer), { kind: "new" });
    bounded.complete(steer, { accepted: true, action: "steer", state: "running" });
  }
  assert.deepEqual(
    bounded.begin(v2Frame(HEADLESS_V2_MAX_STEERS, "steer", "one-too-many")),
    { kind: "rejected", error: "steer budget exceeded" },
  );
});

test("agent definitions are versioned, workspace-confined, expiring authority ceilings", () => {
  const root = repository();
  writeAgent(root, "agent.json");
  const definition = loadHeadlessAgentDefinition(root, "agent.json");
  assert.equal(definition.id, "reviewer");
  assert.match(definition.digest, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => confineWithAgentDefinition(
    "read-only", ["read_file"], ["core.read.v1"], definition,
  ));
  assert.throws(
    () => confineWithAgentDefinition("workspace-write", ["read_file"], ["core.read.v1"], definition),
    /permission exceeds/,
  );
  assert.throws(
    () => confineWithAgentDefinition("read-only", ["write_file"], ["core.read.v1"], definition),
    /outside the agent definition/,
  );

  writeAgent(root, "expired.json", { expires_at: "2000-01-01T00:00:00.000Z" });
  assert.throws(() => loadHeadlessAgentDefinition(root, "expired.json"), /authority is expired/);
  const outside = mkdtempSync(join(tmpdir(), "aether-headless-agent-outside-"));
  const outsidePath = writeAgent(outside, "outside.json");
  assert.throws(() => loadHeadlessAgentDefinition(root, outsidePath), /escapes the workspace/);
});

test("checkpoints resume only under live authority and the exact repository/workspace binding", () => {
  const root = repository();
  const directory = mkdtempSync(join(tmpdir(), "aether-headless-v2-checkpoints-"));
  const store = new HeadlessCheckpointStore(root, directory);
  const created = store.create({
    session: "resume-session",
    task: "continue",
    driver: "selftest",
    model: null,
    modelTag: null,
    effort: "LOW",
    permission: "deny",
    allowedTools: [],
    capabilityPacks: [],
    agent: null,
    verifyCommand: successfulVerify,
    authorityTtlMs: 240_000,
  });
  created.state = "paused";
  created.owner_pid = 2_147_483_647;
  store.write(created);
  const resumed = store.loadForResume("resume-session");
  assert.equal(resumed.generation, 1);
  assert.equal(resumed.state, "running");

  resumed.owner_pid = 2_147_483_647;
  store.write(resumed);
  writeFileSync(join(root, "tracked.txt"), "mutated outside the checkpoint\n", "utf8");
  assert.throws(() => store.loadForResume("resume-session"), /workspace binding is stale/);

  const expiryRoot = repository();
  const expiryStore = new HeadlessCheckpointStore(
    expiryRoot,
    mkdtempSync(join(tmpdir(), "aether-headless-v2-expired-")),
  );
  const expired = expiryStore.create({
    session: "expired-session", task: "continue", driver: "selftest", model: null, modelTag: null,
    effort: null, permission: "deny", allowedTools: [], capabilityPacks: [], agent: null,
    verifyCommand: undefined, authorityTtlMs: 60_000,
  });
  expired.owner_pid = 2_147_483_647;
  expiryStore.write(expired);
  assert.throws(
    () => expiryStore.loadForResume("expired-session", new Date(Date.now() + 120_000)),
    /authority is expired/,
  );
});

test("malformed checkpoint mutations cannot widen authority or alter the recorded task", () => {
  const root = repository();
  const store = new HeadlessCheckpointStore(
    root,
    mkdtempSync(join(tmpdir(), "aether-headless-v2-tamper-")),
  );
  const checkpoint = store.create({
    session: "tamper-session", task: "inspect", driver: "selftest", model: null, modelTag: null,
    effort: null, permission: "read-only", allowedTools: ["read_file"], capabilityPacks: [],
    agent: null, verifyCommand: undefined, authorityTtlMs: 60_000,
  });
  checkpoint.owner_pid = 2_147_483_647;
  checkpoint.permission = "root" as typeof checkpoint.permission;
  store.write(checkpoint);
  assert.throws(() => store.loadForResume("tamper-session"), /checkpoint permission is invalid/);

  checkpoint.permission = "read-only";
  checkpoint.task = "replace the recorded task";
  store.write(checkpoint);
  assert.throws(() => store.loadForResume("tamper-session"), /checkpoint task digest mismatch/);
});

test("a paused checkpoint resumes its recorded task and authority without replacement", async () => {
  const root = repository();
  const directory = mkdtempSync(join(tmpdir(), "aether-headless-v2-resume-"));
  const store = new HeadlessCheckpointStore(root, directory);
  const checkpoint = store.create({
    session: "paused-session", task: "recorded task", driver: "selftest", model: null, modelTag: null,
    effort: "MED", permission: "read-only", allowedTools: ["read_file"],
    capabilityPacks: ["core.read.v1"], agent: null, verifyCommand: successfulVerify,
    authorityTtlMs: 240_000,
  });
  checkpoint.state = "paused";
  checkpoint.owner_pid = 2_147_483_647;
  store.write(checkpoint);

  const brain = new FakeV2Brain();
  const lines: string[] = [];
  const code = await runHeadlessExec(context(root), "", {
    permission: "deny", allowedTools: [], capabilityPacks: [], timeoutMs: 60_000,
    verifyCommand: successfulVerify, brain, driver: "ollama", protocol: HEADLESS_PROTOCOL_V2,
    checkpointDirectory: directory, resume: "paused-session",
    writeLine: (line) => lines.push(line.trimEnd()),
  });
  assert.equal(code, 0);
  assert.equal(brain.tasks[0]?.text, "recorded task");
  const session = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal((session["checkpoint"] as Record<string, unknown>)["resumed"], true);
  assert.equal((session["permissions"] as Record<string, unknown>)["mode"], "read-only");
  assert.deepEqual(session["tools"], ["read_file"]);
});

test("v2 emits one terminal and records successful verification against one immutable workspace identity", async () => {
  const root = repository();
  writeAgent(root, "agent.json", { permission_ceiling: "deny", allowed_tools: [], capability_packs: [] });
  const directory = mkdtempSync(join(tmpdir(), "aether-headless-v2-checkpoints-"));
  const brain = new FakeV2Brain();
  const lines: string[] = [];
  const code = await runHeadlessExec(context(root), "inspect", {
    permission: "deny",
    allowedTools: [],
    capabilityPacks: [],
    timeoutMs: 60_000,
    verifyCommand: successfulVerify,
    brain,
    driver: "selftest",
    protocol: HEADLESS_PROTOCOL_V2,
    agentDefinition: "agent.json",
    checkpointDirectory: directory,
    sessionId: "verified-session",
    writeLine: (line) => lines.push(line.trimEnd()),
  });
  assert.equal(code, 0);
  assert.deepEqual(validateHeadlessFrames(lines, HEADLESS_PROTOCOL_V2), []);
  const frames = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(frames.filter((frame) => frame["type"] === "terminal").length, 1);
  assert.equal(frames.find((frame) => frame["type"] === "verification")?.["commit_bound"], true);
  assert.match(brain.tasks[0]?.text ?? "", /Confined agent definition reviewer@1/);
  const checkpoint = JSON.parse(readFileSync(join(directory, "verified-session.json"), "utf8")) as Record<string, unknown>;
  assert.equal(checkpoint["state"], "completed");
  assert.equal(checkpoint["terminal_exit_code"], 0);
  assert.equal((checkpoint["verification"] as Record<string, unknown>)["status"], "ok");
});

test("v2 fails closed when verification mutates the workspace it claims to verify", async () => {
  const root = repository();
  const directory = mkdtempSync(join(tmpdir(), "aether-headless-v2-checkpoints-"));
  const mutation = "require('node:fs').writeFileSync('tracked.txt', 'changed by verification\\n')";
  const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(mutation)}`;
  const lines: string[] = [];
  const code = await runHeadlessExec(context(root), "inspect", {
    permission: "deny", allowedTools: [], capabilityPacks: [], timeoutMs: 60_000,
    verifyCommand: command, brain: new FakeV2Brain(), driver: "selftest",
    protocol: HEADLESS_PROTOCOL_V2, checkpointDirectory: directory, sessionId: "mutated-session",
    writeLine: (line) => lines.push(line.trimEnd()),
  });
  assert.equal(code, 1);
  assert.deepEqual(validateHeadlessFrames(lines, HEADLESS_PROTOCOL_V2), []);
  const verification = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((frame) => frame["type"] === "verification");
  assert.equal(verification?.["status"], "error");
  assert.equal(verification?.["commit_bound"], false);
  const checkpoint = JSON.parse(readFileSync(join(directory, "mutated-session.json"), "utf8")) as Record<string, unknown>;
  assert.equal((checkpoint["verification"] as Record<string, unknown>)["status"], "unattributable");
});

test("bundled selftest child forwards pause and resume with truthful acknowledgements", async () => {
  const brain = new BundledChildBrain({ mode: "selftest" });
  try {
    const iterator = brain.run({ type: "task", text: "wire check", cwd: repository(), poolGb: 1 })[Symbol.asyncIterator]();
    const stage = await iterator.next();
    assert.equal(stage.value?.type, "stage");
    assert.deepEqual(await brain.control("pause"), { accepted: true, state: "paused" });
    const pending = iterator.next();
    const whilePaused = await Promise.race([
      pending.then(() => "event"),
      new Promise<"paused">((resolvePaused) => setTimeout(() => resolvePaused("paused"), 150)),
    ]);
    assert.equal(whilePaused, "paused");
    assert.deepEqual(await brain.control("resume"), { accepted: true, state: "running" });
    const done = await pending;
    assert.equal(done.value?.type, "done");
  } finally {
    brain.close();
  }
});

test("the public v2 stream correlates, deduplicates, reorders, resumes, and cancels controls deterministically", async () => {
  const root = repository();
  const config = mkdtempSync(join(tmpdir(), "aether-headless-v2-config-"));
  const child = spawn(process.execPath, [
    join(process.cwd(), "dist", "src", "main.js"), "exec", "--cwd", root,
    "--exec-protocol", "2", "--exec-driver", "selftest", "--permission", "read-only",
    "--test-cmd", successfulVerify, "control integration",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, AETHER_CONFIG_DIR: config },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  let remainder = "";
  let sent = false;
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    remainder += chunk;
    const parts = remainder.split(/\r?\n/);
    remainder = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.trim() || sent) continue;
      const frame = JSON.parse(line) as Record<string, unknown>;
      if (frame["type"] !== "session") continue;
      sent = true;
      const session = String(frame["session"]);
      const controls = [
        { sequence: 0, action: "pause" },
        { sequence: 0, action: "pause" },
        { sequence: 2, action: "resume" },
        { sequence: 1, action: "resume" },
        { sequence: 2, action: "cancel" },
      ].map((control) => JSON.stringify({
        protocol: HEADLESS_CONTROL_PROTOCOL_V2,
        correlation_id: session,
        ...control,
      })).join("\n");
      child.stdin.end(`${controls}\n`);
    }
  });
  const status = await new Promise<number | null>((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", resolveClose);
  });
  assert.equal(status, 130, stderr);
  const frames = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(validateHeadlessFrames(stdout.trim().split(/\r?\n/), HEADLESS_PROTOCOL_V2), []);
  const results = frames.filter((frame) => frame["type"] === "control_result");
  assert.equal(results.length, 5);
  assert.deepEqual(
    results.map((frame) => [frame["action"], frame["accepted"], frame["duplicate"] ?? false]),
    [
      ["pause", true, false],
      ["pause", true, true],
      ["resume", false, false],
      ["resume", true, false],
      ["cancel", true, false],
    ],
  );
  assert.match(String(results[2]?.["error"]), /expected control sequence 1/);
  assert.equal(frames.filter((frame) => frame["type"] === "terminal").length, 1);
  assert.equal(frames.at(-1)?.["exit_code"], 130);
});

test("Ollama pause gates in-flight output and accepted steering gets a fresh turn", async () => {
  let releaseFirst!: () => void;
  let startedFirst!: () => void;
  const started = new Promise<void>((resolveStarted) => { startedFirst = resolveStarted; });
  const gate = new Promise<void>((resolveGate) => { releaseFirst = resolveGate; });
  const calls: string[][] = [];
  const brain = new OllamaBrain({
    maxTurns: 2,
    tools: [],
    chat: async (messages) => {
      calls.push(messages.map((message) => message.content));
      if (calls.length === 1) {
        startedFirst();
        await gate;
        return {
          role: "assistant",
          content: "stale answer",
          tool_calls: [{ id: "stale-write", type: "function" as const, function: { name: "write_file", arguments: "{}" } }],
        };
      }
      return { role: "assistant", content: "steered answer" };
    },
  });
  const iterator = brain.run({ type: "task", text: "inspect", cwd: ".", poolGb: 1 })[Symbol.asyncIterator]();
  await started;
  assert.deepEqual(brain.control("pause"), { accepted: true, state: "paused" });
  releaseFirst();
  const pending = iterator.next();
  const whilePaused = await Promise.race([
    pending.then(() => "event"),
    new Promise<"paused">((resolvePaused) => setTimeout(() => resolvePaused("paused"), 30)),
  ]);
  assert.equal(whilePaused, "paused");
  assert.deepEqual(brain.control("steer", "focus on the caller"), { accepted: true, state: "paused" });
  assert.deepEqual(brain.control("resume"), { accepted: true, state: "running" });
  const monologue = await pending;
  assert.equal(monologue.value?.type, "monologue");
  assert.equal(monologue.value?.type === "monologue" ? monologue.value.text : "", "steered answer");
  const done = await iterator.next();
  assert.equal(done.value?.type, "done");
  assert.equal(done.value?.type === "done" ? done.value.ok : false, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.some((message) => message.includes("[Operator steering]\nfocus on the caller")), true);
});

test("steering accepted at the turn boundary cannot be reported as successful without processing", async () => {
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolveReady) => { started = resolveReady; });
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  const brain = new OllamaBrain({
    maxTurns: 1,
    tools: [],
    chat: async () => {
      started();
      await gate;
      return { role: "assistant", content: "stale" };
    },
  });
  const iterator = brain.run({ type: "task", text: "inspect", cwd: ".", poolGb: 1 })[Symbol.asyncIterator]();
  await ready;
  assert.equal(brain.control("steer", "late direction").accepted, true);
  release();
  const done = await iterator.next();
  assert.equal(done.value?.type, "done");
  assert.equal(done.value?.type === "done" ? done.value.ok : true, false);
  assert.equal(done.value?.type === "done" ? done.value.reason : "", "max-turns");
});
