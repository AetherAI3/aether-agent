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
test("deleteForward removes the char at the cursor", () => {
  const b = new InputBuffer();
  for (const c of "abc") b.insert(c);
  b.left();
  b.deleteForward();
  assert.equal(b.value, "ab");
  assert.equal(b.pos, 2);
});
test("killToEnd truncates from the cursor", () => {
  const b = new InputBuffer();
  for (const c of "abcd") b.insert(c);
  b.left();
  b.left();
  b.killToEnd();
  assert.equal(b.value, "ab");
});
test("killToStart removes before the cursor and zeroes it", () => {
  const b = new InputBuffer();
  for (const c of "abcd") b.insert(c);
  b.left();
  b.killToStart();
  assert.equal(b.value, "d");
  assert.equal(b.pos, 0);
});
