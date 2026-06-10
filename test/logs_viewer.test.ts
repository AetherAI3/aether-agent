// test/logs_viewer.test.ts — the viewer's pure key reducer: live search mode,
// navigation, and the removal of the surprising Enter=export-all binding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { viewerReduce, type ViewerState } from "../src/ui/logs_viewer.js";

const base = (over: Partial<ViewerState> = {}): ViewerState => ({
  mode: "list",
  query: "",
  sessionIdx: 0,
  scrollOffset: 0,
  ...over,
});
const MAX = { sessions: 3, filtered: 30, page: 14 };

test("'/' enters search mode with a fresh query", () => {
  const r = viewerReduce(base({ query: "old" }), { kind: "char", value: "/" }, MAX);
  assert.equal(r.state.mode, "search");
  assert.equal(r.state.query, "");
  assert.equal(r.action, "render");
});

test("chars build the query in search mode; backspace trims", () => {
  let s = base({ mode: "search" });
  s = viewerReduce(s, { kind: "char", value: "a" }, MAX).state;
  s = viewerReduce(s, { kind: "char", value: "b" }, MAX).state;
  assert.equal(s.query, "ab");
  s = viewerReduce(s, { kind: "backspace" }, MAX).state;
  assert.equal(s.query, "a");
});

test("Enter applies the search (back to list, query kept)", () => {
  const r = viewerReduce(base({ mode: "search", query: "tool" }), { kind: "submit" }, MAX);
  assert.equal(r.state.mode, "list");
  assert.equal(r.state.query, "tool");
});

test("Esc cancels the search (query cleared)", () => {
  const r = viewerReduce(base({ mode: "search", query: "tool" }), { kind: "escape" }, MAX);
  assert.equal(r.state.mode, "list");
  assert.equal(r.state.query, "");
});

test("q quits in list mode but is a query char in search mode", () => {
  assert.equal(viewerReduce(base(), { kind: "char", value: "q" }, MAX).action, "quit");
  const r = viewerReduce(base({ mode: "search" }), { kind: "char", value: "q" }, MAX);
  assert.equal(r.action, "render");
  assert.equal(r.state.query, "q");
});

test("Enter in list mode is inert (no export-all surprise)", () => {
  assert.equal(viewerReduce(base(), { kind: "submit" }, MAX).action, "none");
});

test("j/k and arrows scroll within bounds; n/p cycle sessions", () => {
  const down = viewerReduce(base(), { kind: "char", value: "j" }, MAX);
  assert.equal(down.state.scrollOffset, 1);
  const up = viewerReduce(down.state, { kind: "char", value: "k" }, MAX);
  assert.equal(up.state.scrollOffset, 0);
  const clamped = viewerReduce(base(), { kind: "up" }, MAX);
  assert.equal(clamped.state.scrollOffset, 0, "cannot scroll above the top");
  const next = viewerReduce(base({ sessionIdx: 2 }), { kind: "char", value: "n" }, MAX);
  assert.equal(next.state.sessionIdx, 0, "n wraps");
  assert.equal(next.state.scrollOffset, 0, "session switch resets scroll");
});

test("e/E export in list mode; Ctrl-C quits everywhere", () => {
  assert.equal(viewerReduce(base(), { kind: "char", value: "e" }, MAX).action, "export");
  assert.equal(viewerReduce(base(), { kind: "char", value: "E" }, MAX).action, "exportAll");
  assert.equal(viewerReduce(base({ mode: "search" }), { kind: "interrupt" }, MAX).action, "quit");
});
