// Session status bar — the Unlimited Context pool-fill line. The denominator is
// the user's selected pool size (`pool_gb x 233M tokens`), so the bar always
// reads against THEIR pool, not a fixed number. Mirrors aether_agent/statusbar.py.
//
//   anchoring context ＿φ(°-°=) local/cache  [ 412.6M / 1.17B tokens ] |███░░| 35.4%
//
// Cheap: two ints + a string, off the hot path. Clamps at 100% (the pool fades
// stale slices to hold the line — it recycles, never hard-stops).

export const TOKENS_PER_GB = 233_000_000;

// phase -> [label, kaomoji]. Tracks the agent's current activity (the spec set).
const REASONING: [string, string] = ["reasoning", "(๑•̀ㅂ•́)و✧✎"];
const PHASES: Record<string, [string, string]> = {
  anchoring: ["anchoring context", "＿φ(°-°=)"],
  scanning: ["scanning repo", "(ノ￣ー￣)ノ⌨"],
  reasoning: REASONING,
  grounding: ["grounding", "( Ò﹏Ó)✎"],
  paging: ["paging", "(⌨_⌨)"],
};

export function humanTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

/** Render one status-bar line. `usedTokens` encoded in the pool; `poolGb` sets
 * the denominator. `poolCap` may be passed directly (from the status event);
 * otherwise it's derived from poolGb. */
export function renderStatusBar(
  usedTokens: number,
  poolGb: number,
  phase = "reasoning",
  width = 30,
  poolCap?: number,
): string {
  const cap = poolCap && poolCap > 0 ? poolCap : poolGb * TOKENS_PER_GB;
  const frac = cap <= 0 ? 0 : Math.min(1, usedTokens / cap);
  const filled = Math.round(frac * width);
  const bar = "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
  const [label, kao] = PHASES[phase] ?? REASONING;
  return (
    `  ${label} ${kao} local/cache  ` +
    `[ ${humanTokens(usedTokens)} / ${humanTokens(cap)} tokens ] ` +
    `|${bar}| ${(frac * 100).toFixed(1)}%`
  );
}
