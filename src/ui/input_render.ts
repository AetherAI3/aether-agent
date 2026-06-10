// src/ui/input_render.ts — single-row input view with a horizontal scroll
// window that keeps the cursor visible. Pure; the REPL repaint and TuiLayout's
// pinned input row both render through this, so the chat bar behaves identically
// in plain and alt-screen modes.

import { charWidth, visibleWidth } from "./text.js";

export interface InputView {
  /** The row to draw: prompt + the visible slice of the value. */
  text: string;
  /** 1-based terminal column where the cursor belongs. */
  cursorCol: number;
}

/**
 * Compute the visible input row for a buffer `value` with the caret at code
 * point index `cursor`, inside a terminal `cols` wide. When the value overflows
 * the row, a window slides so the caret is always on screen (caret pinned to
 * the right edge while typing at the end).
 */
export function renderInputView(prompt: string, value: string, cursor: number, cols: number): InputView {
  const pw = visibleWidth(prompt);
  const avail = Math.max(1, cols - pw - 1); // one spare column for the caret
  const cps = [...value];
  const cur = Math.max(0, Math.min(cursor, cps.length));
  const w = (i: number): number => charWidth(cps[i]!.codePointAt(0)!);
  const widthBetween = (a: number, b: number): number => {
    let t = 0;
    for (let i = a; i < b; i++) t += w(i);
    return t;
  };
  let start = 0;
  while (widthBetween(start, cur) > avail - 1) start++;
  let end = start;
  let used = 0;
  while (end < cps.length && used + w(end) <= avail) {
    used += w(end);
    end++;
  }
  return {
    text: prompt + cps.slice(start, end).join(""),
    cursorCol: pw + widthBetween(start, cur) + 1,
  };
}
