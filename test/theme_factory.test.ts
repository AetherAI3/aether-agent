import { test } from "node:test";
import assert from "node:assert/strict";
import { createTheme, theme, stripAnsi } from "../src/ui/theme.js";

test("createTheme(false) passes text through unchanged", () => {
  const t = createTheme(false);
  assert.equal(t.cyan("x"), "x");
  assert.equal(t.bold("x"), "x");
  assert.equal(t.dim("x"), "x");
  assert.equal(t.enabled, false);
});

test("createTheme(true) wraps with ANSI escapes", () => {
  const t = createTheme(true);
  assert.equal(t.bold("x"), "\x1b[1mx\x1b[0m");
  assert.equal(t.cyan("x"), "\x1b[38;5;44mx\x1b[0m");
  assert.equal(t.dim("x"), "\x1b[90mx\x1b[0m");
  assert.equal(t.enabled, true);
});

test("stripAnsi removes the escapes createTheme(true) adds", () => {
  const t = createTheme(true);
  assert.equal(stripAnsi(t.cyan("hello")), "hello");
});

test("back-compat: global theme matches createTheme(its enabled flag)", () => {
  const t = createTheme(theme.enabled);
  assert.equal(theme.cyan("z"), t.cyan("z"));
  assert.equal(theme.bold("z"), t.bold("z"));
});
