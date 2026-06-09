import { test } from "node:test";
import assert from "node:assert/strict";
import { createTerminalSession } from "../src/ui/terminal_session.js";
import { StringSink } from "../src/ui/sink.js";
import type { AgentEvent, AgentSource } from "../src/core/agent_events.js";

/** Fake source we can push events into. */
class FakeSource implements AgentSource {
  private handlers: Array<(e: AgentEvent) => void> = [];
  on(h: (e: AgentEvent) => void): void {
    this.handlers.push(h);
  }
  close(): void {}
  push(e: AgentEvent): void {
    for (const h of this.handlers) h(e);
  }
}

test("createTerminalSession renders a log event into the sink", () => {
  const sink = new StringSink({ isTTY: true, colorEnabled: true });
  const source = new FakeSource();
  const session = createTerminalSession({ source, sink, mode: "api", now: () => 0 });

  source.push({ type: "log", line: "did a thing" });
  assert.ok(sink.buffer.includes("did a thing"), "log line must reach the sink");

  session.dispose();
});

test("createTerminalSession renders a tool event with name + arg hint", () => {
  const sink = new StringSink({ isTTY: true, colorEnabled: true });
  const source = new FakeSource();
  const session = createTerminalSession({ source, sink, mode: "api", now: () => 0 });

  source.push({ type: "tool", name: "write_file", args: "src/x.ts" });
  assert.ok(sink.buffer.includes("write_file"), "tool name must render");
  assert.ok(sink.buffer.includes("src/x.ts"), "tool arg hint must render");

  session.dispose();
});

test("dispose() is idempotent and stops further rendering", () => {
  const sink = new StringSink({ isTTY: true, colorEnabled: true });
  const source = new FakeSource();
  const session = createTerminalSession({ source, sink, mode: "api", now: () => 0 });

  session.dispose();
  session.dispose(); // must not throw
  const lenAfterDispose = sink.buffer.length;
  source.push({ type: "log", line: "late event" });
  assert.equal(sink.buffer.length, lenAfterDispose, "no rendering after dispose");
});
