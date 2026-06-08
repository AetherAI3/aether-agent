import { test } from "node:test";
import assert from "node:assert/strict";
import { InputBuffer } from "../src/ui/input_line.js";

test("typed characters accumulate", () => {
  const b = new InputBuffer();
  for (const c of "hello") b.insert(c);
  assert.equal(b.value, "hello");
});
test("bracketed paste inserts the whole block at the cursor", () => {
  const b = new InputBuffer();
  b.insert("a");
  b.paste("X\nY");
  assert.equal(b.value, "aX\nY");
});
test("backspace deletes before the cursor", () => {
  const b = new InputBuffer();
  for (const c of "abc") b.insert(c);
  b.backspace();
  assert.equal(b.value, "ab");
});
test("left/right move the cursor; insert respects it", () => {
  const b = new InputBuffer();
  for (const c of "ac") b.insert(c);
  b.left();
  b.insert("b");
  assert.equal(b.value, "abc");
});
test("history up/down recalls submitted lines", () => {
  const b = new InputBuffer();
  b.commit("first");
  b.commit("second");
  b.historyUp();
  assert.equal(b.value, "second");
  b.historyUp();
  assert.equal(b.value, "first");
  b.historyDown();
  assert.equal(b.value, "second");
});
test("deleteWord removes the word before the cursor", () => {
  const b = new InputBuffer();
  for (const c of "foo bar") b.insert(c);
  b.deleteWord();
  assert.equal(b.value, "foo ");
});
