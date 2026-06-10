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

function installProcessHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.on("exit", runRestores);
  process.on("uncaughtException", (err) => {
    runRestores();
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`\n✗ unexpected crash: ${msg}\n`);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    runRestores();
    const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    process.stderr.write(`\n✗ unhandled rejection: ${msg}\n`);
    process.exit(1);
  });
}
