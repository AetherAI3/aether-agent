import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeKey } from "../src/commands/chat.js";

test("plain char", () => assert.deepEqual(decodeKey("a"), { kind: "char", value: "a" }));
test("enter submits", () => assert.deepEqual(decodeKey("\r"), { kind: "submit" }));
test("backspace", () => assert.deepEqual(decodeKey("\x7f"), { kind: "backspace" }));
test("ctrl-c", () => assert.deepEqual(decodeKey("\x03"), { kind: "interrupt" }));
test("ctrl-w word-delete", () => assert.deepEqual(decodeKey("\x17"), { kind: "word-delete" }));
test("left arrow", () => assert.deepEqual(decodeKey("\x1b[D"), { kind: "left" }));
test("paste markers", () => {
  assert.deepEqual(decodeKey("\x1b[200~"), { kind: "paste-start" });
  assert.deepEqual(decodeKey("\x1b[201~"), { kind: "paste-end" });
});
test("unknown escape is ignored", () => assert.deepEqual(decodeKey("\x1b[Z"), { kind: "ignore" }));
