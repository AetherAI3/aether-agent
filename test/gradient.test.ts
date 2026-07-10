import { test } from "node:test";
import assert from "node:assert/strict";
import { gradientLine, gradientBlock, type Rgb } from "../src/ui/gradient.js";
import { stripAnsi } from "../src/ui/theme.js";

const ICE: Rgb = [135, 215, 255];
const CYAN: Rgb = [26, 166, 183];

test("gradientLine preserves the visible characters", () => {
  assert.equal(stripAnsi(gradientLine("AETHER", ICE, CYAN, true)), "AETHER");
});
test("gradientLine with color disabled returns the raw string", () => {
  assert.equal(gradientLine("AETHER", ICE, CYAN, false), "AETHER");
});
test("gradientLine emits a truecolor escape for a colored run", () => {
  assert.match(gradientLine("AB", ICE, CYAN, true), /\x1b\[38;2;\d+;\d+;\d+m/);
});
test("gradientLine leaves spaces uncolored", () => {
  assert.equal(stripAnsi(gradientLine("  A  ", ICE, CYAN, true)), "  A  ");
});
test("gradientBlock leaves spaces uncolored (parity with gradientLine)", () => {
  const rows = gradientBlock(["A B", "  C"], ICE, CYAN, true);
  assert.equal(stripAnsi(rows[0]!), "A B");
  assert.ok(rows[1]!.startsWith("  "), "leading spaces stay plain");
});

test("emoji color as whole code points — no split surrogates between SGRs", () => {
  const out = gradientLine("A🙂B", ICE, CYAN, true);
  assert.ok(out.includes("🙂"), "surrogate pair must stay contiguous");
  assert.equal(stripAnsi(out), "A🙂B");
});

test("one trailing reset per line, not one per char", () => {
  const out = gradientLine("ABC", ICE, CYAN, true);
  assert.equal(out.match(/\x1b\[0m/g)!.length, 1);
  assert.ok(out.endsWith("\x1b[0m"));
});
