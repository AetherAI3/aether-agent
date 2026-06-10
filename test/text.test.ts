// test/text.test.ts — shared terminal-text utilities: width, slice, wrap, sanitize.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAnsi, charWidth, visibleWidth, sliceVisible, wrapVisible, sanitizeTerm } from "../src/ui/text.js";

test("stripAnsi removes SGR sequences", () => {
  assert.equal(stripAnsi("\x1b[1mbold\x1b[0m"), "bold");
});

test("stripAnsi removes OSC-8 hyperlinks (ST-terminated)", () => {
  assert.equal(stripAnsi("\x1b]8;;https://x\x1b\\label\x1b]8;;\x1b\\"), "label");
});

test("stripAnsi removes BEL-terminated OSC and CSI cursor moves", () => {
  assert.equal(stripAnsi("\x1b]0;title\x07hi\x1b[2Athere"), "hithere");
});

test("charWidth: wide, zero, normal", () => {
  assert.equal(charWidth("漢".codePointAt(0)!), 2);
  assert.equal(charWidth("🎉".codePointAt(0)!), 2);
  assert.equal(charWidth(0x200d), 0); // ZWJ
  assert.equal(charWidth(0x0301), 0); // combining acute
  assert.equal(charWidth("a".codePointAt(0)!), 1);
});

test("visibleWidth ignores ANSI, counts wide chars as 2", () => {
  assert.equal(visibleWidth("\x1b[36mab\x1b[0m"), 2);
  assert.equal(visibleWidth("a漢b"), 4);
});

test("sliceVisible truncates colored text without splitting escapes", () => {
  const s = "\x1b[36mabcdef\x1b[0m";
  const out = sliceVisible(s, 3);
  assert.equal(stripAnsi(out), "abc");
  assert.ok(out.startsWith("\x1b[36m"));
  assert.ok(out.endsWith("\x1b[0m"));
});

test("sliceVisible never splits a wide char (stops before overflow)", () => {
  assert.equal(stripAnsi(sliceVisible("a漢b", 2)), "a");
});

test("sliceVisible passes short strings through unchanged", () => {
  assert.equal(sliceVisible("plain", 10), "plain");
});

test("wrapVisible wraps to cols and re-opens SGR state on continuation rows", () => {
  const rows = wrapVisible("\x1b[36m" + "x".repeat(10) + "\x1b[0m", 4);
  assert.equal(rows.length, 3);
  assert.equal(stripAnsi(rows[0]!), "xxxx");
  assert.equal(stripAnsi(rows[2]!), "xx");
  assert.ok(rows[1]!.startsWith("\x1b[36m"), "continuation row re-opens color");
});

test("wrapVisible: empty line -> one empty row; exact fit -> one row", () => {
  assert.deepEqual(wrapVisible("", 10), [""]);
  assert.deepEqual(wrapVisible("abcd", 4), ["abcd"]);
});

test("wrapVisible accounts wide chars (no row over cols)", () => {
  const rows = wrapVisible("漢漢漢", 4);
  assert.equal(rows.length, 2);
  assert.equal(stripAnsi(rows[0]!), "漢漢");
});

test("sanitizeTerm strips OSC/CSI/DCS and lone ESC", () => {
  assert.equal(sanitizeTerm("a\x1b]0;evil\x07b"), "ab");
  assert.equal(sanitizeTerm("a\x1b[31mb"), "ab");
  assert.equal(sanitizeTerm("a\x1bZb"), "ab");
});

test("sanitizeTerm keeps newline and tab, drops \\r and other C0", () => {
  assert.equal(sanitizeTerm("a\nb\tc\rd\x07e"), "a\nb\tcde");
});

test("sanitizeTerm strips C1 controls (U+009B is a single-byte CSI)", () => {
  assert.equal(sanitizeTerm("a" + String.fromCharCode(0x9b) + "2Jb"), "a2Jb");
  const c1run = String.fromCharCode(0x80, 0x8d, 0x9f);
  assert.equal(sanitizeTerm("x" + c1run + "y"), "xy", "full C1 range stripped");
});
