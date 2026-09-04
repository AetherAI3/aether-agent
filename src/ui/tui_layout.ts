// tui_layout.ts — full-screen region layout for aether-agent with a Claude-Code-
// style pager (TS port of tui_layout.mjs). HEADER (logo+banner, fixed top) ·
// TRANSCRIPT (own pager) · STATUS (heartbeat + UVT, live) · INPUT (pinned bottom).
// Absolute-positioned repaint on alt-screen; prior terminal restored on exit.
//
// HONEST: a fixed top header replaces OS-native scrollback with THIS pager (it
// mimics Claude Code's feel: follow-at-bottom, position-preserving when scrolled
// up, "N new" hint, End=live, wheel/PgUp/PgDn). NON-TTY -> plain console.log, NO
// ANSI — keeps the §8 emission logs / triage_log.py clean.
//
// Transcript lines are stored LOGICALLY; a wrapped-row view is derived for the
// current width and rebuilt on resize, so cropping the window reflows content
// instead of truncating it.

import { formatElapsed } from "./elapsed.js";
import { sliceVisible, visibleWidth, wrapVisible } from "./text.js";
import { renderInputView } from "./input_render.js";

const ESC = "\x1b[";
const ALT_ON = ESC + "?1049h";
const ALT_OFF = ESC + "?1049l";
const HIDE = ESC + "?25l";
const SHOW = ESC + "?25h";
const MOUSE_ON = ESC + "?1000h" + ESC + "?1006h";
const MOUSE_OFF = ESC + "?1006l" + ESC + "?1000l";
const at = (r: number, c: number): string => `${ESC}${r};${c}H`;
const CLR_LINE = ESC + "2K";
const DIM = ESC + "2m";
const RST = ESC + "0m";

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export interface Regions {
  headerTop: number;
  headerBottom: number;
  transTop: number;
  transBottom: number;
  transHeight: number;
  statusRow: number;
  inputRow: number;
}

export function computeRegions(rows: number, headerH: number): Regions {
  const safeRows = Math.max(3, Math.floor(rows));
  const inputRow = safeRows;
  const statusRow = safeRows - 1;
  // Always retain at least one transcript row plus status/input. Tall logos
  // collapse instead of overwriting the prompt in a 20x5 emergency terminal.
  const effectiveHeaderH = Math.max(0, Math.min(Math.floor(headerH), safeRows - 3));
  const transTop = effectiveHeaderH + 1;
  const transBottom = statusRow - 1;
  return {
    headerTop: 1,
    headerBottom: effectiveHeaderH,
    transTop,
    transBottom,
    transHeight: Math.max(0, transBottom - transTop + 1),
    statusRow,
    inputRow,
  };
}

export type LayoutMode = "api" | "local";

export interface TuiLayoutOptions {
  logo?: string[];
  banner?: string[];
  mode?: LayoutMode;
  mouse?: boolean;
  /** Injected clock (ms) for the elapsed figure. Defaults to Date.now. */
  now?: () => number;
  /** Terminal dimensions override (tests / embeds). Defaults to process.stdout. */
  cols?: number;
  rows?: number;
}

interface StatusParts {
  hb: string;
  verb: string;
  kao: string;
  streamed: number;
  uvtUsed: number;
  uvtCap: number;
}

interface WrappedTranscriptRow {
  text: string;
  entryId: string;
  /** Visible-cell offset within the original logical entry. */
  logicalOffset: number;
}

export interface ViewportAnchor {
  entryId: string;
  logicalOffset: number;
}

const INPUT_PROMPT = "@user] ";

export class TuiLayout {
  tty: boolean;
  private readonly logo: string[];
  private readonly banner: string[];
  private readonly mode: LayoutMode;
  private readonly mouse: boolean;
  transcript: string[] = [];
  offset = 0; // display rows up from live bottom; 0 = following the latest
  following = true;
  unseen = 0; // rows that arrived while scrolled up
  private parts: StatusParts = { hb: "·", verb: "Working", kao: "", streamed: 0, uvtUsed: 0, uvtCap: 0 };
  private readonly now: () => number;
  private readonly startedMs: number;
  private input = "";
  private inputCursor = 0;
  private cols: number;
  private rows: number;
  private readonly headerH: number;
  regions: Regions;
  private cleanupBound = false;
  // Derived wrapped-row view of the transcript for the CURRENT width.
  private wrapCache: string[] = [];
  private wrappedRows: WrappedTranscriptRow[] = [];
  private wrapCols = -1;
  private readonly onResizeBound = (): void => this.scheduleResize();
  private mounted = false;
  private everMounted = false;
  private disposed = false;
  private resizePending: ReturnType<typeof setImmediate> | null = null;
  private readonly restoreTerminalBound = (): void => this.restoreTerminal();
  private readonly onSigintBound = (): void => {
    this.restoreTerminal();
    process.exit(130);
  };
  private readonly onSigtermBound = (): void => {
    this.restoreTerminal();
    process.exit(143);
  };

