import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLines, diffLines, diffStat, renderDiff } from "../src/ui/diff.js";
import { stripAnsi } from "../src/ui/theme.js";

test("splitLines: empty → [], trailing newline dropped, CRLF/CR normalized", () => {
  assert.deepEqual(splitLines(""), []);
  assert.deepEqual(splitLines("a\n"), ["a"]);
  assert.deepEqual(splitLines("a\nb"), ["a", "b"]);
  assert.deepEqual(splitLines("a\r\nb\r\n"), ["a", "b"]);
  assert.deepEqual(splitLines("a\rb"), ["a", "b"]);
});

test("diffLines classifies eq/del/add (prefix+suffix trimmed) and diffStat counts", () => {
  const ops = diffLines(["a", "b", "c"], ["a", "x", "c"]);
  assert.deepEqual(
    ops.map((o) => o.tag),
    ["eq", "del", "add", "eq"],
  );
  const { added, removed } = diffStat(ops);
  assert.equal(added, 1);
  assert.equal(removed, 1);
});

test("diffLines: pure insert and pure delete", () => {
  assert.deepEqual(diffStat(diffLines([], ["one", "two"])), { added: 2, removed: 0 });
  assert.deepEqual(diffStat(diffLines(["one", "two"], [])), { added: 0, removed: 2 });
});

test("renderDiff: new file → (new +N) header and green + lines", () => {
  const lines = renderDiff("foo.ts", "", "one\ntwo\n", { isNew: true, cols: 80 }).map(stripAnsi);
  assert.ok(lines[0]?.includes("foo.ts"));
  assert.ok(lines[0]?.includes("(new +2)"));
  assert.equal(lines[1], "+ one");
  assert.equal(lines[2], "+ two");
});

test("renderDiff: + add, - del, and two-space context gutters", () => {
  const old = "keep\ngone\nkeep2\n";
  const next = "keep\nnew\nkeep2\n";
  const lines = renderDiff("f.ts", old, next, { cols: 80, context: 3 }).map(stripAnsi);
  assert.ok(lines.some((l) => l === "- gone"));
  assert.ok(lines.some((l) => l === "+ new"));
  assert.ok(lines.some((l) => l === "  keep"));
  assert.ok(lines.some((l) => l === "  keep2"));
  assert.ok(lines[0]?.includes("+1") && lines[0]?.includes("−1"));
});

test("renderDiff: long lines clip to cols with a trailing …", () => {
  const longLine = "x".repeat(200);
  const lines = renderDiff("f.ts", "", longLine + "\n", { isNew: true, cols: 40 }).map(stripAnsi);
  const body = lines[1]!;
  assert.equal(body.length, 40);
  assert.ok(body.endsWith("…"));
  assert.ok(body.startsWith("+ x"));
});

test("renderDiff: long unchanged runs fold to ⋯ N unchanged", () => {
  const common = Array.from({ length: 20 }, (_, i) => `line${i}`);
  const old = common.join("\n") + "\n";
  const nextArr = common.slice();
  nextArr[10] = "CHANGED";
  const next = nextArr.join("\n") + "\n";
  const lines = renderDiff("f.ts", old, next, { cols: 80, context: 2 }).map(stripAnsi);
  assert.ok(lines.some((l) => /⋯ \d+ unchanged/.test(l)));
  assert.ok(lines.some((l) => l === "- line10"));
  assert.ok(lines.some((l) => l === "+ CHANGED"));
  assert.ok(!lines.includes("  line0")); // top is folded, not shown
});

test("renderDiff: body cap collapses overflow to a note", () => {
  const next = Array.from({ length: 50 }, (_, i) => `add${i}`).join("\n") + "\n";
  const lines = renderDiff("f.ts", "", next, { isNew: true, cols: 80, maxLines: 10 }).map(stripAnsi);
  assert.equal(lines.length, 11); // header + 10 capped body lines
  assert.ok(/\+\d+ more diff lines/.test(lines[lines.length - 1]!));
});

test("renderDiff: identical content reports (no changes)", () => {
  const lines = renderDiff("f.ts", "same\n", "same\n", { cols: 80 }).map(stripAnsi);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.includes("(no changes)"));
});

test("renderDiff: control chars in content are stripped (no ANSI injection)", () => {
  const evil = "safe\x1b[31mINJECT\ttab\n";
  const lines = renderDiff("f.ts", "", evil, { isNew: true, cols: 80 }).map(stripAnsi);
  const body = lines[1]!;
  assert.ok(!body.includes("\x1b")); // ESC removed
  assert.ok(body.includes("safe") && body.includes("INJECT"));
  assert.ok(body.includes("tab"));
});
