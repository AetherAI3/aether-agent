import { test } from "node:test";
import assert from "node:assert/strict";
import { StringSink, StdoutSink } from "../src/ui/sink.js";

test("StringSink captures all writes into buffer", () => {
  const s = new StringSink();
  s.write("a");
  s.write("b\n");
  assert.equal(s.buffer, "ab\n");
});

test("StringSink reports configured dims and flags", () => {
  const s = new StringSink({ columns: 120, rows: 40, isTTY: true, colorEnabled: true });
  assert.equal(s.columns, 120);
  assert.equal(s.rows, 40);
  assert.equal(s.isTTY, true);
  assert.equal(s.colorEnabled, true);
});

test("StringSink defaults: non-tty, no color, 80x24", () => {
  const s = new StringSink();
  assert.equal(s.columns, 80);
  assert.equal(s.rows, 24);
  assert.equal(s.isTTY, false);
  assert.equal(s.colorEnabled, false);
});

test("StdoutSink reflects process.stdout color policy", () => {
  const s = new StdoutSink();
  assert.equal(s.colorEnabled, s.isTTY && !process.env["NO_COLOR"]);
});
