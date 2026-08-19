// Release canaries — executable gates, not a checklist someone remembers.
//
// The integration proof for the A0–A5 wave listed seven canaries and recorded
// that none of them ran. This file makes the ones that CAN run run on every
// build, so they cannot quietly lapse again.
//
// Coverage map, stated honestly:
//
//   1 denied mutation        HERE
//   2 live-child cancel      test/process_tree.test.ts  (whole tree, by pid)
//   3 reconnect replay       HERE
//   4 remote freshness       test/worktree.test.ts      (real git, pinned base)
//   5 fake-gh ship           NOT WRITABLE — see the end of this file
//   6 cap across reconnect   HERE
//   7 brain parity           NOT WRITABLE — see the end of this file
//
// 5 and 7 are deliberately absent rather than stubbed. A test that asserts
// nothing is worse than a gap, because it reads as coverage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolExecutor } from "../src/core/tool_executor.js";
import { ContextRegistry } from "../src/core/context_registry.js";

// ── Canary 1: a refused mutation changes nothing on disk ────────────────────

test("canary 1: a refused write never lands, and the write path is real", async () => {
  // bridge.test.ts already proves the brain receives a refusal. What it does
  // not check is the disk. A gate that refuses in the transcript while the
  // write still lands is the failure that matters, and it would pass there.
  const dir = mkdtempSync(join(tmpdir(), "aether-canary1-"));
  const target = join(dir, "guarded.txt");
  writeFileSync(target, "ORIGINAL\n");
  const exec = new ToolExecutor(dir);

  // A path escaping the workspace is refused by the executor itself — the one
  // denial drivable end to end without standing up a host loop.
  const refused = await exec.executeAsync("write_file", { path: "../escaped.txt", content: "x" });
  assert.notEqual(refused.exitCode, 0, "an escaping path must be refused");
  assert.match(refused.output, /refus|denied|outside/i);
  assert.equal(existsSync(join(dir, "..", "escaped.txt")), false, "nothing may be written outside the workspace");
  assert.equal(readFileSync(target, "utf8"), "ORIGINAL\n", "an unrelated file must be untouched");

  // Prove the write path really would have changed it, so the assertions above
  // are not vacuously passing against a broken executor.
  const allowed = await exec.executeAsync("write_file", { path: "guarded.txt", content: "REPLACED\n" });
  assert.equal(allowed.exitCode, 0);
  assert.equal(
    readFileSync(target, "utf8"),
    "REPLACED\n",
    "the write path must be real, or the refusal proves nothing",
  );
});

// ── Canary 3: a replayed terminal frame settles a turn once ─────────────────

test("canary 3: a turn replayed after reconnect is counted exactly once", () => {
  // A reconnect re-delivers frames from the last acknowledged sequence. If the
  // terminal frame settles twice, the session's recorded spend doubles silently.
  const reg = new ContextRegistry();

  reg.beginTurn("turn-1");
  reg.settleTurn("turn-1", 1200);

  // connection drops; client reconnects; server replays the same frame
  reg.settleTurn("turn-1", 1200);
  reg.settleTurn("turn-1", 1200);

  assert.equal(reg.uvtObserved, 1200, "a replayed terminal frame must not accumulate");

  // A genuinely new turn still counts, so dedupe is not over-suppressing.
  reg.beginTurn("turn-2");
  reg.settleTurn("turn-2", 300);
  assert.equal(reg.uvtObserved, 1500);
});

// ── Canary 6: the operator cap survives a reconnect ─────────────────────────

test("canary 6: the cap stops the next turn even when frames were replayed", () => {
  const reg = new ContextRegistry();
  reg.setUvtCap(1000);

  reg.beginTurn("t1");
  reg.settleTurn("t1", 600);
  assert.equal(reg.checkUvtCap().capped, false, "600 of 1000 is not yet the boundary");

  // Reconnect replays t1. Without dedupe this reads as 1200 and trips the cap
  // early — the opposite failure, but still a lie about what was spent.
  reg.settleTurn("t1", 600);
  assert.equal(reg.uvtObserved, 600, "replay must not inflate observed spend");
  assert.equal(reg.checkUvtCap().capped, false);

  reg.beginTurn("t2");
  reg.settleTurn("t2", 400);
  const at = reg.checkUvtCap();
  assert.equal(at.capped, true, "reaching the cap counts as reaching it");
  assert.equal(at.remaining, 0);
  assert.equal(at.observed, 1000);
});

test("canary 6b: an unmeasured session is never reported as capped", () => {
  // The dangerous inverse: treating "no usage frame arrived" as zero spend, and
  // letting work continue against a cap nobody has measured against.
  const reg = new ContextRegistry();
  reg.setUvtCap(1000);
  const check = reg.checkUvtCap();
  assert.equal(check.capped, false);
  assert.equal(check.observed, null, "unknown is not zero");
  assert.equal(check.remaining, null, "unmeasured headroom is not the full cap");
  assert.equal(reg.usageStatus(), "unknown");
});

// ── The two that cannot be written yet ──────────────────────────────────────
//
// Canary 5 — fake-gh ship.
//   There is no PR-creation path to exercise. repo.ts's prCreateHint returns a
//   STRING for the user to run; no subprocess ever invokes `gh pr create`. A
//   fake-gh harness would assert against code that does not exist. This canary
//   arrives with the review/ship rail, not before it.
//
// Canary 7 — local/Ollama brain parity.
//   LocalBrain spawns a Python module that is not vendored here and exposes no
//   injectable transport, so no test can drive it. Comparing normalized
//   transcripts needs a seam on the Python path first.
//
// Both are tracked as gaps rather than stubbed green.