  constructor(opts: TuiLayoutOptions = {}) {
    this.tty = Boolean(process.stdout.isTTY) && process.env["AETHER_NO_TUI"] !== "1";
    this.logo = opts.logo ?? [];
    this.banner = opts.banner ?? [];
    this.mode = opts.mode ?? "api";
    // Mouse tracking captures wheel/selection input and therefore requires an
    // explicit host capability attestation. A TTY or host label alone is not
    // proof that the embed forwards mouse reports safely.
    this.mouse = opts.mouse ?? false;
    this.now = opts.now ?? (() => Date.now());
    this.startedMs = this.now();
    this.cols = opts.cols ?? (process.stdout.columns || 100);
    this.rows = opts.rows ?? (process.stdout.rows || 30);
    this.headerH = Math.max(this.logo.length, this.banner.length, 1);
    this.regions = computeRegions(this.rows, this.headerH);
  }

  mount(): void {
    if (!this.tty || this.mounted || this.disposed) return;
    this.mounted = true;
    this.everMounted = true;
    process.stdout.write(ALT_ON + HIDE + ESC + "2J" + (this.mouse ? MOUSE_ON : ""));
    this.installCleanup();
    process.stdout.on("resize", this.onResizeBound);
    this.renderAll();
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    process.stdout.removeListener("resize", this.onResizeBound);
    if (this.resizePending) {
      clearImmediate(this.resizePending);
      this.resizePending = null;
    }
    this.removeCleanup();
    if (this.tty) this.restoreTerminal();
  }

  /** Alias for hosts that use the common disposable-resource vocabulary. */
  dispose(): void {
    this.unmount();
    this.disposed = true;
  }

  // ---- transcript + Claude-Code-style pager ----
  log(line: string): void {
    if (!this.tty) {
      if (!this.disposed) process.stdout.write(line + "\n");
      return;
    }
    this.transcript.push(line);
    const added = wrapVisible(line, this.cols);
    // Entry IDs/offsets are rebuilt together; never let the string-only cache
    // advance without its logical anchor metadata.
    this.wrapCols = -1;
    if (this.following) {
      this.offset = 0; // stuck to bottom -> follow live
    } else {
      this.offset += added.length;
      this.unseen += added.length; // scrolled up -> HOLD position, count new
    }
    if (this.canRender()) {
      this.renderTranscript();
      this.renderStatus();
    }
  }

  /** The transcript as display rows wrapped to the current width (cached). */
  private displayRows(): string[] {
    if (this.wrapCols !== this.cols) {
      this.wrappedRows = this.transcript.flatMap((line, entryIndex) => {
        let logicalOffset = 0;
        return wrapVisible(line, this.cols).map((text) => {
          const row = { text, entryId: `entry:${entryIndex + 1}`, logicalOffset };
          logicalOffset += visibleWidth(text);
          return row;
        });
      });
      this.wrapCache = this.wrappedRows.map((row) => row.text);
      this.wrapCols = this.cols;
    }
    return this.wrapCache;
  }

  private get maxOffset(): number {
    return Math.max(0, this.displayRows().length - this.regions.transHeight);
  }

  scrollUp(n = 1): void {
    this.offset = Math.min(this.offset + n, this.maxOffset);
    this.following = false;
    this.afterScroll();
  }

  scrollDown(n = 1): void {
    this.offset = Math.max(0, this.offset - n);
    if (this.offset === 0) {
      this.following = true;
      this.unseen = 0;
    }
    this.afterScroll();
  }

  scrollToBottom(): void {
    this.offset = 0;
    this.following = true;
    this.unseen = 0;
    this.afterScroll();
  }

