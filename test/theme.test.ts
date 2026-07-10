import { test } from "node:test";
import assert from "node:assert/strict";
import { theme, errTheme, stripAnsi } from "../src/ui/theme.js";

// Test runs are piped (non-TTY on both streams): every wrapper must be the
// identity so pipes/CI/logs never see ANSI (C2).
test("both palettes degrade to identity when their stream is not a TTY", () => {
  assert.equal(theme.enabled, false);
  assert.equal(errTheme.enabled, false);
  for (const key of ["bold", "cyan", "dim", "red", "green", "yellow", "muted", "iceBlue"] as const) {
    assert.equal(theme[key]("x"), "x", `theme.${key} not identity off-TTY`);
    assert.equal(errTheme[key]("x"), "x", `errTheme.${key} not identity off-TTY`);
  }
});

test("stripAnsi removes SGR sequences", () => {
  assert.equal(stripAnsi("\x1b[1mhello\x1b[0m"), "hello");
  assert.equal(stripAnsi("plain"), "plain");
});
