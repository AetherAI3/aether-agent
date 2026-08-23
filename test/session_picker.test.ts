// test/session_picker.test.ts — the interactive session picker.
//
// Three layers, tested the way logs_viewer is: the pure reducer with no TTY,
// the pure renderer as string[], and the real driver over fake streams (so the
// suspend/restore/resolve path is exercised, not stubbed).

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { SessionIndexEntry } from "../src/core/session_index.js";
import type { SessionRow } from "../src/ui/continuity.js";
import { stripAnsi } from "../src/ui/text.js";
import {
  filterSessionRows,
  initialPickerState,
  matchesQuery,
  pickerPage,
  pickerPageSize,
  pickerReduce,
  renderSessionPicker,
  rowSearchText,
  runSessionPicker,
  type PickerInput,
  type PickerLimits,
  type PickerOutput,
  type PickerState,
} from "../src/ui/session_picker.js";

// ── fixtures ──────────────────────────────────────────────────────────────

function entry(over: Partial<SessionIndexEntry> = {}): SessionIndexEntry {
  return {
    sessionId: "2026-08-22T10-00-00-aaaa",
    workspace: "/w",
    workspaceFingerprint: "abc123",
    task: "fix the parser",
    model: "opus",
    brain: "cloud",
    started: "2026-08-22T10:00:00Z",
    ended: null,
    finalStatus: "verified",
    ...over,
  };
}

function row(over: Partial<SessionIndexEntry> = {}, state: SessionRow["state"] = "ready"): SessionRow {
  return { entry: entry(over), state };
}

/** N distinct rows, newest-first ids. */
function rows(n: number): SessionRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({ sessionId: `2026-08-22T10-00-${String(i).padStart(2, "0")}-s${i}`, task: `task ${i}` }),
  );
}

const base = (over: Partial<PickerState> = {}): PickerState => ({ ...initialPickerState(), ...over });
const MAX: PickerLimits = { rows: 10, page: 4 };

// ── reducer: movement ─────────────────────────────────────────────────────

test("down/j move the cursor, up/k move it back", () => {
  let s = base();
  s = pickerReduce(s, { kind: "down" }, MAX).state;
  assert.equal(s.cursor, 1);
  s = pickerReduce(s, { kind: "char", value: "j" }, MAX).state;
  assert.equal(s.cursor, 2);
  s = pickerReduce(s, { kind: "up" }, MAX).state;
  assert.equal(s.cursor, 1);
  s = pickerReduce(s, { kind: "char", value: "k" }, MAX).state;
  assert.equal(s.cursor, 0);
});

test("movement CLAMPS at both ends — it never wraps", () => {
  const top = pickerReduce(base(), { kind: "up" }, MAX);
  assert.equal(top.state.cursor, 0);
  const bottom = pickerReduce(base({ cursor: MAX.rows - 1, scroll: 6 }), { kind: "down" }, MAX);
  assert.equal(bottom.state.cursor, MAX.rows - 1);
  assert.equal(bottom.action, "render");
});

test("g/Home jump to the top, G/End to the last row", () => {
  assert.equal(pickerReduce(base({ cursor: 7, scroll: 4 }), { kind: "char", value: "G" }, MAX).state.cursor, 9);
  assert.equal(pickerReduce(base({ cursor: 7, scroll: 4 }), { kind: "end" }, MAX).state.cursor, 9);
  assert.equal(pickerReduce(base({ cursor: 7, scroll: 4 }), { kind: "char", value: "g" }, MAX).state.cursor, 0);
  assert.equal(pickerReduce(base({ cursor: 7, scroll: 4 }), { kind: "home" }, MAX).state.cursor, 0);
});

test("the scroll window follows the cursor and stops at the last page", () => {
  let s = base();
  for (let i = 0; i < 9; i++) s = pickerReduce(s, { kind: "down" }, MAX).state;
  assert.equal(s.cursor, 9);
  assert.equal(s.scroll, 6, "last page of 10 rows at page=4 starts at index 6");
  // Scrolling back up pulls the window with it.
  for (let i = 0; i < 9; i++) s = pickerReduce(s, { kind: "up" }, MAX).state;
  assert.equal(s.cursor, 0);
  assert.equal(s.scroll, 0);
});

test("paging moves a whole page and clamps", () => {
  const down = pickerPage(base(), 1, MAX);
  assert.equal(down.state.cursor, 4);
  const up = pickerPage(down.state, -1, MAX);
  assert.equal(up.state.cursor, 0);
  assert.equal(pickerPage(base({ cursor: 9, scroll: 6 }), 1, MAX).state.cursor, 9);
  // Space is the same binding.
  assert.equal(pickerReduce(base(), { kind: "char", value: " " }, MAX).state.cursor, 4);
});

