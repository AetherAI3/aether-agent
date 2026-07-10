// Persisted REPL input history — the file behind readline's up-arrow.
// Stored most-recent-LAST on disk (append-friendly); served most-recent-FIRST
// (readline's history shape). History must never break the REPL: every fs
// error degrades to "no history".

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const HISTORY_LIMIT = 200;

function readLines(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Load persisted history, most-recent-first (what readline expects). */
export function loadHistory(path: string, limit = HISTORY_LIMIT): string[] {
  if (!existsSync(path)) return [];
  try {
    return readLines(path).slice(-limit).reverse();
  } catch {
    return [];
  }
}

/** Append one submitted line (consecutive duplicates skipped); compacts the
 * file back to `limit` entries when it grows past 2x. */
export function appendHistory(path: string, line: string, limit = HISTORY_LIMIT): void {
  const t = line.trim();
  if (!t) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const lines = existsSync(path) ? readLines(path) : [];
    if (lines[lines.length - 1] === t) return; // consecutive duplicate
    if (lines.length + 1 > limit * 2) {
      writeFileSync(path, [...lines.slice(-(limit - 1)), t].join("\n") + "\n", "utf8");
    } else {
      appendFileSync(path, t + "\n", "utf8");
    }
  } catch {
    /* history must never break the REPL */
  }
}
