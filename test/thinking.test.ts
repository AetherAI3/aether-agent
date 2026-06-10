import { test } from "node:test";
import assert from "node:assert/strict";
import { ThinkingPulse } from "../src/ui/thinking.js";

test("start paints immediately; stop clears the line exactly once", () => {
  let out = "";
  const p = new ThinkingPulse((s) => (out += s), 60_000); // interval never fires in-test
  p.start();
  assert.ok(out.includes("thinking"), "first frame painted synchronously");
  const before = out;
  p.stop();
  assert.equal(out, before + "\r\x1b[2K", "stop clears the pinned line");
  const after = out;
  p.stop(); // idempotent
  assert.equal(out, after);
});

test("start is idempotent while running", () => {
  let frames = 0;
  const p = new ThinkingPulse(() => {
    frames += 1;
  }, 60_000);
  p.start();
  p.start();
  assert.equal(frames, 1);
  p.stop();
});

test("stop before any paint writes nothing", () => {
  let out = "";
  const p = new ThinkingPulse((s) => (out += s), 60_000);
  p.stop();
  assert.equal(out, "");
});
