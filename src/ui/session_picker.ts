// src/ui/session_picker.ts — the interactive half of the session library.
//
// `aether sessions` has two renderings on purpose (see ui/continuity.ts): a
// tab-separated table when stdout is a pipe, and a table a person scans when it
// is a terminal. This module adds the third thing a terminal makes possible —
// picking a row — WITHOUT becoming a second copy of the table: the columns, the
// state labels, and the "unknown is not zero" rule all come from continuity.ts.
//
// Shape follows ui/logs_viewer.ts exactly: a PURE reducer (`pickerReduce`) that
// is unit-testable with no TTY, a PURE renderer (`renderSessionPicker`) that
// returns string[] and never writes, and a thin async driver
// (`runSessionPicker`) that owns the only I/O. Streams are injected so a test
// can drive the real driver without a real terminal.
//
// Every untrusted cell (task, branch, session id) goes through sanitizeTerm
// before it is measured, matched, or printed — a task string can carry OSC/CSI
// sequences, and a picker that highlights rows would otherwise be a very
// convenient place to hide them.

import type { Key } from "./keys.js";
import { decodeKey, splitKeys } from "./keys.js";
import { registerRestore } from "./restore.js";
import { theme } from "./theme.js";
import { sanitizeTerm, sliceVisible, visibleWidth } from "./text.js";
import { UNKNOWN, renderCount, shortId, stateLabel, type SessionRow } from "./continuity.js";

export type { SessionRow };

// ── state ─────────────────────────────────────────────────────────────────

export interface PickerState {
  /** "list" takes navigation keys; "filter" is typing a query. */
  mode: "list" | "filter";
  /** The live filter. In filter mode this updates on every keystroke — the
   *  filter is incremental, so the list under the prompt is always the list
   *  Enter would apply. */
  query: string;
  /** The query to restore if the filter is cancelled. null outside filter
   *  mode. Kept in state (not in the driver) so Esc-restores-the-previous-
   *  filter is a property of the reducer and can be tested without a TTY. */
  saved: string | null;
  /** Index into the FILTERED rows. */
  cursor: number;
  /** Index of the first filtered row shown in the window. */
  scroll: number;
}

/** The sizes the reducer cannot know: how many rows survive the current filter
 *  and how many fit on screen. The driver derives both. */
export interface PickerLimits {
  /** Number of rows after filtering. */
  rows: number;
  /** Rows visible at once (≥ 1). */
  page: number;
}

export type PickerAction = "none" | "render" | "choose" | "cancel";

export interface PickerStep {
  state: PickerState;
  action: PickerAction;
}

/** A fresh picker over an unfiltered list. */
export function initialPickerState(query = ""): PickerState {
  return { mode: "list", query, saved: null, cursor: 0, scroll: 0 };
}

/** Keep the window over the cursor, and the cursor inside the list.
 *  Movement CLAMPS at both ends — it never wraps. Wrapping in a list whose
 *  rows are ordered by time makes "hold ↓" silently restart at the newest
 *  session, which is exactly the row a user scrolling down is trying to leave. */
function settle(s: PickerState, max: PickerLimits): PickerState {
  const page = Math.max(1, max.page);
  const last = Math.max(0, max.rows - 1);
  const cursor = max.rows === 0 ? 0 : Math.max(0, Math.min(last, s.cursor));
  const maxScroll = Math.max(0, max.rows - page);
  let scroll = Math.max(0, Math.min(maxScroll, s.scroll));
  if (cursor < scroll) scroll = cursor;
  if (cursor >= scroll + page) scroll = cursor - page + 1;
  scroll = Math.max(0, Math.min(maxScroll, scroll));
  return s.cursor === cursor && s.scroll === scroll ? s : { ...s, cursor, scroll };
}

function moved(s: PickerState, delta: number, max: PickerLimits): PickerStep {
  return { state: settle({ ...s, cursor: s.cursor + delta }, max), action: "render" };
}

function jumped(s: PickerState, cursor: number, max: PickerLimits): PickerStep {
  return { state: settle({ ...s, cursor }, max), action: "render" };
}

/**
 * One key against the picker state. Pure — no I/O, no mutation.
 *
 * Ctrl+C and Ctrl+D cancel from ANY mode, including mid-filter: a user who has
 * lost the plot inside a filter prompt should not have to discover that Esc is
 * the way out of the prompt and q is the way out of the picker.
 */
