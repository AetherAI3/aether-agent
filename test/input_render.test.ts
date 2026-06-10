// test/input_render.test.ts — single-row input view with cursor windowing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderInputView } from "../src/ui/input_render.js";
import { stripAnsi } from "../src/ui/text.js";

test("short input: full text, cursor after last char", () => {
  const v = renderInputView("> ", "abc", 3, 40);
  assert.equal(v.text, "> abc");
  assert.equal(v.cursorCol, 6); // 2 prompt cols + 3 chars + 1
});

test("cursor mid-line positions inside the row", () => {
  const v = renderInputView("> ", "abcdef", 2, 40);
  assert.equal(v.cursorCol, 5);
});

test("long input: window slides so the cursor stays visible", () => {
  const value = "x".repeat(100);
  const v = renderInputView("> ", value, 100, 20);
  assert.ok(stripAnsi(v.text).length <= 20, "row fits the terminal");
  assert.ok(v.cursorCol <= 20, "cursor inside the row");
});

test("ANSI prompt prefix: width counted visually", () => {
  const v = renderInputView("\x1b[36m> \x1b[0m", "ab", 2, 40);
  assert.equal(v.cursorCol, 5);
});

test("wide chars position the cursor by columns, not chars", () => {
  const v = renderInputView("> ", "漢字", 2, 40);
  assert.equal(v.cursorCol, 7); // 2 + 4 cols + 1
});
