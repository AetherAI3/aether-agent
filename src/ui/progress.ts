// Progress bar. Completed blocks = █, remaining = #, percentage affixed right.
//   |████████████████████####| 80%
// Pure (no color) so it's testable; the caller paints the filled run.

export function progressBar(fraction: number, width = 24): string {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const filled = Math.round(f * width);
  const empty = Math.max(0, width - filled);
  const pct = Math.round(f * 100);
  return `|${"█".repeat(filled)}${"#".repeat(empty)}| ${pct}%`;
}

/** Split into pieces so the caller can color the filled run (cyan/ice-blue). */
export function progressParts(fraction: number, width = 24): {
  filled: string;
  empty: string;
  pct: number;
} {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const filled = Math.round(f * width);
  return {
    filled: "█".repeat(filled),
    empty: "#".repeat(Math.max(0, width - filled)),
    pct: Math.round(f * 100),
  };
}
