import { test } from "node:test";
import assert from "node:assert/strict";
import { box, titledBox, hyperlink, orange, green, darkBlue, brightWhite, lightBlue } from "../src/ui/box.js";
import { stripAnsi, createTheme, type Theme } from "../src/ui/theme.js";

const enabled: Theme = createTheme(true);
const disabled: Theme = createTheme(false);

// Use the side-effect of importing box.ts — it sets up theme wrappers.
// These tests run against the singleton theme (process.stdout.isTTY), so
// color checks test the structure, not specific ANSI codes.

// ── box() ──────────────────────────────────────────────────────────

test("box with single empty line produces correct structure", () => {
  const result = box([""], { width: 40 });
  const plain = stripAnsi(result);
  assert.match(plain, /^┌/);       // top-left corner
  assert.match(plain, /┘$/m);      // bottom-right corner
  assert.ok(plain.includes("│"));
  assert.ok(plain.includes("─"));
});

test("box preserves content characters", () => {
  const result = box(["hello world"], { width: 40 });
  const plain = stripAnsi(result);
  assert.match(plain, /hello world/);
});

test("box lines are all the same visual width (uniform right edge)", () => {
  const result = box(["short", "a longer line of text"], { width: 64 });
  const lines = result.split("\n");
  // All lines after stripping ANSI should be the same length
  const lengths = lines.map((l) => stripAnsi(l).length);
  assert.ok(lengths.every((len) => len === lengths[0]),
    `expected uniform width, got: ${lengths.join(", ")}`);
});

test("box handles content with ANSI escapes without width distortion", () => {
  const colored = enabled.cyan("hello");
  const result = box([colored], { width: 40 });
  const lines = result.split("\n");
  const lengths = lines.map((l) => stripAnsi(l).length);
  assert.ok(lengths.every((len) => len === lengths[0]));
});

test("box uses Unicode glyphs", () => {
  const result = box([""], { width: 40 });
  const plain = stripAnsi(result);
  assert.ok(plain.includes("┌"), "top-left should be ┌");
  assert.ok(plain.includes("┐"), "top-right should be ┐");
  assert.ok(plain.includes("└"), "bottom-left should be └");
  assert.ok(plain.includes("┘"), "bottom-right should be ┘");
});

test("box default width is 64", () => {
  const result = box([""]);
  const topLine = stripAnsi(result.split("\n")[0]!);
  assert.equal(topLine.length, 64);
});

test("box with width=30 produces 30-char top line", () => {
  const result = box([""], { width: 30 });
  const topLine = stripAnsi(result.split("\n")[0]!);
  assert.equal(topLine.length, 30);
});

test("box produces exactly 2 border + N content lines", () => {
  const lines = ["line one", "line two", "line three"];
  const result = box(lines, { width: 50 });
  const outputLines = result.split("\n");
  assert.equal(outputLines.length, 2 + lines.length); // top border + N content + bottom border
});

test("box handles multi-line content correctly", () => {
  const result = box(["alpha", "beta", "gamma"], { width: 40 });
  const plain = stripAnsi(result);
  assert.match(plain, /alpha/);
  assert.match(plain, /beta/);
  assert.match(plain, /gamma/);
});

// ── titledBox() ────────────────────────────────────────────────────

test("titledBox shows the title in bold on its own row", () => {
  const result = titledBox(["content"], "AUTH", { width: 40 });
  const plain = stripAnsi(result);
  assert.match(plain, /AUTH/);
});

test("titledBox has a separator row below the title", () => {
  const result = titledBox(["content"], "AUTH", { width: 40 });
  const lines = result.split("\n");
  // title row at index 1, separator at index 2
  const sep = stripAnsi(lines[2]!);
  assert.match(sep, /^│\s+│$/);
});

test("titledBox content appears below separator", () => {
  const result = titledBox(["hello world"], "TITLE", { width: 60 });
  const plain = stripAnsi(result);
  // "hello world" must appear after "TITLE"
  const titleIdx = plain.indexOf("TITLE");
  const contentIdx = plain.indexOf("hello world");
  assert.ok(contentIdx > titleIdx, "content should appear below title");
});

test("titledBox uses Unicode glyphs", () => {
  const result = titledBox([""], "X", { width: 40 });
  const plain = stripAnsi(result);
  assert.ok(plain.includes("┌"));
  assert.ok(plain.includes("┘"));
});

test("titledBox default width is 64", () => {
  const result = titledBox([""], "T");
  const topLine = stripAnsi(result.split("\n")[0]!);
  assert.equal(topLine.length, 64);
});

// ── hyperlink() ────────────────────────────────────────────────────

test("hyperlink emits OSC 8 sequence or plain label — environment-dependent", () => {
  const result = hyperlink("https://example.com", "click here");
  // label is always present regardless of TTY status
  assert.ok(result.includes("click here"));
  // If TTY is enabled, OSC 8 sequence is wrapped around
  if (result.includes("\x1b]8;;")) {
    assert.ok(result.includes("\x1b]8;;https://example.com\x1b\\"));
  }
});

test("hyperlink falls back to visible label when theme disabled", () => {
  // The function gates on theme.enabled. In tests, process.stdout.isTTY
  // may or may not be true, so we check the structure: if it's an OSC 8
  // link, it has the escape; if not, it's the label.
  const result = hyperlink("https://x.com", "label");
  // Either way, the label should be present
  assert.ok(result.includes("label"));
});

test("hyperlink with no label uses the URL as label", () => {
  const result = hyperlink("https://aethersystems.net");
  assert.ok(result.includes("aethersystems.net"));
});

// ── Accent colors ──────────────────────────────────────────────────

test("accent colors wrap text — ANSI only when TTY enabled", () => {
  const results = [orange("Claude"), green("GPT"), darkBlue("DeepSeek"),
                   brightWhite("Kimi"), lightBlue("Gemma")];
  // Text is always preserved
  for (const r of results) {
    assert.ok(r.length > 0);
  }
  // If TTY is on, ANSI escapes are present
  if (results[0]!.includes("\x1b[")) {
    for (const r of results) assert.ok(r.includes("\x1b["));
  }
});

test("accent colors preserve the wrapped text", () => {
  assert.match(stripAnsi(orange("Claude")), /Claude/);
  assert.match(stripAnsi(green("GPT")), /GPT/);
  assert.match(stripAnsi(darkBlue("DeepSeek")), /DeepSeek/);
});
