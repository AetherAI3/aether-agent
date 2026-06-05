// tui_layout.ts — full-screen region layout for aether-code with a Claude-Code-
// style pager (TS port of tui_layout.mjs). HEADER (logo+banner, fixed top) ·
// TRANSCRIPT (own pager) · STATUS (heartbeat + UVT, live) · INPUT (pinned bottom).
// Absolute-positioned repaint on alt-screen; prior terminal restored on exit.
//
// HONEST: a fixed top header replaces OS-native scrollback with THIS pager (it
// mimics Claude Code's feel: follow-at-bottom, position-preserving when scrolled
// up, "N new" hint, End=live, wheel/PgUp/PgDn). NON-TTY -> plain console.log, NO
// ANSI — keeps the §8 emission logs / triage_log.py clean.

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
  const inputRow = rows;
  const statusRow = rows - 1;
  const transTop = headerH + 1;
  const transBottom = statusRow - 1;
  return {
    headerTop: 1,
    headerBottom: headerH,
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
}

interface StatusParts {
  hb: string;
  stage: string;
  art: string;
  uvtUsed: number;
  uvtCap: number;
}

export class TuiLayout {
  tty: boolean;
  private readonly logo: string[];
  private readonly banner: string[];
  private readonly mode: LayoutMode;
  private readonly mouse: boolean;
  transcript: string[] = [];
  offset = 0; // lines up from live bottom; 0 = following the latest
  following = true;
  unseen = 0; // lines that arrived while scrolled up
  private parts: StatusParts = { hb: "·", stage: "", art: "", uvtUsed: 0, uvtCap: 0 };
  private input = "";
  private cols: number;
  private rows: number;
  private readonly headerH: number;
  regions: Regions;
  private cleanupBound = false;

  constructor(opts: TuiLayoutOptions = {}) {
    this.tty = Boolean(process.stdout.isTTY) && process.env["AETHER_NO_TUI"] !== "1";
    this.logo = opts.logo ?? [];
    this.banner = opts.banner ?? [];
    this.mode = opts.mode ?? "api";
    this.mouse = opts.mouse ?? true;
    this.cols = process.stdout.columns || 100;
    this.rows = process.stdout.rows || 30;
    this.headerH = Math.max(this.logo.length, this.banner.length, 1);
    this.regions = computeRegions(this.rows, this.headerH);
  }

  mount(): void {
    if (!this.tty) return;
    process.stdout.write(ALT_ON + HIDE + ESC + "2J" + (this.mouse ? MOUSE_ON : ""));
    this.installCleanup();
    process.stdout.on("resize", () => this.onResize());
    this.renderAll();
  }

  unmount(): void {
    if (this.tty) process.stdout.write((this.mouse ? MOUSE_OFF : "") + SHOW + ALT_OFF);
  }

  // ---- transcript + Claude-Code-style pager ----
  log(line: string): void {
    if (!this.tty) {
      process.stdout.write(line + "\n");
      return;
    }
    this.transcript.push(line);
    if (this.following) {
      this.offset = 0; // stuck to bottom -> follow live
    } else {
      this.offset += 1;
      this.unseen += 1; // scrolled up -> HOLD position, count new
    }
    this.renderTranscript();
    this.renderStatus();
  }

  private get maxOffset(): number {
    return Math.max(0, this.transcript.length - this.regions.transHeight);
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
    if (this.tty) {
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

  /** Visible window (for tests + render): [startIndex, lines[]]. */
  visibleWindow(): [number, string[]] {
    const h = this.regions.transHeight;
    const end = this.transcript.length - this.offset;
    const start = Math.max(0, end - h);
    return [start, this.transcript.slice(start, end)];
  }

  // ---- rendering ----
  renderAll(): void {
    this.renderHeader();
    this.renderTranscript();
    this.renderStatus();
    this.renderInput();
  }

  private renderHeader(): void {
    for (let i = 0; i < this.headerH; i++) {
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
    const uvt =
      this.mode === "api"
        ? `UVT ${this.fmt(p.uvtUsed)}/${this.fmt(p.uvtCap)} ${this.bar(p.uvtUsed, p.uvtCap)}`
        : "local";
    const scroll = this.following ? "" : `${DIM}  ▲ paused · ${this.unseen}↓ new · End=live${RST}`;
    const line = `${p.hb}  ${p.stage ? "* " + p.stage : ""} ${p.art}   ${uvt}${scroll}`;
    process.stdout.write(at(this.regions.statusRow, 1) + CLR_LINE + this.fit(line, true));
  }

  private renderInput(): void {
    process.stdout.write(at(this.regions.inputRow, 1) + CLR_LINE + this.fit(`@user] ${this.input}`) + SHOW);
  }

  setHeartbeat(g: string): void {
    this.parts.hb = g;
    if (this.tty) this.renderStatus();
  }

  setStage(stage: string, art: string): void {
    this.parts.stage = stage;
    this.parts.art = art;
    if (this.tty) this.renderStatus();
  }

  setUvt(used: number, cap: number): void {
    this.parts.uvtUsed = used;
    this.parts.uvtCap = cap;
    if (this.tty) this.renderStatus();
  }

  setInput(text: string): void {
    this.input = text;
    if (this.tty) this.renderInput();
  }

  private onResize(): void {
    this.cols = process.stdout.columns || this.cols;
    this.rows = process.stdout.rows || this.rows;
    this.regions = computeRegions(this.rows, this.headerH);
    if (this.following) this.offset = 0;
    else this.offset = Math.min(this.offset, this.maxOffset);
    process.stdout.write(ESC + "2J");
    this.renderAll();
  }

  private fit(s: string, hasAnsi = false): string {
    if (hasAnsi) return s; // status line owns its own width via the visible parts
    return s.length > this.cols ? s.slice(0, this.cols) : s;
  }

  private fmt(n: number): string {
    return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);
  }

  private bar(u: number, c: number, w = 10): string {
    const f = c ? Math.round((u / c) * w) : 0;
    return "▓".repeat(f) + "░".repeat(Math.max(0, w - f));
  }

  private installCleanup(): void {
    if (this.cleanupBound) return;
    this.cleanupBound = true;
    const restore = (): void => {
      try {
        process.stdout.write((this.mouse ? MOUSE_OFF : "") + SHOW + ALT_OFF);
      } catch {
        /* terminal already gone */
      }
    };
    process.on("exit", restore);
    process.on("SIGINT", () => {
      restore();
      process.exit(130);
    });
    process.on("SIGTERM", () => {
      restore();
      process.exit(143);
    });
  }
}
