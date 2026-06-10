// src/ui/md_stream.ts — minimal streaming markdown styler for chat answers.
// Line-buffered: complete lines get structural styling (headers, fences,
// bullets, blockquotes) plus inline styling (bold, inline code); a partial
// line that grows past a threshold is flushed raw so long prose never feels
// held back. Inside a code fence the text passes through untouched (copy
// fidelity), only the fence markers themselves are dimmed.
//
// When disabled (non-TTY, NO_COLOR, --json) feed() is a pure passthrough,
// byte-for-byte. Input is expected to be sanitized already (sanitizeTerm).

import { createTheme, type Theme } from "./theme.js";

const FLUSH_PARTIAL_AT = 160; // columns of un-newlined prose before raw flush

export class MdStream {
  private partial = "";
  private inFence = false;
  private partialFlushed = false; // current line already emitted raw → don't restyle
  private readonly theme: Theme;

  constructor(private readonly enabled: boolean, theme?: Theme) {
    this.theme = theme ?? createTheme(enabled);
  }

  /** Feed a chunk of streamed text; returns what should be written now. */
  feed(text: string): string {
    if (!this.enabled) return text;
    let out = "";
    this.partial += text;
    let nl = this.partial.indexOf("\n");
    while (nl >= 0) {
      const line = this.partial.slice(0, nl);
      this.partial = this.partial.slice(nl + 1);
      out += this.partialFlushed ? line + "\n" : this.styleLine(line) + "\n";
      this.partialFlushed = false;
      nl = this.partial.indexOf("\n");
    }
    // Long un-newlined prose: flush raw so streaming never visibly stalls.
    if (!this.partialFlushed && this.partial.length >= FLUSH_PARTIAL_AT && !this.isStructural(this.partial)) {
      out += this.partial;
      this.partial = "";
      this.partialFlushed = true;
    }
    return out;
  }

  /** Flush whatever partial line remains (end of stream). */
  flush(): string {
    if (!this.enabled) return "";
    const rest = this.partial;
    this.partial = "";
    if (!rest) return "";
    if (this.partialFlushed) {
      this.partialFlushed = false;
      return rest;
    }
    return this.styleLine(rest);
  }

  /** Lines that must wait for their newline to be styled correctly. */
  private isStructural(s: string): boolean {
    const t = s.trimStart();
    return t.startsWith("#") || t.startsWith("```") || t.startsWith(">") || /^[-*] /.test(t);
  }

  private styleLine(line: string): string {
    const t = this.theme;
    const trimmed = line.trimStart();
    // Fence open/close — dim the marker row, raw passthrough inside.
    if (trimmed.startsWith("```")) {
      this.inFence = !this.inFence;
      return t.dim(line);
    }
    if (this.inFence) return line;
    // Headers: dim the hashes, bold the title.
    const h = /^(\s*)(#{1,6}) (.*)$/.exec(line);
    if (h) return h[1]! + t.dim(h[2]!) + " " + t.bold(this.styleInline(h[3]!));
    // Blockquote: dim the marker, style the rest.
    const q = /^(\s*)> ?(.*)$/.exec(line);
    if (q) return q[1]! + t.dim("│") + " " + this.styleInline(q[2]!);
    // Bullets: substitute a tidy glyph.
    const b = /^(\s*)[-*] (.*)$/.exec(line);
    if (b) return b[1]! + t.cyan("•") + " " + this.styleInline(b[2]!);
    return this.styleInline(line);
  }

  /** Inline styling on one complete line: `code` spans, then **bold**.
   *  Unmatched markers are left literal — never guess across lines. */
  private styleInline(s: string): string {
    const t = this.theme;
    let out = s.replace(/`([^`\n]+)`/g, (_m, code: string) => t.cyan(code));
    out = out.replace(/\*\*([^*\n]+)\*\*/g, (_m, body: string) => t.bold(body));
    return out;
  }
}
