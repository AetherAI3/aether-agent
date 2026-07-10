import { test } from "node:test";
import assert from "node:assert/strict";
import { runSummary, fmtDuration } from "../src/commands/code_support.js";
import { stripAnsi } from "../src/ui/theme.js";

test("fmtDuration reads like a stopwatch", () => {
  assert.equal(fmtDuration(45), "45s");
  assert.equal(fmtDuration(60), "1m00s");
  assert.equal(fmtDuration(192), "3m12s");
  assert.equal(fmtDuration(-3), "0s");
});

test("ok summary: verdict, blast radius, clock", () => {
  assert.equal(stripAnsi(runSummary("ok", 0, 4, 192)), "✓ ok · 4 files changed · tests green · 3m12s");
  assert.equal(stripAnsi(runSummary("ok", 0, 1, 45)), "✓ ok · 1 file changed · tests green · 45s");
});

test("incomplete summary surfaces the failing-test count", () => {
  assert.equal(
    stripAnsi(runSummary("incomplete", 2, 4, 192)),
    "✗ incomplete · 2 tests failing · 4 files changed · 3m12s",
  );
  // -1 = the verify gate couldn't parse a count; still say tests are failing.
  assert.equal(
    stripAnsi(runSummary("incomplete", -1, 3, 60)),
    "✗ incomplete · tests failing · 3 files changed · 1m00s",
  );
});

test("unverified summary explains how to become verified", () => {
  const s = stripAnsi(runSummary("unverified", 0, 2, 30));
  assert.ok(s.startsWith("— unverified · 2 files changed · 30s"));
  assert.match(s, /--test-cmd/);
});
