import { test } from "node:test";
import assert from "node:assert/strict";
import { gradientLine, type Rgb } from "../src/ui/gradient.js";
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
