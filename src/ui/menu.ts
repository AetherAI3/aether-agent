// Pure arrow-key select menu: model + string renderer. Zero terminal I/O —
// the interactive loop (commands/mcp.ts) feeds keys in and writes frames out.
// Same testability pattern as InputBuffer (ui/input_line.ts).

import { theme, stripAnsi } from "./theme.js";

export { stripAnsi };

export interface MenuItem {
  id: string;
  label: string;
  /** Status glyph rendered before the label (✔ ○ ✖ ● …). */
  glyph?: string;
  /** Dim hint after the label (e.g. "connected", "local"). */
  hint?: string;
  /** Disabled rows (separators/headers) are skipped by the cursor. */
  disabled?: boolean;
}

export class SelectMenu {
  cursor = 0;

  constructor(public readonly items: MenuItem[]) {
    if (!this.enabled(this.cursor)) this.cursor = this.next(0, 1);
  }

  private enabled(i: number): boolean {
    return !!this.items[i] && !this.items[i]?.disabled;
  }

  /** Next enabled index from `from` in direction `dir`, wrapping. -1 if none. */
  private next(from: number, dir: 1 | -1): number {
    const n = this.items.length;
    if (n === 0) return -1;
    for (let step = 0; step < n; step++) {
      const i = (((from + dir * step) % n) + n) % n;
      if (this.enabled(i)) return i;
    }
    return -1;
  }

  up(): void {
    const n = this.items.length;
    if (n === 0) return;
    const i = this.next((((this.cursor - 1) % n) + n) % n, -1);
    if (i >= 0) this.cursor = i;
  }

  down(): void {
    if (this.items.length === 0) return;
    const i = this.next((this.cursor + 1) % this.items.length, 1);
    if (i >= 0) this.cursor = i;
  }

  selected(): MenuItem | null {
    const it = this.items[this.cursor];
    return it && !it.disabled ? it : null;
  }
}

const WIDTH = 56;

function row(inner: string): string {
  const pad = Math.max(0, WIDTH - 2 - stripAnsi(inner).length);
  return `│ ${inner}${" ".repeat(pad)} │`;
}

/** Render one full frame of the menu as a rounded ASCII box. */
export function renderMenu(title: string, menu: SelectMenu, footer: string): string {
  const bar = "─".repeat(WIDTH);
  const lines: string[] = [];
  lines.push(`╭${bar}╮`);
  lines.push(row(theme.bold(title)));
  lines.push(`├${bar}┤`);
  if (menu.items.length === 0) lines.push(row(theme.dim("(nothing here yet)")));
  for (let i = 0; i < menu.items.length; i++) {
    const it = menu.items[i];
    if (!it) continue;
    if (it.disabled) {
      lines.push(row(theme.dim(it.label)));
      continue;
    }
    const cur = i === menu.cursor;
    const pointer = cur ? theme.cyan("❯") : " ";
    const glyph = it.glyph ?? " ";
    const label = cur ? theme.bold(it.label) : it.label;
    const hint = it.hint ? "  " + theme.dim(it.hint) : "";
    lines.push(row(`${pointer} ${glyph} ${label}${hint}`));
  }
  lines.push(`├${bar}┤`);
  lines.push(row(theme.dim(footer)));
  lines.push(`╰${bar}╯`);
  return lines.join("\n") + "\n";
}
