// The final verification gate — ground truth, never the brain's self-report.
//
// The brain emits a `done` event with its own `ok`/`remaining`/`reason`, but a
// headless model can (and does) claim success while the tests are still red. So
// the HOST re-runs the test command itself after the loop and derives the run's
// terminal status from the real exit code. `done` is advisory: it only enriches a
// red result with the brain's breaker reason, and is never allowed to upgrade a red
// run to "ok". Extracted from cmdCode so it is unit-testable with a fake executor.
//
// Canonical: specs/aethercode_loop_fixes.md §12.1 (the kill-gate #1 instrument).

import type { RunOptions, ToolResult } from "./tool_executor.js";
import type { FinalStatus } from "./session_log.js";

/** The subset of the brain's `done` event the gate consults. Advisory only. */
export interface BrainDone {
  ok: boolean;
  remaining: number;
  reason: string;
}

/** What the host runs to establish ground truth — a ToolExecutor, or a fake in tests. */
export interface VerifyRunner {
  // executeAsync, not execute: the shell-backed tools became asynchronous so a
  // timeout or Ctrl+C can reap the whole process tree. Naming the async method
  // here is deliberate — a fake that still implements the sync one will fail to
  // compile rather than quietly diverge from what production calls.
  executeAsync(name: string, args: Record<string, unknown>, options?: RunOptions): Promise<ToolResult>;
}

export interface VerifyOutcome {
  status: FinalStatus;
  /** Failing tests when not ok — parsed from the host run, else the brain's count. */
  remaining: number;
  /** The host test run's exit code (-1 when there was no gate to run). */
  exitCode: number;
}

/** Brain breaker reasons we surface through a red host (richer than flat "incomplete"). */
const BREAKERS = new Set<FinalStatus>(["stalled", "no-progress", "max-turns"]);

/** Pytest-style "<n> failed" if present, else null. Matches the brain's
 * `kernel.parse_fail_count` EXACTLY (`\d+\s+failed`) so host and brain agree on the
 * count — a single-space regex misses "24  failed" / a wrapped summary line. */
export function parseFailCount(output: string): number | null {
  const m = output.match(/(\d+)\s+failed/);
  return m ? parseInt(m[1]!, 10) : null;
}

/**
 * Derive the run's terminal status from the host's OWN final test run.
 *  - brain crashed (`errored`) → "error" (a crashed run is never a trustworthy
 *      success — a coincidentally-green tree must not be reported as "ok").
 *  - no test command  → "unverified" (cannot assert; never "ok"); nothing is run.
 *  - host tests green → "ok" (even if the brain COMPLETED and self-doubted — a
 *      `done.ok=false` on a green tree is genuine success; the host is authoritative).
 *  - host tests red   → the brain's breaker reason if it set one, else "incomplete";
 *                       remaining = the parsed fail count, else the brain's remaining.
 *
 * `errored` is true when the brain emitted an `error` event (vs a `done`). It is
 * distinct from `done.ok=false`: a completed-but-failing brain is overruled by a
 * green host, but a CRASHED brain is not — its run never reached a clean end.
 */
export async function finalVerify(
  exec: VerifyRunner,
  testCmd: string | undefined,
  done: BrainDone | null,
  errored = false,
  options: RunOptions = {},
): Promise<VerifyOutcome> {
  if (!testCmd) {
    return errored
      ? { status: "error", remaining: done?.remaining ?? 0, exitCode: 1 }
      : { status: "unverified", remaining: done?.remaining ?? 0, exitCode: -1 };
  }
  const verify = await exec.executeAsync("run_tests", { command: testCmd }, options);
  const remaining = parseFailCount(verify.output) ?? done?.remaining ?? 0;
  // A crashed brain is never "ok", even on a green tree; we still run the gate so
  // the failing count (if any) is logged.
  if (errored) {
    return { status: "error", remaining: verify.exitCode === 0 ? (done?.remaining ?? 0) : remaining, exitCode: 1 };
  }
  if (verify.exitCode === 0) {
    return { status: "ok", remaining: 0, exitCode: 0 };
  }
  const status: FinalStatus =
    done && BREAKERS.has(done.reason as FinalStatus) ? (done.reason as FinalStatus) : "incomplete";
  return { status, remaining, exitCode: verify.exitCode || 1 };
}
