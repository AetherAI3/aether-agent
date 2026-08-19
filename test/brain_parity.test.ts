// Canary 7 — local/Ollama brain parity.
//
// The last of the seven, and the one that stayed unwritable longest: LocalBrain
// spawned a Python module with no injectable transport, so no test could drive
// it. With a spawner seam it becomes a fake child speaking the same line
// protocol, and the two local brains can finally be compared.
//
// What parity means here is NOT that they emit identical events — Ollama is a
// pure-TypeScript loop and the Python path has a much richer vocabulary. It
// means a host driving either one sees the same SHAPE: the same tool calls in
// the same order, each carrying an id it can reply to, terminated by exactly
// one done. A host loop must not need to know which brain it is talking to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { LocalBrain } from "../src/core/brain_local.js";
import { OllamaBrain } from "../src/core/brain_ollama.js";
import type { Brain, TaskCommand } from "../src/core/brain.js";
import type { BrainEvent } from "../src/core/brain_protocol.js";
import type { ChatMessage, ChatReply } from "../src/core/ollama.js";

const task: TaskCommand = { type: "task", text: "fix the bug", cwd: process.cwd(), poolGb: 5 };

/**
 * A fake brain subprocess: reads host commands off stdin and answers on stdout
 * in the same newline-delimited JSON the Python brain speaks, so LocalBrain
 * cannot tell it apart from the real child.
 */
function scriptedChild(script: (line: string, say: (event: unknown) => void) => void) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    kill(): void;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = (): void => {
    child.killed = true;
    child.stdout.end();
    // A real child emits close when it exits, and LocalBrain ends its stream on
    // that. A fake that skips it hangs the consumer — which is the bug this
    // test exists to catch, so the fake has to be faithful about it.
    queueMicrotask(() => child.emit("close", 0, null));
  };

  const say = (event: unknown): void => {
    child.stdout.write(JSON.stringify(event) + "\n");
  };

  let buffered = "";
  child.stdin.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    let at = buffered.indexOf("\n");
    while (at !== -1) {
      const line = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      if (line.trim()) script(line, say);
      at = buffered.indexOf("\n");
    }
  });

  return child;
}

/** The normalized transcript a host sees: what it must act on, nothing else. */
interface HostView {
  toolCalls: Array<{ name: string; hasId: boolean }>;
  doneCount: number;
  finalOk: boolean;
}

async function driveHost(brain: Brain): Promise<HostView> {
  const view: HostView = { toolCalls: [], doneCount: 0, finalOk: false };
  for await (const event of brain.run(task)) {
    if (event.type === "tool_call") {
      view.toolCalls.push({ name: event.name, hasId: typeof event.id === "string" && event.id.length > 0 });
      brain.sendToolResult(event.id, { output: "[exit 0]\nok", exitCode: 0 });
    }
    if (event.type === "done") {
      view.doneCount += 1;
      view.finalOk = event.ok;
    }
  }
  brain.close();
  return view;
}

async function viaLocal(): Promise<HostView> {
  const child = scriptedChild((line, say) => {
    const cmd = JSON.parse(line) as { type: string };
    if (cmd.type === "task") {
      say({ type: "tool_call", id: "c1", name: "read_file", args: { path: "a.ts" } });
      return;
    }
    if (cmd.type === "tool_result") {
      say({ type: "done", ok: true, result: "done", remaining: 0, reason: "" });
    }
  });
  return driveHost(new LocalBrain({ spawn: () => child as never }));
}

async function viaOllama(): Promise<HostView> {
  const replies: ChatReply[] = [
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }],
    },
    { role: "assistant", content: "done" },
  ];
  let i = 0;
  const chat = async (_m: readonly ChatMessage[]): Promise<ChatReply> =>
    replies[Math.min(i++, replies.length - 1)] ?? { role: "assistant", content: "" };
  return driveHost(new OllamaBrain({ chat }));
}

test("canary 7: both local brains present the same shape to a host loop", async () => {
  const local = await viaLocal();
  const ollama = await viaOllama();

  assert.deepEqual(
    local.toolCalls.map((call) => call.name),
    ollama.toolCalls.map((call) => call.name),
    "the same tool calls, in the same order",
  );
  assert.deepEqual(local, ollama, "a host must not be able to tell the two apart from its own transcript");
});

test("canary 7: every tool_call from either brain carries a replyable id", async () => {
  for (const [label, view] of [
    ["local", await viaLocal()],
    ["ollama", await viaOllama()],
  ] as const) {
    assert.ok(view.toolCalls.length > 0, `${label} produced no tool call`);
    for (const call of view.toolCalls) {
      assert.equal(call.hasId, true, `${label} emitted a tool_call with no id to reply to`);
    }
  }
});

test("canary 7: each brain terminates with exactly one done", async () => {
  for (const [label, view] of [
    ["local", await viaLocal()],
    ["ollama", await viaOllama()],
  ] as const) {
    assert.equal(view.doneCount, 1, `${label} did not terminate with exactly one done`);
  }
});

test("canary 7: a brain that dies without a done still ends its stream", async () => {
  // The failure this guards is a hang, not a wrong value: a host awaiting a
  // terminal event that never arrives waits forever.
  const child = scriptedChild(() => {
    /* answers nothing */
  });
  const brain = new LocalBrain({ spawn: () => child as never });
  const events: BrainEvent[] = [];
  const drain = (async (): Promise<void> => {
    for await (const event of brain.run(task)) events.push(event);
  })();
  child.kill();
  await drain; // must settle rather than hang
  assert.equal(
    events.some((event) => event.type === "tool_call"),
    false,
  );
});
