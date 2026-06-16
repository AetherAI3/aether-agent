// src/ui/input_line.ts — a small, testable input model for the pinned prompt.
// Owns the edit buffer, cursor, and history; terminal wiring (raw mode,
// bracketed paste, key decode) lives in chat.ts and calls these pure methods.
// History semantics: consecutive duplicates collapse, recalling history
// stashes the in-progress draft (restored when you arrow back down), and the
// REPL persists entries across sessions via core/history_store.

export class InputBuffer {
  private chars: string[] = [];
  private cursor = 0;
  private history: string[] = [];
  private histIdx = -1;
  private draft: string | null = null; // the line being typed when history recall began

  get value(): string {
    return this.chars.join("");
  }
  get pos(): number {
    return this.cursor;
  }

  insert(s: string): void {
    // One O(n) rebuild — splice-per-char is O(n²) and freezes on large pastes.
    const add = [...s];
    this.chars = this.chars.slice(0, this.cursor).concat(add, this.chars.slice(this.cursor));
    this.cursor += add.length;
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
  /** Jump to the start of the previous word (ctrl/alt-left). */
  wordLeft(): void {
    let i = this.cursor;
    while (i > 0 && this.chars[i - 1] === " ") i--;
    while (i > 0 && this.chars[i - 1] !== " ") i--;
    this.cursor = i;
  }
  /** Jump past the end of the next word (ctrl/alt-right). */
  wordRight(): void {
    let i = this.cursor;
    const n = this.chars.length;
    while (i < n && this.chars[i] === " ") i++;
    while (i < n && this.chars[i] !== " ") i++;
    this.cursor = i;
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
    this.draft = null;
  }
  /** Record a submitted line into history and clear the buffer.
   *  Consecutive duplicates collapse to one entry. */
  commit(line: string): void {
    if (line.trim() && this.history[this.history.length - 1] !== line) {
      this.history.push(line);
    }
    this.clear();
  }
  /** Seed history from a persisted store (oldest first). */
  loadHistory(lines: readonly string[]): void {
    this.history = [...lines];
    this.histIdx = -1;
  }
  historyUp(): void {
    if (this.history.length === 0) return;
    if (this.histIdx < 0) {
      this.draft = this.value; // stash what was being typed
      this.histIdx = this.history.length - 1;
    } else {
      this.histIdx = Math.max(0, this.histIdx - 1);
    }
    this.setTo(this.history[this.histIdx]!);
  }
  historyDown(): void {
    if (this.histIdx < 0) return;
    this.histIdx++;
    if (this.histIdx >= this.history.length) {
      this.histIdx = -1;
      this.setTo(this.draft ?? ""); // restore the stashed draft
      this.draft = null;
    } else {
      this.setTo(this.history[this.histIdx]!);
    }
  }
  private setTo(s: string): void {
    this.chars = [...s];
    this.cursor = this.chars.length;
  }
}
