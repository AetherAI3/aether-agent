// src/core/history_store.ts — persistent REPL input history.
// Plain text, one submitted line per row, newest last, capped. Multi-line
// submissions are stored with embedded newlines encoded as U+2028 (line
// separator) so the file stays one-entry-per-row and recall restores the
// original text. Lives beside the session logs under ~/.aether-agent/.
// Opt out with AETHER_NO_HISTORY=1.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const HISTORY_CAP = 1000;
const NL_MARK = String.fromCodePoint(0x2028); // U+2028 LINE SEPARATOR

export function historyPath(): string {
  return join(homedir(), ".aether-agent", "history");
}

export function historyEnabled(): boolean {
  return process.env["AETHER_NO_HISTORY"] !== "1";
}

const encode = (line: string): string => line.replace(/\r?\n/g, NL_MARK);
const decode = (row: string): string => row.replaceAll(NL_MARK, "\n");

/** Load history entries (oldest first), consecutive duplicates collapsed,
 *  capped to the newest `cap`. Missing/unreadable file → empty history. */
export function loadHistory(path: string = historyPath(), cap: number = HISTORY_CAP): string[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const row of raw.split("\n")) {
    if (!row.trim()) continue;
    const line = decode(row);
    if (out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out.slice(-cap);
}

/** Append one submitted line. Skips blanks and a repeat of the last entry.
 *  Compacts the file back under the cap when it drifts well past it.
 *  Fail-soft: a full disk or read-only home never breaks the REPL. */
export function appendHistory(
  line: string,
  path: string = historyPath(),
  cap: number = HISTORY_CAP,
): void {
  if (!line.trim()) return;
  try {
    const entries = loadHistory(path, Number.MAX_SAFE_INTEGER);
    if (entries[entries.length - 1] === line) return;
    mkdirSync(dirname(path), { recursive: true });
    if (entries.length >= cap * 2) {
      // Rewrite compacted: keep the newest cap-1 then the new line.
      const kept = [...entries.slice(-(cap - 1)), line];
      writeFileSync(path, kept.map(encode).join("\n") + "\n", "utf8");
      return;
    }
    appendFileSync(path, encode(line) + "\n", "utf8");
  } catch {
    /* history is best-effort */
  }
}
