// Line diff — pure, dependency-free. Turns (oldText, newText) into a styled,
// width-bounded transcript: added lines GREEN (+), removed lines RED (−),
// context DIM, long unchanged runs folded to `⋯ N unchanged`. Presentation
// only — the host computes this from the on-disk file vs. the brain's pending
// write_file content, so the wire protocol never changes.
//
// The algorithm is prefix/suffix trim + LCS on the changed middle, with a coarse
// del-then-add fallback when the middle is huge (keeps it off the O(n²) path on
// pathological rewrites). No external deps — just the theme for color.

import { theme } from "./theme.js";

export type DiffTag = "eq" | "add" | "del";
export interface DiffOp {
  tag: DiffTag;
  text: string;
}
export interface DiffStat {
  added: number;
  removed: number;
}
export interface RenderDiffOptions {
  /** Terminal width to clip lines to (default 80). */
  cols?: number;
  /** Unchanged lines kept around each change (default 3). */
  context?: number;
  /** Hard cap on body lines; overflow becomes a truncation note (default 160). */
  maxLines?: number;
  /** The file did not exist before this write (renders `(new +N)`). */
  isNew?: boolean;
  /** A face to pin in the header, kept in sync with the live status line. */
  kaomoji?: string;
}

// Above this product the LCS table would be too big/slow — fall back to a coarse
// "delete everything, add everything" diff (still correct, just not minimal).
const LCS_CELL_CAP = 1_000_000;

/** Split into lines: normalize CRLF/CR, drop one trailing newline, "" → []. */
export function splitLines(s: string): string[] {
  if (s === "") return [];
  const normalized = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return body.split("\n");
}

/** Minimal-ish line diff (common-prefix/suffix trim + LCS on the middle). */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  const aLen = a.length;
  const bLen = b.length;

  // Trim the common prefix.
  let start = 0;
  const maxStart = Math.min(aLen, bLen);
  while (start < maxStart && a[start] === b[start]) start++;

  // Trim the common suffix (not past the prefix we already consumed).
  let endA = aLen;
  let endB = bLen;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ tag: "eq", text: a[i]! });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length === 0) {
    for (const t of midB) ops.push({ tag: "add", text: t });
  } else if (midB.length === 0) {
    for (const t of midA) ops.push({ tag: "del", text: t });
  } else if (midA.length * midB.length > LCS_CELL_CAP) {
    for (const t of midA) ops.push({ tag: "del", text: t });
    for (const t of midB) ops.push({ tag: "add", text: t });
  } else {
    lcsInto(midA, midB, ops);
  }

  for (let i = endA; i < aLen; i++) ops.push({ tag: "eq", text: a[i]! });
  return ops;
}

/** LCS backtrack appended into `out`. dp[i][j] = LCS length of a[i:],b[j:]. */
function lcsInto(a: string[], b: string[], out: DiffOp[]): void {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = n - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ tag: "eq", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ tag: "del", text: a[i]! });
      i++;
    } else {
      out.push({ tag: "add", text: b[j]! });
      j++;
    }
  }
  while (i < m) {
    out.push({ tag: "del", text: a[i]! });
    i++;
  }
  while (j < n) {
    out.push({ tag: "add", text: b[j]! });
    j++;
  }
}

/** Count added/removed lines. */
export function diffStat(ops: DiffOp[]): DiffStat {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.tag === "add") added++;
    else if (op.tag === "del") removed++;
  }
  return { added, removed };
}

/** Expand tabs and strip other control chars (incl. ESC — no ANSI injection). */
function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\t/g, "  ").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/** Clip a plain (unstyled) string to `cols`, marking truncation with `…`. */
function clip(plain: string, cols: number): string {
  if (plain.length <= cols) return plain;
  if (cols <= 1) return plain.slice(0, Math.max(0, cols));
  return plain.slice(0, cols - 1) + "…";
}

/**
 * Render a styled, width-bounded diff transcript. Returns an array of lines
 * ready to print (header first, then body). NO_COLOR / non-TTY degrade to plain
 * `+ `/`- `/`  ` gutters via the theme. Safe to feed line-by-line into the
 * StatusRenderer's log() so the diff lands in scrollback in sync with the
 * animated status line.
 */
export function renderDiff(
  path: string,
  oldText: string,
  newText: string,
  opts: RenderDiffOptions = {},
): string[] {
  const cols = Math.max(20, opts.cols ?? 80);
  const context = Math.max(0, opts.context ?? 3);
  const maxLines = Math.max(8, opts.maxLines ?? 160);

  const ops = diffLines(splitLines(oldText), splitLines(newText));
  const { added, removed } = diffStat(ops);

  // Header: ✎ path  kao  (+A −D) / (new +A). Path truncated from the LEFT so the
  // filename always survives.
  const maxPath = Math.max(8, cols - 24);
  const shownPath = path.length > maxPath ? "…" + path.slice(path.length - (maxPath - 1)) : path;
  const stat = opts.isNew
    ? theme.green(`(new +${added})`)
    : `${theme.green("+" + added)} ${theme.red("−" + removed)}`;
  const kao = opts.kaomoji ? "  " + theme.dim(opts.kaomoji) : "";
  const header = `  ${theme.cyan("✎")} ${theme.bold(shownPath)}${kao}  ${stat}`;

  if (added === 0 && removed === 0) {
    return [`  ${theme.cyan("✎")} ${theme.bold(shownPath)}${kao}  ${theme.dim("(no changes)")}`];
  }

  // Mark which ops to keep: every change, plus `context` lines around each.
  const keep = new Array<boolean>(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    if (ops[i]!.tag !== "eq") {
      const lo = Math.max(0, i - context);
      const hi = Math.min(ops.length - 1, i + context);
      for (let k = lo; k <= hi; k++) keep[k] = true;
    }
  }

  const body: string[] = [];
  let i = 0;
  while (i < ops.length) {
    if (keep[i]) {
      const op = ops[i]!;
      body.push(styleLine(op.tag, op.text, cols));
      i++;
      continue;
    }
    // A run of dropped (far-from-change) lines → fold marker, unless it's a
    // lone line (a fold marker would cost as much as just showing it).
    let j = i;
    while (j < ops.length && !keep[j]) j++;
    const n = j - i;
    if (n === 1) {
      const op = ops[i]!;
      body.push(styleLine(op.tag, op.text, cols));
    } else {
      body.push(theme.muted(`  ⋯ ${n} unchanged`));
    }
    i = j;
  }

  // Cap the body — overflow collapses to a single yellow note.
  let out = body;
  if (body.length > maxLines) {
    const shown = body.slice(0, maxLines - 1);
    shown.push(theme.yellow(`  … +${body.length - (maxLines - 1)} more diff lines`));
    out = shown;
  }

  return [header, ...out];
}

/** One styled diff line: gutter + clipped, sanitized text in the tag's color. */
function styleLine(tag: DiffTag, text: string, cols: number): string {
  const gutter = tag === "add" ? "+ " : tag === "del" ? "- " : "  ";
  const plain = clip(gutter + sanitize(text), cols);
  if (tag === "add") return theme.green(plain);
  if (tag === "del") return theme.red(plain);
  return theme.dim(plain);
}
