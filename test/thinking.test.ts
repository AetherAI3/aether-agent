import { test } from "node:test";
import assert from "node:assert/strict";
import { ThinkingPulse, thinkingFrame } from "../src/ui/thinking.js";

class Sink {
  data = "";
  write(s: string): boolean {
    this.data += s;
    return true;
  }
}

test("thinkingFrame cycles dots and turns honest when stalled", () => {
  assert.equal(thinkingFrame(0, false), "(⌨_⌨) thinking·  ");
  assert.equal(thinkingFrame(1, false), "(⌨_⌨) thinking·· ");
  assert.equal(thinkingFrame(2, false), "(⌨_⌨) thinking···");
  assert.equal(thinkingFrame(3, false), "(⌨_⌨) thinking·  "); // wraps
  assert.match(thinkingFrame(0, true), /still waiting · Ctrl\+C cancels the turn/);
});

test("disabled pulse writes zero bytes, ever", () => {
  const sink = new Sink();
  const pulse = new ThinkingPulse({ enabled: false, err: sink });
  pulse.start();
  pulse.stop();
  assert.equal(sink.data, "");
});

test("enabled pulse paints immediately and clears on stop", () => {
  const sink = new Sink();
  const pulse = new ThinkingPulse({ enabled: true, err: sink, intervalMs: 10_000 });
  pulse.start();
  assert.match(sink.data, /thinking/);
  pulse.stop();
  assert.ok(sink.data.endsWith("\r\x1b[2K"), "stop must clear the pinned line");
  const len = sink.data.length;
  pulse.stop(); // idempotent
  assert.equal(sink.data.length, len);
});

test("a pulse that never painted clears nothing on stop", () => {
  const sink = new Sink();
  const pulse = new ThinkingPulse({ enabled: true, err: sink, intervalMs: 10_000 });
  pulse.stop();
  assert.equal(sink.data, "");
});

test("onPaint fires after every repaint (lets the REPL re-sync its input line)", () => {
  const sink = new Sink();
  let paints = 0;
  const pulse = new ThinkingPulse({ enabled: true, err: sink, intervalMs: 10_000, onPaint: () => paints++ });
  pulse.start();
  assert.equal(paints, 1);
  pulse.stop();
  assert.equal(paints, 1, "stop() must not itself trigger a paint");
});
