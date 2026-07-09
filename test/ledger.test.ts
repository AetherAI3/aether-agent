import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskLedger, GLYPH } from "../src/ui/ledger.js";
import { stripAnsi } from "../src/ui/theme.js";

test("ledger: add is idempotent by label", () => {
  const l = new TaskLedger(["a", "b"]);
  l.add("a");
  assert.equal(l.size, 2);
});

test("ledger: setActive completes the previously active step", () => {
  const l = new TaskLedger(["one", "two", "three"]);
  l.setActive("one");
  l.setActive("two");
  const c = l.counts();
  assert.equal(c.done, 1); // one auto-completed
  assert.equal(c.active, 1); // two active
  assert.equal(c.pending, 1); // three pending
});

test("ledger: setActive(completePrevious=false) keeps prior active", () => {
  const l = new TaskLedger(["one", "two"]);
  l.setActive("one");
  l.setActive("two", false);
  assert.equal(l.counts().active, 2);
});

test("ledger: setState + failed counts + isComplete", () => {
  const l = new TaskLedger(["a", "b"]);
  l.setState("a", "done");
  assert.equal(l.isComplete(), false); // b still pending
  l.setState("b", "failed");
  assert.equal(l.isComplete(), true);
  assert.equal(l.counts().failed, 1);
});

test("ledger: finishAll closes open steps but keeps failures", () => {
  const l = new TaskLedger(["a", "b", "c"]);
  l.setActive("b");
  l.setState("c", "failed");
  l.finishAll();
  const c = l.counts();
  assert.equal(c.failed, 1); // c stays failed
  assert.equal(c.done, 2); // a + b closed to done
  assert.equal(c.pending, 0);
  assert.equal(c.active, 0);
});

test("ledger: panel renders glyph + label per step", () => {
  const l = new TaskLedger(["recon", "execute"]);
  l.setActive("recon");
  const lines = l.panel(80).map(stripAnsi);
  assert.equal(lines.length, 2);
  assert.ok(lines[0]?.startsWith(`  ${GLYPH.active} recon`));
  assert.equal(lines[1], `  ${GLYPH.pending} execute`);
});

test("ledger: panel shows ✓ done and ✗ failed glyphs", () => {
  const l = new TaskLedger();
  l.setState("good", "done");
  l.setState("bad", "failed");
  const lines = l.panel(80).map(stripAnsi);
  assert.ok(lines[0]?.startsWith(`  ${GLYPH.done} good`));
  assert.ok(lines[1]?.startsWith(`  ${GLYPH.failed} bad`));
});

test("ledger: summary shows settled/total and the active label", () => {
  const l = new TaskLedger(["a", "b", "c"]);
  l.setActive("a");
  l.setActive("b"); // a done, b active
  const s = stripAnsi(l.summary());
  assert.ok(s.includes("1/3")); // a settled
  assert.ok(s.includes(`${GLYPH.active} b`)); // active label shown
});

test("ledger: panel clips long labels to cols with …", () => {
  const l = new TaskLedger();
  l.setState("x".repeat(100), "done");
  const line = stripAnsi(l.panel(30)[0]!);
  assert.equal(line.length, 30);
  assert.ok(line.endsWith("…"));
});

test("ledger: empty summary is blank", () => {
  assert.equal(new TaskLedger().summary(), "");
});
