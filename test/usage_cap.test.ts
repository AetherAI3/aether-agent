// /limit shipped as a control that enforced nothing.
//
// `uvtSpent` was only ever written as `= 0` (construction, purge, snapshot
// restore) — no usage frame ever incremented it — and `checkUvtCap()` had zero
// callers. So the cap never stopped anything, and the readout reported
// "spent: 0" no matter what the session had actually cost.
//
// These pin the two properties that matter: an unobserved session is UNKNOWN
// rather than zero, and a reached cap actually refuses the next billable turn.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ContextRegistry } from "../src/core/context_registry.js";

test("a session with no authoritative usage frame reports unknown, not zero", () => {
  const reg = new ContextRegistry();
  assert.equal(reg.uvtObserved, null, "no frame seen means no number to report");
  assert.notEqual(reg.uvtObserved, 0, "zero is a measurement; this is the absence of one");
});

test("a settled turn is counted once, and a duplicate done frame does not double it", () => {
  const reg = new ContextRegistry();
  reg.beginTurn("turn-1");
  reg.settleTurn("turn-1", 1200);
  reg.settleTurn("turn-1", 1200); // replay after reconnect
  assert.equal(reg.uvtObserved, 1200);
});

test("distinct turns accumulate", () => {
  const reg = new ContextRegistry();
  reg.beginTurn("t1");
  reg.settleTurn("t1", 1000);
  reg.beginTurn("t2");
  reg.settleTurn("t2", 500);
  assert.equal(reg.uvtObserved, 1500);
});

test("an unknown session is never reported as capped", () => {
  const reg = new ContextRegistry();
  reg.setUvtCap(1000);
  const check = reg.checkUvtCap();
  assert.equal(check.capped, false, "with nothing observed there is no evidence the cap was reached");
  assert.equal(check.observed, null);
});

test("the cap trips once observed spend reaches it", () => {
  const reg = new ContextRegistry();
  reg.setUvtCap(1000);
  reg.beginTurn("t1");
  reg.settleTurn("t1", 999);
  assert.equal(reg.checkUvtCap().capped, false);
  reg.beginTurn("t2");
  reg.settleTurn("t2", 1);
  assert.equal(reg.checkUvtCap().capped, true, "reaching the cap counts as reaching it");
  assert.equal(reg.checkUvtCap().remaining, 0);
});

test("no cap means never capped, whatever was spent", () => {
  const reg = new ContextRegistry();
  reg.beginTurn("t1");
  reg.settleTurn("t1", 10_000_000);
  const check = reg.checkUvtCap();
  assert.equal(check.capped, false);
  assert.equal(check.cap, null);
});

test("local unmetered sessions are labelled, not counted as zero spend", () => {
  const reg = new ContextRegistry();
  reg.markLocalUnmetered();
  assert.equal(reg.usageStatus(), "local-unmetered");
  assert.equal(reg.checkUvtCap().capped, false, "an unmetered session cannot exceed an Aether cap");
});

test("usageStatus distinguishes unknown from observed", () => {
  const reg = new ContextRegistry();
  assert.equal(reg.usageStatus(), "unknown");
  reg.beginTurn("t1");
  reg.settleTurn("t1", 5);
  assert.equal(reg.usageStatus(), "observed");
});

test("purge clears observed usage back to unknown, not to zero", () => {
  const reg = new ContextRegistry();
  reg.beginTurn("t1");
  reg.settleTurn("t1", 5);
  reg.purge();
  assert.equal(reg.uvtObserved, null);
  assert.equal(reg.usageStatus(), "unknown");
});

test("unmeasured headroom is null, never the full cap", () => {
  // Reporting `remaining: cap` when nothing has been measured is the same false
  // zero wearing a different hat — it tells the user their whole budget is
  // intact when in fact none of it has been counted.
  const reg = new ContextRegistry();
  reg.setUvtCap(1000);
  const unknown = reg.checkUvtCap();
  assert.equal(unknown.remaining, null);
  assert.notEqual(unknown.remaining, 1000, "the full cap is not a measurement of headroom");

  reg.beginTurn("t1");
  reg.settleTurn("t1", 400);
  assert.equal(reg.checkUvtCap().remaining, 600, "once measured, headroom is real");
});
