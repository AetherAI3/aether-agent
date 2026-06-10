// test/render_sanitize.test.ts — stream-sourced text is sanitized before it
// reaches the terminal (ANSI/OSC injection defense), and interim usage frames
// no longer carriage-return over streamed output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { Renderer } from "../src/core/render.js";

function collect(): { w: Writable; data: string[] } {
  const data: string[] = [];
  const w = new Writable({
    write(chunk, _enc, cb) {
      data.push(String(chunk));
      cb();
    },
  });
  return { w, data };
}

test("delta text is stripped of OSC/CSI escapes", () => {
  const out = collect();
  const err = collect();
  const r = new Renderer({ json: false, audit: false, out: out.w, err: err.w });
  r.frame({ type: "delta", text: "safe \x1b]0;evil title\x07and \x1b[2J more" });
  const written = out.data.join("");
  assert.equal(written, "safe and  more");
  assert.ok(!written.includes("\x1b"), "no escape bytes pass through");
});

test("reasoning and error text are sanitized", () => {
  const out = collect();
  const err = collect();
  const r = new Renderer({ json: false, audit: false, out: out.w, err: err.w });
  r.frame({ type: "reasoning", text: "think\x1b[31m red" });
  r.frame({ type: "error", msg: "bad\x1b]52;c;ZXZpbA==\x07thing" });
  const s = err.data.join("");
  assert.ok(!s.includes("\x1b"), "stderr stream-sourced text carries no escapes");
  assert.ok(s.includes("badthing"));
});

test("interim usage frame writes nothing (no \\r stomp); done summary remains", () => {
  const out = collect();
  const err = collect();
  const r = new Renderer({ json: false, audit: false, out: out.w, err: err.w });
  r.frame({ type: "delta", text: "partial line" });
  r.frame({ type: "usage", uvt: 42, cents: 0.5 });
  assert.equal(err.data.join(""), "", "usage ticker suppressed mid-stream");
  r.frame({ type: "done", uvt: 42, cents: 0.5 });
  assert.match(err.data.join(""), /42 UVT/);
});

test("json mode passes frames verbatim", () => {
  const out = collect();
  const err = collect();
  const r = new Renderer({ json: true, audit: false, out: out.w, err: err.w });
  r.frame({ type: "delta", text: "x\x1b[2Jy" });
  assert.ok(out.data.join("").includes("\\u001b[2J"), "raw frame preserved for machines");
});

test("task labels are sanitized", () => {
  const out = collect();
  const err = collect();
  const r = new Renderer({ json: false, audit: false, out: out.w, err: err.w });
  r.frame({ type: "task_start", taskId: "t1", label: "build\x1b[8m hidden" });
  assert.ok(!out.data.join("").includes("\x1b[8m"), "conceal-text SGR stripped from label");
});
