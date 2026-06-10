// src/ui/input_line.ts — a small, testable input model for the pinned prompt.
// Owns the edit buffer, cursor, and history; terminal wiring (raw mode,
// bracketed paste, key decode) lives in chat.ts and calls these pure methods.

export class InputBuffer {
  private chars: string[] = [];
  private cursor = 0;
  private history: string[] = [];
  private histIdx = -1;

  get value(): string {
    return this.chars.join("");
  }
  get pos(): number {
    return this.cursor;
  }

  insert(s: string): void {
    for (const ch of s) {
      this.chars.splice(this.cursor, 0, ch);
      this.cursor++;
    }
  }
  /** A bracketed-paste block: inserted verbatim (newlines kept) at the cursor. */
  paste(block: string): void {
    this.insert(block);
  }
  backspace(): void {
    if (this.cursor > 0) {
      this.chars.splice(this.cursor - 1, 1);
      this.cursor--;
    }
  }
  /** Delete the char at the cursor (the `Del` key). */
  deleteForward(): void {
    if (this.cursor < this.chars.length) this.chars.splice(this.cursor, 1);
  }
  /** Kill from the cursor to end of line (ctrl-k). */
  killToEnd(): void {
    this.chars.splice(this.cursor);
  }
  /** Kill from start of line to the cursor (ctrl-u). */
  killToStart(): void {
    this.chars.splice(0, this.cursor);
    this.cursor = 0;
  }
  deleteWord(): void {
    let i = this.cursor;
    while (i > 0 && this.chars[i - 1] === " ") i--;
    while (i > 0 && this.chars[i - 1] !== " ") i--;
    this.chars.splice(i, this.cursor - i);
    this.cursor = i;
  }
  left(): void {
    if (this.cursor > 0) this.cursor--;
  }
  right(): void {
    if (this.cursor < this.chars.length) this.cursor++;
  }
  home(): void {
    this.cursor = 0;
  }
  end(): void {
    this.cursor = this.chars.length;
  }
  clear(): void {
    this.chars = [];
    this.cursor = 0;
    this.histIdx = -1;
  }
  /** Record a submitted line into history and clear the buffer. */
  commit(line: string): void {
    if (line.trim()) this.history.push(line);
    this.clear();
  }
  historyUp(): void {
    if (this.history.length === 0) return;
    this.histIdx = this.histIdx < 0 ? this.history.length - 1 : Math.max(0, this.histIdx - 1);
    this.setTo(this.history[this.histIdx]!);
  }
  historyDown(): void {
    if (this.histIdx < 0) return;
    this.histIdx++;
    if (this.histIdx >= this.history.length) {
      this.histIdx = -1;
      this.setTo("");
    } else {
      this.setTo(this.history[this.histIdx]!);
    }
  }
  private setTo(s: string): void {
    this.chars = [...s];
    this.cursor = this.chars.length;
  }
}
