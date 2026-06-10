// src/ui/restore.ts — central terminal-restore registry. Any surface that
// changes terminal state (raw mode, bracketed paste, alt-screen, hidden
// cursor, mouse reports) registers an undo step here. Process-level crash
// hooks (uncaughtException / unhandledRejection / exit) run every registered
// step before the process dies, so a crash can never strand the parent shell
// in raw mode with an invisible cursor.
//
// Pure registry + idempotent hook install; surfaces unregister on their own
// clean teardown so steps never double-run.

type RestoreFn = () => void;

const steps = new Set<RestoreFn>();
let hooksInstalled = false;

/** Register a terminal-restore step. Returns an unregister function — call it
 *  on clean teardown so the step doesn't re-run at exit. */
export function registerRestore(fn: RestoreFn): () => void {
  steps.add(fn);
  installProcessHooks();
  return () => {
    steps.delete(fn);
  };
}

/** Run every registered step once (LIFO — innermost surface restores first),
 *  swallowing errors (the terminal may already be gone). Steps are consumed. */
export function runRestores(): void {
  const all = [...steps].reverse();
  steps.clear();
  for (const fn of all) {
    try {
      fn();
    } catch {
      /* terminal already gone */
    }
  }
}

/** Number of live restore steps — exposed for tests. */
export function restoreCount(): number {
  return steps.size;
}

/** Render a crash payload without losing the stack (Error) or the shape
 *  (non-Error rejection values would otherwise print "[object Object]"). */
function describeFailure(v: unknown): string {
  if (v instanceof Error) return v.stack ?? v.message;
  if (typeof v === "object" && v !== null) {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function installProcessHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.on("exit", runRestores);
  // Under the node:test runner, leave crash semantics alone — an exit(1) from
  // a shared hook would abort the whole test file with no useful trace.
  if (process.env["NODE_TEST_CONTEXT"]) return;
  process.on("uncaughtException", (err) => {
    runRestores();
    process.stderr.write(`\n✗ unexpected crash: ${describeFailure(err)}\n`);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    runRestores();
    process.stderr.write(`\n✗ unhandled rejection: ${describeFailure(reason)}\n`);
    process.exit(1);
  });
}
