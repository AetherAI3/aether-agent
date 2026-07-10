import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeCommand, asciiEscape } from "../src/core/brain_protocol.js";

// CONTRACTS.md invariant 3: the host→brain wire is ASCII-escaped so it
// survives a Windows cp1252 pipe. Capped tool_results inject '…' on every
// truncation, so non-ASCII on the wire is the common case, not the corner.
test("encodeCommand emits pure ASCII and round-trips the content", () => {
  const line = encodeCommand({
    type: "tool_result",
    id: "t1",
    output: "[exit 0]\ncapped… (๑•̀も•́)و✧ done — ok",
    exitCode: 0,
  });
  assert.match(line, /^[\x00-\x7f]+$/, "wire line contains raw non-ASCII bytes");
  const parsed = JSON.parse(line) as { output: string };
  assert.equal(parsed.output, "[exit 0]\ncapped… (๑•̀も•́)و✧ done — ok");
});

test("asciiEscape leaves pure-ASCII JSON untouched", () => {
  const json = JSON.stringify({ type: "control", action: "steer", note: "plain" });
  assert.equal(asciiEscape(json), json);
});
