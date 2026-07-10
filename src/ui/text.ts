// src/ui/text.ts — shared terminal-text utilities: ANSI-aware width math,
// truncation, wrapping, and sanitation of stream-sourced text. Every renderer
// uses THESE; no module keeps a private stripAnsi/width copy.

// CSI … final byte | OSC … BEL/ST | DCS/SOS/PM/APC … ST | 2-char escapes
const ANSI_RE =
  /\x1b\[[0-9;:<=>?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]/g;

// SGR only — the subset that is safe to carry across wrapped rows.
const SGR_RE = /^\x1b\[[0-9;]*m/;

/** Strip ALL ANSI escape sequences (SGR, CSI, OSC incl. hyperlinks, DCS…). */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Visible column width of one code point (wcwidth-lite: wide CJK/emoji = 2,
 *  combining/zero-width = 0, everything else 1). */
export function charWidth(cp: number): number {
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff) return 0;
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f)
  )
    return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1f2ff) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2;
  return 1;
}

/** Visible column width of a styled string (ANSI sequences = 0 columns). */
export function visibleWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0)!);
  return w;
}

/** Truncate to `max` visible columns, preserving escapes (never split one) and
 *  never splitting a wide char; reset-terminated when any escape was emitted. */
export function sliceVisible(s: string, max: number): string {
  if (visibleWidth(s) <= max) return s;
  let out = "";
  let vis = 0;
  let i = 0;
  let sawEsc = false;
  while (i < s.length) {
    if (s[i] === "\x1b") {
      ANSI_RE.lastIndex = 0;
      const m = ANSI_RE.exec(s.slice(i));
      if (m && m.index === 0) {
        out += m[0];
        i += m[0].length;
        sawEsc = true;
        continue;
      }
      i++; // lone malformed ESC: drop it rather than leak a raw byte
      continue;
    }
    const cp = s.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const w = charWidth(cp);
    if (vis + w > max) break;
    out += ch;
    vis += w;
    i += ch.length;
  }
  return sawEsc ? out + "\x1b[0m" : out;
}

/** Wrap a styled logical line into rows of ≤ cols visible columns, carrying
 *  open SGR state onto continuation rows. "" -> [""]. */
export function wrapVisible(s: string, cols: number): string[] {
  const max = Math.max(1, cols);
  if (s === "") return [""];
  const rows: string[] = [];
  let row = "";
  let vis = 0;
  let active: string[] = []; // SGR sequences open at the current point
  let rowSawEsc = false;
  let i = 0;
  const endRow = (): void => {
    rows.push(rowSawEsc ? row + "\x1b[0m" : row);
    row = active.join("");
    rowSawEsc = active.length > 0;
    vis = 0;
  };
  while (i < s.length) {
    if (s[i] === "\x1b") {
      const sgr = SGR_RE.exec(s.slice(i));
      if (sgr) {
        if (sgr[0] === "\x1b[0m" || sgr[0] === "\x1b[m") active = [];
        else active.push(sgr[0]);
        row += sgr[0];
        rowSawEsc = true;
        i += sgr[0].length;
        continue;
      }
      ANSI_RE.lastIndex = 0;
      const m = ANSI_RE.exec(s.slice(i));
      if (m && m.index === 0) {
        row += m[0]; // non-SGR escape: keep in place, never carried across rows
        rowSawEsc = true;
        i += m[0].length;
        continue;
      }
      i++; // lone malformed ESC: drop
      continue;
    }
    const cp = s.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const w = charWidth(cp);
    if (vis + w > max) endRow();
    row += ch;
    vis += w;
    i += ch.length;
  }
  rows.push(rowSawEsc ? row + "\x1b[0m" : row);
  return rows;
}

/** Sanitize stream-sourced text for terminal output: strip all escape
 *  sequences, C0 controls except \n and \t (\r dropped), and the C1 control
 *  range (U+0080–U+009F — U+009B is a single-byte CSI some terminals honor,
 *  and JSON frames can smuggle it as "\u009b"). Defensive gate for
 *  model/server-controlled strings — blocks OSC/CSI injection (title,
 *  clipboard, screen-clear, hidden text). */
export function sanitizeTerm(s: string): string {
  return s
    .replace(ANSI_RE, "")
    .replace(/\x1b/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .replace(/[\u0080-\u009f]/g, "");
}