test("an empty list keeps the cursor at 0 and Enter chooses nothing", () => {
  const empty: PickerLimits = { rows: 0, page: 4 };
  assert.equal(pickerReduce(base(), { kind: "down" }, empty).state.cursor, 0);
  assert.equal(pickerReduce(base(), { kind: "char", value: "G" }, empty).state.cursor, 0);
  assert.equal(pickerReduce(base(), { kind: "submit" }, empty).action, "none");
});

test("a one-row list has nowhere to go", () => {
  const one: PickerLimits = { rows: 1, page: 4 };
  assert.equal(pickerReduce(base(), { kind: "down" }, one).state.cursor, 0);
  assert.equal(pickerReduce(base(), { kind: "up" }, one).state.cursor, 0);
  assert.equal(pickerReduce(base(), { kind: "submit" }, one).action, "choose");
});

// ── reducer: choose / cancel ──────────────────────────────────────────────

test("Enter chooses; q/Esc/Ctrl+C/Ctrl+D cancel", () => {
  assert.equal(pickerReduce(base(), { kind: "submit" }, MAX).action, "choose");
  assert.equal(pickerReduce(base(), { kind: "char", value: "q" }, MAX).action, "cancel");
  assert.equal(pickerReduce(base(), { kind: "char", value: "Q" }, MAX).action, "cancel");
  assert.equal(pickerReduce(base(), { kind: "escape" }, MAX).action, "cancel");
  assert.equal(pickerReduce(base(), { kind: "interrupt" }, MAX).action, "cancel");
  assert.equal(pickerReduce(base(), { kind: "eof" }, MAX).action, "cancel");
});

test("unbound keys are inert", () => {
  assert.equal(pickerReduce(base(), { kind: "char", value: "z" }, MAX).action, "none");
  assert.equal(pickerReduce(base(), { kind: "tab" }, MAX).action, "none");
});

// ── reducer: filter ───────────────────────────────────────────────────────

test("'/' opens an empty prompt and remembers the previous filter", () => {
  const r = pickerReduce(base({ query: "parser", cursor: 5, scroll: 3 }), { kind: "char", value: "/" }, MAX);
  assert.equal(r.state.mode, "filter");
  assert.equal(r.state.query, "");
  assert.equal(r.state.saved, "parser");
  assert.equal(r.state.cursor, 0);
  assert.equal(r.state.scroll, 0);
});

test("typing builds the query incrementally; backspace trims", () => {
  let s = base({ mode: "filter", saved: "" });
  for (const ch of "par") s = pickerReduce(s, { kind: "char", value: ch }, MAX).state;
  assert.equal(s.query, "par");
  s = pickerReduce(s, { kind: "backspace" }, MAX).state;
  assert.equal(s.query, "pa");
});

test("Enter applies the filter (mode back to list, query kept, undo point dropped)", () => {
  const r = pickerReduce(base({ mode: "filter", query: "pars", saved: "" }), { kind: "submit" }, MAX);
  assert.equal(r.state.mode, "list");
  assert.equal(r.state.query, "pars");
  assert.equal(r.state.saved, null);
  assert.equal(r.action, "render");
});

test("Esc cancels the FILTER, not the picker, and restores the previous query", () => {
  const r = pickerReduce(base({ mode: "filter", query: "half-typed", saved: "parser" }), { kind: "escape" }, MAX);
  assert.equal(r.action, "render", "Esc in the filter prompt must not cancel the picker");
  assert.equal(r.state.mode, "list");
  assert.equal(r.state.query, "parser");
  assert.equal(r.state.saved, null);
});

test("navigation keys are literal text inside the filter prompt", () => {
  let s = base({ mode: "filter", saved: "" });
  for (const ch of "qjk/g") s = pickerReduce(s, { kind: "char", value: ch }, MAX).state;
  assert.equal(s.query, "qjk/g");
  assert.equal(s.mode, "filter");
});

test("Ctrl+C still cancels the picker from inside the filter prompt", () => {
  assert.equal(pickerReduce(base({ mode: "filter" }), { kind: "interrupt" }, MAX).action, "cancel");
});

// ── filtering ─────────────────────────────────────────────────────────────

