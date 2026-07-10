// Task ledger — the multi-task surface. A small, pure, dependency-free model of
// "several things to do" with a live state per item, rendered two ways: a
// compact one-liner for the pinned status line (summary) and a full checklist
// for scrollback (panel). Drives BOTH the `aether code` stage pipeline and the
// orchestrator's task_* frames, so a run is never shown as a single opaque task.
//
// Glyphs: pending ○ · active ◐ · done ✓ · failed ✗ · skipped ◌. Colors track
// state (done=green, failed=red, active=cyan + a live kaomoji), and the active
// face keeps the ledger in sync with the animated status line.

import { theme, clipCodePoints } from "./theme.js";
import { kaomoji } from "./kaomoji.js";

export type StepState = "pending" | "active" | "done" | "failed" | "skipped";

export interface LedgerStep {
  label: string;
  state: StepState;
}

export const GLYPH: Record<StepState, string> = {
  pending: "○",
  active: "◐",
  done: "✓",
  failed: "✗",
  skipped: "◌",
};

const clip = clipCodePoints;

export class TaskLedger {
  private readonly steps: LedgerStep[] = [];
  private readonly idx = new Map<string, number>();

  constructor(labels: string[] = []) {
    for (const l of labels) this.add(l);
  }

  /** Append a pending step. The label doubles as its id; adding a known label
   *  is a no-op (idempotent — safe to call from every event). */
  add(label: string): this {
    if (!this.idx.has(label)) {
      this.idx.set(label, this.steps.length);
      this.steps.push({ label, state: "pending" });
    }
    return this;
  }

  /** Mark a step active. By default any previously-active step is completed, so
   *  a linear pipeline advances cleanly without bookkeeping at the call site. */
  setActive(label: string, completePrevious = true): this {
    this.add(label);
    if (completePrevious) {
      for (const s of this.steps) if (s.state === "active") s.state = "done";
    }
    this.steps[this.idx.get(label)!]!.state = "active";
    return this;
  }

  /** Force a step into a state (done/failed/skipped/…). Adds it if unknown. */
  setState(label: string, state: StepState): this {
    this.add(label);
    this.steps[this.idx.get(label)!]!.state = state;
    return this;
  }

  /** Mark every still-open (pending/active) step done — call at a clean finish. */
  finishAll(): this {
    for (const s of this.steps) if (s.state === "pending" || s.state === "active") s.state = "done";
    return this;
  }

  /** Mark the currently-active step failed (the step that just broke). */
  failActive(): this {
    const a = this.steps.find((s) => s.state === "active");
    if (a) a.state = "failed";
    return this;
  }

  counts(): Record<StepState, number> {
    const c: Record<StepState, number> = { pending: 0, active: 0, done: 0, failed: 0, skipped: 0 };
    for (const s of this.steps) c[s.state]++;
    return c;
  }

  get size(): number {
    return this.steps.length;
  }

  isComplete(): boolean {
    return this.steps.length > 0 && this.steps.every((s) => s.state !== "pending" && s.state !== "active");
  }

  /** A compact one-liner for the pinned status line: `2/5 ✗1 ◐ writing tests`. */
  summary(): string {
    const total = this.steps.length;
    if (total === 0) return "";
    const c = this.counts();
    const settled = c.done + c.skipped + c.failed;
    const active = this.steps.find((s) => s.state === "active");
    const parts = [theme.cyan(`${settled}/${total}`)];
    if (c.failed > 0) parts.push(theme.red(`${GLYPH.failed}${c.failed}`));
    if (active) parts.push(theme.dim(`${GLYPH.active} ${active.label}`));
    return parts.join(" ");
  }

  /** Just the settled/total (+ failures) counter, no active label — for a pinned
   *  status line that already shows the current step's name elsewhere. */
  progress(): string {
    const total = this.steps.length;
    if (total === 0) return "";
    const c = this.counts();
    const settled = c.done + c.skipped + c.failed;
    const base = theme.cyan(`${settled}/${total}`);
    return c.failed > 0 ? `${base} ${theme.red(`${GLYPH.failed}${c.failed}`)}` : base;
  }

  /** A full checklist for scrollback — one styled line per step. */
  panel(cols = 80): string[] {
    return this.steps.map((s) => styleStep(s, Math.max(20, cols)));
  }
}

/** One styled checklist line: glyph + label (+ a live face for active/failed). */
function styleStep(s: LedgerStep, cols: number): string {
  const face =
    s.state === "active" ? "  " + kaomoji("active") : s.state === "failed" ? "  " + kaomoji("error") : "";
  const plain = clip(`  ${GLYPH[s.state]} ${s.label}${face}`, cols);
  switch (s.state) {
    case "done":
      return theme.green(plain);
    case "failed":
      return theme.red(plain);
    case "active":
      return theme.cyan(plain);
    case "skipped":
      return theme.muted(plain);
    default:
      return theme.dim(plain);
  }
}
