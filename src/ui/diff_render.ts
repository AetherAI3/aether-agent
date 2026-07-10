// src/ui/diff_render.ts — a tiny LCS line diff + a green-add / red-removed render
// for the live edit preview. Pure. Capped so a huge rewrite can't flood the pane.

import { theme } from "./theme.js";

export interface DiffOp {
  kind: "add" | "del";
  text: string;
}

const MAX_RENDERED = 200;
const GREEN = (s: string): string => (theme.enabled ? `\x1b[32m${s}\x1b[0m` : s);
const RED = (s: string): string => (theme.enabled ? `\x1b[31m${s}\x1b[0m` : s);

/** Classic LCS line diff. Returns only add/del ops (a change summary). */
export function lineDiff(oldText: string, newText: string): DiffOp[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ kind: "del", text: a[i++]! });
    } else {
      ops.push({ kind: "add", text: b[j++]! });
    }
  }
  while (i < n) ops.push({ kind: "del", text: a[i++]! });
  while (j < m) ops.push({ kind: "add", text: b[j++]! });
  return ops;
}

/** Render the diff as a labelled, colorized block (green +adds, red -removals). */
export function renderDiff(path: string, ops: DiffOp[], _enabled = theme.enabled): string {
  const adds = ops.filter((o) => o.kind === "add").length;
  const dels = ops.filter((o) => o.kind === "del").length;
  const header = theme.dim(`  ✎ ${path}  `) + GREEN(`+${adds}`) + " " + RED(`-${dels}`);
  const body = ops
    .slice(0, MAX_RENDERED)
    .map((o) => "    " + (o.kind === "add" ? GREEN(`+ ${o.text}`) : RED(`- ${o.text}`)));
  const more =
    ops.length > MAX_RENDERED
      ? [theme.dim(`    … ${ops.length - MAX_RENDERED} more changed lines`)]
      : [];
  return [header, ...body, ...more].join("\n");
}

function splitLines(s: string): string[] {
  if (s === "") return [];
  const lines = s.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
