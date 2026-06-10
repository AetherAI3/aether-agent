import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeKey, ctrlCDecision } from "../src/commands/chat.js";

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

// ── Ctrl+C state machine ──────────────────────────────────────────────────

test("ctrl-c: mid-paste always exits (a stuck paste can't brick raw mode)", () => {
  assert.equal(
    ctrlCDecision({ pasting: true, busy: true, abortable: true, hasDraft: true, armed: false }),
    "exit",
  );
});

test("ctrl-c mid-turn aborts the TURN; pressed again it quits", () => {
  assert.equal(
    ctrlCDecision({ pasting: false, busy: true, abortable: true, hasDraft: false, armed: false }),
    "abort-turn",
  );
  assert.equal(
    ctrlCDecision({ pasting: false, busy: true, abortable: false, hasDraft: false, armed: true }),
    "exit",
  );
  assert.equal(
    ctrlCDecision({ pasting: false, busy: true, abortable: false, hasDraft: false, armed: false }),
    "arm-quit",
  );
});

test("ctrl-c with a draft clears the line; idle needs a double press to exit", () => {
  assert.equal(
    ctrlCDecision({ pasting: false, busy: false, abortable: false, hasDraft: true, armed: false }),
    "clear-line",
  );
  assert.equal(
    ctrlCDecision({ pasting: false, busy: false, abortable: false, hasDraft: false, armed: false }),
    "arm-exit",
  );
  assert.equal(
    ctrlCDecision({ pasting: false, busy: false, abortable: false, hasDraft: false, armed: true }),
    "exit",
  );
});
