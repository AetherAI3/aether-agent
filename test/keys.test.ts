// test/keys.test.ts — key decoding + the stdin chunk tokenizer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeKey, splitKeys } from "../src/ui/keys.js";

test("splitKeys: plain text run stays one token", () => {
  assert.deepEqual(splitKeys("abc"), ["abc"]);
});

test("splitKeys: text + escape + text -> three tokens", () => {
  assert.deepEqual(splitKeys("a\x1b[Db"), ["a", "\x1b[D", "b"]);
});

test("splitKeys: multibyte graphemes survive in one run", () => {
  assert.deepEqual(splitKeys("héllo🎉"), ["héllo🎉"]);
});

test("splitKeys: control chars are individual tokens", () => {
  assert.deepEqual(splitKeys("ab\rcd\x7f"), ["ab", "\r", "cd", "\x7f"]);
});

test("splitKeys: bracketed paste markers tokenize exactly", () => {
  assert.deepEqual(splitKeys("\x1b[200~hi\x1b[201~"), ["\x1b[200~", "hi", "\x1b[201~"]);
});

test("splitKeys: lone ESC is its own token", () => {
  assert.deepEqual(splitKeys("\x1b"), ["\x1b"]);
});

test("decodeKey: delete key", () => {
  assert.deepEqual(decodeKey("\x1b[3~"), { kind: "delete" });
});

test("decodeKey: ctrl-a/e/k/u", () => {
  assert.deepEqual(decodeKey("\x01"), { kind: "home" });
  assert.deepEqual(decodeKey("\x05"), { kind: "end" });
  assert.deepEqual(decodeKey("\x0b"), { kind: "kill-end" });
  assert.deepEqual(decodeKey("\x15"), { kind: "kill-start" });
});

test("decodeKey: multi-char printable run decodes as one char token", () => {
  assert.deepEqual(decodeKey("abc"), { kind: "char", value: "abc" });
});

test("decodeKey: single chars and legacy sequences unchanged", () => {
  assert.deepEqual(decodeKey("\r"), { kind: "submit" });
  assert.deepEqual(decodeKey("\x1b[A"), { kind: "up" });
  assert.deepEqual(decodeKey("x"), { kind: "char", value: "x" });
});