  scrollToTop(): void {
    this.offset = this.maxOffset;
    this.following = false;
    this.afterScroll();
  }

  private afterScroll(): void {
    if (this.canRender()) {
      this.renderTranscript();
      this.renderStatus();
    }
  }

  /** Map a parsed key/wheel to pager actions. Returns true if consumed. Arrows
   * alone are left for input-line editing (no conflict). */
  handleKey(k: string): boolean {
    const page = Math.max(1, this.regions.transHeight - 1);
    switch (k) {
      case "pageup":
        this.scrollUp(page);
        return true;
      case "pagedown":
        this.scrollDown(page);
        return true;
      case "shift-up":
        this.scrollUp(1);
        return true;
      case "shift-down":
        this.scrollDown(1);
        return true;
      case "wheelup":
        this.scrollUp(3);
        return true;
      case "wheeldown":
        this.scrollDown(3);
        return true;
      case "home":
        this.scrollToTop();
        return true;
      case "end":
        this.scrollToBottom();
        return true;
      default:
        return false;
    }
  }

  /** Visible window (for tests + render): [startIndex, rows[]] in display rows. */
  visibleWindow(): [number, string[]] {
    const rows = this.displayRows();
    const h = this.regions.transHeight;
    const end = rows.length - this.offset;
    const start = Math.max(0, end - h);
    return [start, rows.slice(start, end)];
  }

  /** Logical, rewrap-stable anchor for the first visible transcript row. */
  viewportAnchor(): ViewportAnchor | null {
    this.displayRows();
    const [start, lines] = this.visibleWindow();
    if (!lines.length) return null;
    const row = this.wrappedRows[start];
    return row ? { entryId: row.entryId, logicalOffset: row.logicalOffset } : null;
  }

  private offsetForAnchor(anchor: ViewportAnchor): number {
    this.displayRows();
    let anchoredIndex = this.wrappedRows.findIndex(
      (row, index, all) =>
        row.entryId === anchor.entryId &&
        row.logicalOffset <= anchor.logicalOffset &&
        (index + 1 >= all.length ||
          all[index + 1]!.entryId !== anchor.entryId ||
          all[index + 1]!.logicalOffset > anchor.logicalOffset),
    );
    if (anchoredIndex < 0) anchoredIndex = 0;
    return Math.max(0, Math.min(this.maxOffset, this.wrappedRows.length - anchoredIndex - this.regions.transHeight));
  }

  // ---- rendering ----
  renderAll(): void {
    if (!this.canRender()) return;
    this.renderHeader();
    this.renderTranscript();
    this.renderStatus();
    this.renderInput();
  }

  private renderHeader(): void {
    for (let i = 0; i < this.regions.headerBottom; i++) {
      const l = (this.logo[i] || "") + (this.banner[i] ? "   " + this.banner[i] : "");
      process.stdout.write(at(this.regions.headerTop + i, 1) + CLR_LINE + this.fit(l));
    }
  }

  private renderTranscript(): void {
    const { transTop, transHeight } = this.regions;
    const [, lines] = this.visibleWindow();
    for (let i = 0; i < transHeight; i++)
      process.stdout.write(at(transTop + i, 1) + CLR_LINE + this.fit(lines[i] ?? ""));
  }

  private renderStatus(): void {
    const p = this.parts;
    const kao = p.kao ? p.kao + " " : "";
    const elapsed = formatElapsed(this.now() - this.startedMs);
    const up = p.streamed > 0 ? ` · ↑ ${this.fmt(p.streamed)} tokens` : "";
    const uvt =
      this.mode === "api" ? `   UVT ${this.fmt(p.uvtUsed)}/${this.fmt(p.uvtCap)} ${this.bar(p.uvtUsed, p.uvtCap)}` : "";
    const scroll = this.following ? "" : `${DIM}  ▲ paused · ${this.unseen}↓ new · End=live${RST}`;
    const line = `${p.hb}  ${kao}${p.verb}… ${DIM}(${elapsed}${up})${RST}${uvt}${scroll}`;
    process.stdout.write(at(this.regions.statusRow, 1) + CLR_LINE + this.fit(line));
  }

