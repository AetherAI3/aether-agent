// /why — a bounded in-process explanation log. Skill selection, refusals,
// permission denials, capability warnings, doctor warnings, and instruction
// conflicts record one line each; /why replays the latest so the user never
// gets an opaque internal exception as the only answer.

export type WhyKind =
  | "skill-selection"
  | "skill-refusal"
  | "permission-denial"
  | "capability"
  | "doctor"
  | "provider-fallback"
  | "context-clipping"
  | "instruction-conflict";

export interface WhyEntry {
  kind: WhyKind;
  text: string;
  at: string;
}

const MAX_ENTRIES = 50;
const entries: WhyEntry[] = [];

export function recordWhy(kind: WhyKind, text: string, now = new Date()): void {
  entries.push({ kind, text, at: now.toISOString() });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function latestWhy(limit = 10): readonly WhyEntry[] {
  return entries.slice(-limit);
}

export function renderWhy(limit = 10): string {
  const latest = latestWhy(limit);
  if (!latest.length) {
    return "nothing to explain yet — skill selections, refusals, conflicts, and capability warnings appear here.\n";
  }
  return latest.map((entry) => "[" + entry.kind + "] " + entry.text).join("\n") + "\n";
}

/** Test hook: reset the log. */
export function clearWhy(): void {
  entries.length = 0;
}