test("filter matches id, task, branch and state label, case-insensitively", () => {
  const all = [
    row({ sessionId: "2026-08-22T10-00-00-alpha", task: "fix the parser", branch: "feat/parser" }),
    row({ sessionId: "2026-08-22T11-00-00-beta", task: "write docs", branch: "main" }, "missing-checkout"),
  ];
  assert.equal(filterSessionRows(all, "ALPHA").length, 1);
  assert.equal(filterSessionRows(all, "DOCS").length, 1);
  assert.equal(filterSessionRows(all, "feat/").length, 1);
  assert.equal(filterSessionRows(all, "missing").length, 1, "state label is searchable");
  assert.equal(filterSessionRows(all, "").length, 2);
  assert.equal(filterSessionRows(all, "nothing-here").length, 0);
});

test("the search haystack is SANITIZED — escapes are never matchable", () => {
  const hostile = row({ task: "\x1b]0;pwned\x07drop \x1b[31mtable" });
  assert.ok(!rowSearchText(hostile).includes("\x1b"));
  assert.ok(matchesQuery(hostile, "drop"), "the visible text still matches");
  assert.ok(!matchesQuery(hostile, "[31m"), "the stripped escape is not matchable");
});

// ── renderer ──────────────────────────────────────────────────────────────

test("empty list renders a stated absence, not a blank frame", () => {
  const out = renderSessionPicker([], base());
  const text = out.join("\n");
  assert.ok(text.includes("no sessions recorded yet"));
  assert.ok(out.length >= 2);
});

test("one row renders with the selection marker on it", () => {
  const out = renderSessionPicker([row()], base()).map(stripAnsi);
  const marked = out.filter((l) => l.startsWith("❯ "));
  assert.equal(marked.length, 1);
  assert.ok(marked[0]!.includes("fix the parser"));
});

test("the selection marker is on exactly one row and follows the cursor", () => {
  const all = rows(5);
  const out = renderSessionPicker(all, base({ cursor: 2 }), { width: 100, height: 24 }).map(stripAnsi);
  const marked = out.filter((l) => l.startsWith("❯ "));
  assert.equal(marked.length, 1);
  assert.ok(marked[0]!.includes("task 2"));
});

test("more rows than fit render a window, and the selected row stays inside it", () => {
  const all = rows(40);
  const height = 12;
  const page = pickerPageSize(height); // 7
  const out = renderSessionPicker(all, base({ cursor: 39, scroll: 40 - page }), { width: 100, height }).map(
    stripAnsi,
  );
  const body = out.filter((l) => /^(❯ | {2})2026-/.test(l));
  assert.equal(body.length, page, "exactly one page of rows is rendered");
  assert.ok(body.some((l) => l.startsWith("❯ ") && l.includes("task 39")));
  assert.ok(!out.some((l) => l.includes("task 0 ")), "off-window rows are not rendered");
});

test("an unrecorded file count renders as unknown, never 0", () => {
  const out = renderSessionPicker([row({ filesTouched: undefined })], base()).map(stripAnsi).join("\n");
  assert.ok(out.includes("unknown file(s) written"));
  const counted = renderSessionPicker([row({ filesTouched: 3 })], base()).map(stripAnsi).join("\n");
  assert.ok(counted.includes("3 file(s) written"));
});

test("an unrecorded branch renders as unknown", () => {
  const out = renderSessionPicker([row({ branch: undefined })], base()).map(stripAnsi).join("\n");
  assert.ok(out.includes("branch unknown"));
});

test("the footer names the keys; the filter prompt replaces it", () => {
  const listing = renderSessionPicker(rows(3), base()).map(stripAnsi).join("\n");
  for (const k of ["move", "choose", "filter", "cancel"]) assert.ok(listing.includes(k), `footer names ${k}`);
  const typing = renderSessionPicker(rows(3), base({ mode: "filter", query: "ta" })).map(stripAnsi).join("\n");
  assert.ok(typing.includes("filter: ta"));
  assert.ok(typing.includes("Enter apply"));
  assert.ok(typing.includes("Esc cancel"));
});

test("a filter that matches nothing says so instead of showing a blank list", () => {
  const out = renderSessionPicker(rows(3), base({ query: "zzz" })).map(stripAnsi).join("\n");
  assert.ok(out.includes("no session matches"));
});

test("ESC/OSC in a task never reaches the frame", () => {
  const hostile = [
    row({
      sessionId: "2026-08-22T10-00-00-\x1b]0;title\x07x",
      task: "hi \x1b]0;pwned\x07 \x1b[2J there",
      branch: "feat/\x1b[31mred",
    }),
  ];
  for (const state of [base(), base({ mode: "filter", query: "\x1b[2J" })]) {
    const frame = renderSessionPicker(hostile, state, { width: 120, height: 20 });
    // Theme colour is off under the test runner (stdout is not a TTY), so the
    // frame must contain no ESC at all.
    assert.equal(frame.join("\n").includes("\x1b"), false, "no escape byte survives sanitizeTerm");
  }
});

