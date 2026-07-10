import { test } from "node:test";
import assert from "node:assert/strict";
import { lineDiff, renderDiff } from "../src/ui/diff_render.js";
import { stripAnsi } from "../src/ui/theme.js";

test("lineDiff marks added and removed lines", () => {
  const ops = lineDiff("a\nb\nc\n", "a\nB\nc\n");
  assert.deepEqual(ops.filter((o) => o.kind === "add").map((o) => o.text), ["B"]);
  assert.deepEqual(ops.filter((o) => o.kind === "del").map((o) => o.text), ["b"]);
});
test("renderDiff prefixes + for adds and - for removals", () => {
  const plain = stripAnsi(renderDiff("foo.ts", lineDiff("x\n", "x\ny\n"), true));
  assert.match(plain, /foo\.ts/);
  assert.match(plain, /^\s*\+ y$/m);
});
test("renderDiff caps very large diffs with an elision marker", () => {
  const big = Array.from({ length: 500 }, (_, i) => `line${i}`).join("\n");
  assert.match(stripAnsi(renderDiff("big.ts", lineDiff("", big), false)), /more changed lines/);
});
test("a brand-new file shows all-add", () => {
  assert.ok(lineDiff("", "one\ntwo\n").every((o) => o.kind === "add"));
});
