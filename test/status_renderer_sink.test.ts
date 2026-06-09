import { test } from "node:test";
import assert from "node:assert/strict";
import { StatusRenderer } from "../src/ui/status_renderer.js";
import { StringSink } from "../src/ui/sink.js";

const fixedNow = (): number => 1_000_000;

test("colorEnabled sink → composeLine emits ANSI and the verb", () => {
  const sink = new StringSink({ isTTY: true, colorEnabled: true });
  const r = new StatusRenderer({ sink, mode: "local", now: fixedNow, ownsProcess: false });
  r.setVerb("Forging", "");
  const line = r.composeLine();
  assert.ok(line.includes("\x1b["), "expected ANSI escapes when colorEnabled");
  assert.ok(line.includes("Forging"), "expected the verb text");
});

test("colorEnabled:false sink → composeLine is plain (no ANSI)", () => {
  const sink = new StringSink({ isTTY: true, colorEnabled: false });
  const r = new StatusRenderer({ sink, mode: "local", now: fixedNow, ownsProcess: false });
  r.setVerb("Forging", "");
  const line = r.composeLine();
  assert.ok(!line.includes("\x1b["), "expected no ANSI when colorEnabled is false");
  assert.ok(line.includes("Forging"));
});

test("non-tty sink → log() writes a plain line plus newline, no carriage return", () => {
  const sink = new StringSink({ isTTY: false });
  const r = new StatusRenderer({ sink, now: fixedNow, ownsProcess: false });
  r.log("hello world");
  assert.equal(sink.buffer, "hello world\n");
});

test("tty sink → log() clears the line and repaints (writes to sink, not stdout)", () => {
  const sink = new StringSink({ isTTY: true, colorEnabled: true });
  const r = new StatusRenderer({ sink, mode: "local", now: fixedNow, ownsProcess: false });
  r.log("event");
  assert.ok(sink.buffer.includes("event"), "log line must land in the sink");
  assert.ok(sink.buffer.includes("\r"), "tty log path uses carriage-return clear");
});

test("ownsProcess:false installs no process exit/SIGINT listeners", () => {
  const beforeExit = process.listenerCount("exit");
  const beforeSig = process.listenerCount("SIGINT");
  const sink = new StringSink({ isTTY: true, colorEnabled: true });
  const r = new StatusRenderer({ sink, now: fixedNow, ownsProcess: false });
  r.start();
  assert.equal(process.listenerCount("exit"), beforeExit, "no exit listener for embeds");
  assert.equal(process.listenerCount("SIGINT"), beforeSig, "no SIGINT listener for embeds");
  r.end();
});

test("default opts use a StdoutSink (no sink arg) and still compose a line", () => {
  const r = new StatusRenderer({ mode: "local", now: fixedNow, ownsProcess: false });
  assert.ok(typeof r.composeLine() === "string" && r.composeLine().length > 0);
});