export function pickerReduce(s: PickerState, k: Key, max: PickerLimits): PickerStep {
  if (k.kind === "interrupt" || k.kind === "eof") return { state: s, action: "cancel" };

  if (s.mode === "filter") {
    switch (k.kind) {
      case "char":
        return {
          state: settle({ ...s, query: s.query + k.value, cursor: 0, scroll: 0 }, max),
          action: "render",
        };
      case "backspace":
        return { state: settle({ ...s, query: s.query.slice(0, -1), cursor: 0, scroll: 0 }, max), action: "render" };
      case "submit":
        // Apply: leave the prompt, keep the query, forget the undo point.
        return { state: { ...s, mode: "list", saved: null }, action: "render" };
      case "escape":
        // Cancel the FILTER, not the picker.
        return {
          state: settle({ ...s, mode: "list", query: s.saved ?? "", saved: null, cursor: 0, scroll: 0 }, max),
          action: "render",
        };
      default:
        return { state: s, action: "none" };
    }
  }

  switch (k.kind) {
    case "up":
      return moved(s, -1, max);
    case "down":
      return moved(s, +1, max);
    case "home":
      return jumped(s, 0, max);
    case "end":
      return jumped(s, max.rows - 1, max);
    case "escape":
      return { state: s, action: "cancel" };
    case "submit":
      // A choose with nothing under the cursor is not a choice.
      return max.rows === 0 ? { state: s, action: "none" } : { state: s, action: "choose" };
    case "char":
      switch (k.value) {
        case "j":
          return moved(s, +1, max);
        case "k":
          return moved(s, -1, max);
        case "g":
          return jumped(s, 0, max);
        case "G":
          return jumped(s, max.rows - 1, max);
        case " ":
          return moved(s, +Math.max(1, max.page), max);
        case "q":
        case "Q":
          return { state: s, action: "cancel" };
        case "/":
          // The current query is the undo point, and the prompt starts empty.
          return { state: { ...s, mode: "filter", saved: s.query, query: "", cursor: 0, scroll: 0 }, action: "render" };
        default:
          return { state: s, action: "none" };
      }
    default:
      return { state: s, action: "none" };
  }
}

/** PageUp/PageDown arrive as `up`/`down` on some terminals; where they decode
 *  distinctly the driver maps them through this so the binding lives here. */
export function pickerPage(s: PickerState, direction: 1 | -1, max: PickerLimits): PickerStep {
  return moved(s, direction * Math.max(1, max.page), max);
}

// ── filtering ─────────────────────────────────────────────────────────────

/** Clean one untrusted cell. Same rule as continuity.ts: escapes stripped,
 *  whitespace collapsed — matched text and printed text are the SAME text. */
function cell(value: string | undefined): string {
  return sanitizeTerm(value ?? "").replace(/\s+/g, " ").trim();
}

/** The haystack for one row: session id, task, branch, and the state label —
 *  all sanitized, so a query can never match bytes that are not on screen. */
export function rowSearchText(row: SessionRow): string {
  return [
    cell(row.entry.sessionId),
    cell(row.entry.task),
    cell(row.entry.branch),
    stateLabel(row.state),
  ]
    .join(" ")
    .toLowerCase();
}

/** Case-insensitive substring match over {@link rowSearchText}. */
export function matchesQuery(row: SessionRow, query: string): boolean {
  const q = sanitizeTerm(query).trim().toLowerCase();
  return q === "" || rowSearchText(row).includes(q);
}

export function filterSessionRows(rows: readonly SessionRow[], query: string): SessionRow[] {
  const q = sanitizeTerm(query).trim();
  return q === "" ? [...rows] : rows.filter((r) => matchesQuery(r, q));
}

// ── rendering ─────────────────────────────────────────────────────────────

export interface PickerRenderOptions {
  /** Terminal columns. */
  width?: number;
  /** Terminal rows — the window size is derived from it. */
  height?: number;
  /** Heading above the table. */
  title?: string;
}

/** Rows visible at once for a given terminal height: title, header, and the
 *  two footer lines are never scrolled away. */
export function pickerPageSize(height: number): number {
  return Math.max(1, height - 5);
}

