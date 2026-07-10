// status_renderer_cleanup.test.ts — H1 (guarded SIGINT write) + H2 (listener teardown).
// Written as .ts to match repo build conventions (package "type":"module",
// tsc-only build → dist/test/*.js). Same assertions as the P4 Track A plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { StatusRenderer } from "../src/ui/status_renderer.js";
import { StringSink, type RenderSink } from "../src/ui/sink.js";

function ttySink(): StringSink {
  // A StringSink reports isTTY from opts; force tty true so cleanup installs.
  return new StringSink({ isTTY: true, columns: 80, rows: 24 });
}

test("H2: end() removes the process listeners it installed", () => {
  const baseExit = process.listenerCount("exit");
  const baseSig = process.listenerCount("SIGINT");
  const r = new StatusRenderer({ sink: ttySink(), ownsProcess: true });
  r.start();
  assert.equal(process.listenerCount("exit"), baseExit + 1, "exit listener installed");
  assert.equal(process.listenerCount("SIGINT"), baseSig + 1, "SIGINT listener installed");
  r.end();
  assert.equal(process.listenerCount("exit"), baseExit, "exit listener removed on end()");
  assert.equal(process.listenerCount("SIGINT"), baseSig, "SIGINT listener removed on end()");
});

test("H1: a throwing sink does not propagate out of restore-on-signal", () => {
  // restoreOnSignal() must swallow sink write errors (guarded), incl. the newline.
  const throwingSink: RenderSink = {
    write(): void {
      throw new Error("terminal gone");
    },
    get columns(): number {
      return 80;
    },
    get rows(): number {
      return 24;
    },
    isTTY: true,
    colorEnabled: true,
  };
  const r = new StatusRenderer({ sink: throwingSink, ownsProcess: true });
  r.start();
  // The extracted guarded routine must not throw even though every write throws.
  assert.doesNotThrow(() => r._restoreOnSignalForTest());
  r.end();
});