test("the renderer returns lines and writes nothing", () => {
  const out = renderSessionPicker(rows(3), base());
  assert.ok(Array.isArray(out));
  for (const l of out) {
    assert.equal(typeof l, "string");
    assert.ok(!l.includes("\n"), "each element is one line");
  }
});

// ── driver ────────────────────────────────────────────────────────────────

class FakeInput extends EventEmitter implements PickerInput {
  isTTY = true;
  isRaw = false;
  rawSet: boolean[] = [];
  setRawMode(mode: boolean): this {
    this.rawSet.push(mode);
    this.isRaw = mode;
    return this;
  }
  send(seq: string): void {
    this.emit("data", Buffer.from(seq, "utf8"));
  }
}

class FakeOutput implements PickerOutput {
  isTTY = false;
  columns = 100;
  rows = 24;
  chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  text(): string {
    return this.chunks.join("");
  }
}

function driver(all: readonly SessionRow[]): {
  input: FakeInput;
  output: FakeOutput;
  done: Promise<SessionRow | null>;
} {
  const input = new FakeInput();
  const output = new FakeOutput();
  const done = runSessionPicker(all, { input, output, width: 100, height: 24 });
  return { input, output, done };
}

test("driver returns the row under the cursor on Enter", async () => {
  const all = rows(5);
  const { input, done } = driver(all);
  input.send("\x1b[B"); // down
  input.send("\x1b[B"); // down
  input.send("\r");
  assert.equal(await done, all[2]);
});

test("driver returns null on q, Esc, and Ctrl+C", async () => {
  for (const seq of ["q", "\x1b", "\x03"]) {
    const { input, done } = driver(rows(3));
    input.send(seq);
    assert.equal(await done, null, `${JSON.stringify(seq)} cancels`);
  }
});

test("driver returns null immediately for an empty library", async () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  assert.equal(await runSessionPicker([], { input, output }), null);
  assert.equal(output.chunks.length, 0);
});

test("driver filters live and returns the filtered row", async () => {
  const all = [
    row({ sessionId: "2026-08-22T10-00-00-a", task: "fix the parser" }),
    row({ sessionId: "2026-08-22T11-00-00-b", task: "write the docs" }),
    row({ sessionId: "2026-08-22T12-00-00-c", task: "ship the release" }),
  ];
  const { input, done } = driver(all);
  input.send("/");
  input.send("docs");
  input.send("\r"); // apply — one row survives, cursor is on it
  input.send("\r"); // choose
  assert.equal(await done, all[1]);
});

test("driver restores raw mode and re-attaches suspended listeners on exit", async () => {
  const all = rows(3);
  const input = new FakeInput();
  const output = new FakeOutput();
  const seen: string[] = [];
  const repl = (c: Buffer | string): void => {
    seen.push(c.toString());
  };
  input.on("data", repl);

  const done = runSessionPicker(all, { input, output, width: 80, height: 20 });
  // While the picker owns the keyboard the REPL listener must be suspended.
  input.send("j");
  assert.deepEqual(seen, [], "keys must not leak into the suspended REPL listener");
  input.send("\r");
  assert.equal(await done, all[1]);

  assert.deepEqual(input.rawSet, [true, false], "raw mode set on entry, cleared on exit");
  assert.equal(input.listenerCount("data"), 1, "only the restored REPL listener remains");
  input.send("x");
  assert.deepEqual(seen, ["x"], "the REPL listener is live again");
});

test("driver restores the terminal on a cancel path too", async () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const done = runSessionPicker(rows(3), { input, output });
  input.send("\x03");
  assert.equal(await done, null);
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount("data"), 0);
});

test("driver frames contain the rows and no unsanitized escapes", async () => {
  const all = [row({ task: "hi \x1b]0;pwned\x07 there" })];
  const { input, output, done } = driver(all);
  input.send("q");
  await done;
  const text = output.text();
  assert.ok(text.includes("hi there"), "the task renders with the OSC sequence removed");
  assert.equal(text.includes("\x1b"), false, "a non-TTY output gets no alt-screen and no escapes");
});

test("driver declines a non-interactive default stdin rather than blocking", async () => {
  // No injected input: process.stdin is not a TTY under the test runner, so the
  // caller falls back to the flat table instead of awaiting keys forever.
  assert.equal(await runSessionPicker(rows(2)), null);
});