function pad(value: string, width: number): string {
  const clipped = visibleWidth(value) > width ? sliceVisible(value, width) : value;
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/**
 * One full frame, as lines. Never writes — the driver decides where these go,
 * which is what makes the frame assertable in a test.
 *
 * Shows the same facts as the flat table (session, status, continuity state,
 * task) plus the selected row's recorded detail, where an unrecorded count
 * stays {@link UNKNOWN} rather than being rounded down to a confident 0.
 */
export function renderSessionPicker(
  all: readonly SessionRow[],
  state: PickerState,
  opts: PickerRenderOptions = {},
): string[] {
  const width = Math.max(40, opts.width ?? 100);
  const height = Math.max(6, opts.height ?? 24);
  const page = pickerPageSize(height);
  const rows = filterSessionRows(all, state.query);
  const settled = settle(state, { rows: rows.length, page });

  const lines: string[] = [theme.bold(opts.title ?? "Select a session")];

  if (all.length === 0) {
    lines.push(theme.dim("(no sessions recorded yet)"));
    lines.push("");
    lines.push(theme.dim("q cancel"));
    return lines;
  }

  const idWidth = Math.max(7, ...all.map((r) => visibleWidth(shortId(r.entry.sessionId))));
  const statusWidth = Math.max(6, ...all.map((r) => visibleWidth(cell(r.entry.finalStatus) || "unknown")));
  const stateWidth = Math.max(5, ...all.map((r) => visibleWidth(stateLabel(r.state))));
  // 2 for the selection marker, 3 for the column gaps.
  const taskWidth = Math.max(12, width - (idWidth + statusWidth + stateWidth + 5));

  lines.push(
    theme.dim(
      "  " +
        [pad("SESSION", idWidth), pad("STATUS", statusWidth), pad("WHERE", stateWidth), "TASK"].join(" "),
    ),
  );

  if (rows.length === 0) {
    lines.push(theme.dim(`  (no session matches "${cell(state.query)}")`));
  } else {
    const window = rows.slice(settled.scroll, settled.scroll + page);
    for (let i = 0; i < window.length; i++) {
      const row = window[i];
      if (!row) continue;
      const selected = settled.scroll + i === settled.cursor;
      const marker = selected ? theme.cyan("❯ ") : "  ";
      const task = pad(cell(row.entry.task) || UNKNOWN, taskWidth);
      const body = [
        pad(shortId(row.entry.sessionId), idWidth),
        pad(cell(row.entry.finalStatus) || "unknown", statusWidth),
        pad(stateLabel(row.state), stateWidth),
        selected ? theme.bold(task) : task,
      ].join(" ");
      lines.push(marker + body);
    }
  }

  const current = rows[settled.cursor];
  const detail = current
    ? `${settled.cursor + 1}/${rows.length} · branch ${cell(current.entry.branch) || UNKNOWN}` +
      ` · ${renderCount(current.entry.filesTouched)} file(s) written`
    : `0/${rows.length}`;
  lines.push(theme.dim("  " + detail));

  if (settled.mode === "filter") {
    lines.push(theme.cyan(`  filter: ${cell(state.query)}▌`) + theme.dim("   Enter apply · Esc cancel"));
  } else {
    const q = state.query ? theme.cyan(` filter:"${cell(state.query)}"`) : "";
    lines.push(theme.dim("  ↑↓/jk move · g/G ends · ⏎ choose · / filter · q cancel") + q);
  }
  return lines;
}

// ── driver ────────────────────────────────────────────────────────────────

/** The parts of stdin the picker actually uses. Narrow on purpose so a test
 *  can hand in an EventEmitter, and so nothing here depends on `process`. */
export interface PickerInput {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  removeListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  rawListeners?(event: string): unknown[];
  removeAllListeners?(event: string): unknown;
  setRawMode?(mode: boolean): unknown;
  resume?(): unknown;
  pause?(): unknown;
  isTTY?: boolean | undefined;
  isRaw?: boolean | undefined;
}

export interface PickerOutput {
  write(chunk: string): unknown;
  isTTY?: boolean | undefined;
  columns?: number | undefined;
  rows?: number | undefined;
}

export interface SessionPickerOptions extends PickerRenderOptions {
  input?: PickerInput;
  output?: PickerOutput;
  /** Use the alternate screen buffer. Defaults to "output is a TTY" so a fake
   *  stream in a test collects frames instead of escape sequences. */
  altScreen?: boolean;
  /** Starting filter (e.g. an argument the command was given). */
  query?: string;
}

const ALT_ON = "\x1b[?1049h\x1b[?25l";
const ALT_OFF = "\x1b[?1049l\x1b[?25h";

/**
 * Run the interactive picker. Resolves with the chosen row, or null when the
 * user cancels, when there is nothing to pick, or when the input is not
 * interactive — the caller falls back to the flat table for null, so a
 * non-TTY never blocks waiting on keys that will not arrive.
 *
 * The terminal is restored on EVERY exit path: choose, cancel, and a throw
 * inside key handling (which resolves null rather than leaving the caller
 * awaiting a promise nobody will settle).
 */
export async function runSessionPicker(
  rows: readonly SessionRow[],
  opts: SessionPickerOptions = {},
): Promise<SessionRow | null> {
  const input = opts.input ?? (process.stdin as unknown as PickerInput);
  const output = opts.output ?? (process.stdout as unknown as PickerOutput);
  if (rows.length === 0) return null;
  if (opts.input === undefined && !input.isTTY) return null;

  const alt = opts.altScreen ?? Boolean(output.isTTY);
  const width = opts.width ?? output.columns ?? 100;
  const height = opts.height ?? output.rows ?? 24;
  const page = pickerPageSize(height);

  let state = initialPickerState(opts.query ?? "");

  const frame = (): void => {
    if (alt) output.write("\x1b[2J\x1b[H");
    const title = opts.title;
    const lines = renderSessionPicker(rows, state, title === undefined ? { width, height } : { width, height, title });
    output.write(lines.join("\n") + "\n");
  };

  const wasRaw = input.isRaw === true;
  try {
    input.setRawMode?.(true);
  } catch {
    /* not a real terminal */
  }
  input.resume?.();

  // Suspend the REPL's own stdin listeners while the picker owns the keyboard —
  // otherwise every key ALSO lands in the REPL's type-ahead buffer. Same reason
  // as logs_viewer / model_picker.
  const suspended = (input.rawListeners?.("data") ?? []) as ((chunk: Buffer | string) => void)[];
  input.removeAllListeners?.("data");

  if (alt) output.write(ALT_ON);
  const unregister = registerRestore(() => {
    try {
      if (alt) output.write(ALT_OFF);
      if (!wasRaw) input.setRawMode?.(false);
    } catch {
      /* terminal already gone */
    }
  });

  return new Promise<SessionRow | null>((resolve) => {
    let done = false;

    const cleanup = (): void => {
      input.removeListener("data", onData);
      for (const l of suspended) input.on("data", l);
      try {
        if (!wasRaw) {
          input.setRawMode?.(false);
          input.pause?.();
        }
      } catch {
        /* terminal already gone */
      }
      if (alt) output.write(ALT_OFF);
      unregister();
    };

    const finish = (value: SessionRow | null): void => {
      if (done) return;
      done = true;
      cleanup();
      resolve(value);
    };

    const step = (k: Key): boolean => {
      const visible = filterSessionRows(rows, state.query);
      const r = pickerReduce(state, k, { rows: visible.length, page });
      state = r.state;
      switch (r.action) {
        case "choose": {
          const chosen = filterSessionRows(rows, state.query)[state.cursor] ?? null;
          finish(chosen);
          return true;
        }
        case "cancel":
          finish(null);
          return true;
        case "render":
          frame();
          return false;
        default:
          return false;
      }
    };

    function onData(chunk: Buffer | string): void {
      try {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        for (const seq of splitKeys(text)) {
          const k = decodeKey(seq);
          // A printable run is reduced one character at a time — j/k/q// are
          // per-character bindings, and a pasted run must not act as one key.
          const keys: Key[] =
            k.kind === "char" ? [...k.value].map((v): Key => ({ kind: "char", value: v })) : [k];
          for (const kk of keys) if (step(kk)) return;
        }
      } catch {
        // A throw mid-render must not strand the suspended REPL listeners, the
        // alt-screen, or the awaiting caller.
        finish(null);
      }
    }

    input.on("data", onData);
    frame();
  });
}