  private renderInput(): void {
    const v = renderInputView(INPUT_PROMPT, this.input, this.inputCursor, this.cols);
    process.stdout.write(
      at(this.regions.inputRow, 1) + CLR_LINE + v.text + at(this.regions.inputRow, v.cursorCol) + SHOW,
    );
  }

  setHeartbeat(g: string): void {
    this.parts.hb = g;
    if (this.canRender()) this.renderStatus();
  }

  /** Set the activity word + kaomoji (from phaseVerb), mirroring StatusRenderer. */
  setVerb(verb: string, kao: string): void {
    this.parts.verb = verb;
    this.parts.kao = kao;
    if (this.canRender()) this.renderStatus();
  }

  /** Cumulative output tokens streamed this run (the ↑ figure). */
  setStreamed(n: number): void {
    this.parts.streamed = finiteNonNegative(n);
    if (this.canRender()) this.renderStatus();
  }

  setUvt(used: number, cap: number): void {
    this.parts.uvtUsed = finiteNonNegative(used);
    this.parts.uvtCap = finiteNonNegative(cap);
    if (this.canRender()) this.renderStatus();
  }

  setInput(text: string, cursor = text.length): void {
    this.input = text;
    this.inputCursor = Math.max(0, Math.min(cursor, [...text].length));
    if (this.canRender()) this.renderInput();
  }

  /** Recompute layout for new dimensions and repaint. Public for tests; the
   *  'resize' listener calls it with the live process.stdout figures. */
  handleResize(cols?: number, rows?: number): void {
    const anchor = this.following ? null : this.viewportAnchor();
    this.cols = cols ?? process.stdout.columns ?? this.cols;
    this.rows = rows ?? process.stdout.rows ?? this.rows;
    this.regions = computeRegions(this.rows, this.headerH);
    this.wrapCols = -1; // invalidate: re-wrap the transcript to the new width
    if (this.following) this.offset = 0;
    else this.offset = anchor ? this.offsetForAnchor(anchor) : Math.min(this.offset, this.maxOffset);
    if (!this.canRender()) return;
    process.stdout.write(ESC + "2J");
    this.renderAll();
  }

  /** Coalesce live resize bursts to one dimension read + repaint per event-loop
   * turn. Public handleResize remains immediate for deterministic tests. */
  private scheduleResize(): void {
    if (!this.mounted || this.resizePending) return;
    this.resizePending = setImmediate(() => {
      this.resizePending = null;
      if (this.mounted) this.handleResize();
    });
    this.resizePending.unref?.();
  }

  /** Before the first mount, pure/unit-test callers may still exercise the
   * renderer directly. Once mounted, unmount/dispose is a hard write barrier. */
  private canRender(): boolean {
    return !this.disposed && this.tty && (!this.everMounted || this.mounted);
  }

  /** Truncate to the terminal width, ANSI- and wide-char-aware. */
  private fit(s: string): string {
    return sliceVisible(s, this.cols);
  }

  private fmt(n: number): string {
    const safe = finiteNonNegative(n);
    return safe >= 1e6
      ? (safe / 1e6).toFixed(1) + "M"
      : safe >= 1e3
        ? (safe / 1e3).toFixed(1) + "K"
        : String(safe);
  }

  private bar(u: number, c: number, w = 10): string {
    const used = finiteNonNegative(u);
    const cap = finiteNonNegative(c);
    const width = Number.isFinite(w) ? Math.max(0, Math.floor(w)) : 0;
    const fraction = cap > 0 ? (used >= cap ? 1 : used / cap) : 0;
    const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
    return "▓".repeat(filled) + "░".repeat(width - filled);
  }

  private installCleanup(): void {
    if (this.cleanupBound) return;
    this.cleanupBound = true;
    process.on("exit", this.restoreTerminalBound);
    process.on("SIGINT", this.onSigintBound);
    process.on("SIGTERM", this.onSigtermBound);
  }

  private removeCleanup(): void {
    if (!this.cleanupBound) return;
    this.cleanupBound = false;
    process.removeListener("exit", this.restoreTerminalBound);
    process.removeListener("SIGINT", this.onSigintBound);
    process.removeListener("SIGTERM", this.onSigtermBound);
  }

  private restoreTerminal(): void {
    try {
      process.stdout.write((this.mouse ? MOUSE_OFF : "") + SHOW + ALT_OFF);
    } catch {
      /* terminal already gone */
    }
  }
}
