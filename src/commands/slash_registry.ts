// The ONE slash-command registry — pure data, zero imports, so any surface
// (help, splash hints, tab-completion, did-you-mean) can consume it without
// pulling transport/auth into the UI layer. A command that isn't in this table
// doesn't exist; a surface that advertises one that is not here is lying.

export interface SlashCommand {
  /** Canonical name, without the leading slash. */
  name: string;
  /** Argument hint shown in help (e.g. "<n|id>"). */
  args?: string;
  desc: string;
  aliases?: string[];
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "models", desc: "list chat models" },
  { name: "model", args: "<n|id>", desc: "switch model" },
  { name: "agents", desc: "list orchestrators (Neo/Kronus)" },
  { name: "agent", args: "<n|id>", desc: "switch orchestrator" },
  { name: "tier", desc: "plan tier + default" },
  { name: "audit", args: "[n]", desc: "recent Aether audit trail" },
  { name: "doctor", desc: "diagnose your setup" },
  { name: "mcp", desc: "MCP servers (coming soon)" },
  { name: "clear", desc: "clear screen" },
  { name: "help", desc: "list commands" },
  { name: "exit", desc: "leave", aliases: ["quit"] },
];

/** Every accepted spelling: canonical names + aliases. */
export function slashNames(): string[] {
  return SLASH_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
}

/** Top-level subcommands `aether <cmd>` accepts (mirrors main.ts's switch). */
export const TOP_LEVEL_COMMANDS = [
  "auth",
  "login",
  "logout",
  "audit",
  "models",
  "agents",
  "run",
  "receipt",
  "config",
  "code",
  "chat",
  "help",
];

/**
 * Damerau-Levenshtein distance (with adjacent transposition), so the classic
 * `auht` → `auth` typo counts as ONE edit. Dependency-free DP, fine for the
 * short command vocabulary this is used on.
 */
export function damerau(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[m]![n]!;
}

/** Closest candidate within `max` edits, or null. Ties go to the first (list order). */
export function nearest(input: string, candidates: string[], max: number): string | null {
  let best: string | null = null;
  let bestD = max + 1;
  for (const c of candidates) {
    const dd = damerau(input, c);
    if (dd < bestD) {
      bestD = dd;
      best = c;
    }
  }
  return bestD <= max ? best : null;
}

/**
 * Suggestion for a lone bare token at the top level (`aether auht`). Narrowed
 * per the arena verdict: exact-match tokens are never guarded (main.ts handles
 * them), short tokens (≤5 chars) only match at distance 1, longer at ≤2 —
 * keeping `auht`→auth and `moddels`→models while letting `hello` chat.
 */
export function suggestTopLevel(token: string): string | null {
  if (TOP_LEVEL_COMMANDS.includes(token)) return null;
  const max = token.length <= 5 ? 1 : 2;
  return nearest(token, TOP_LEVEL_COMMANDS, max);
}

/**
 * readline completer source for slash commands: completes `/mo` → /models,
 * /model. Only the command word (no args yet); non-slash lines get no hits.
 * Returns [completions, substringBeingCompleted] per the readline contract.
 */
export function slashCompletions(line: string): [string[], string] {
  if (!line.startsWith("/") || line.includes(" ")) return [[], line];
  const partial = line.slice(1);
  const hits = slashNames()
    .filter((n) => n.startsWith(partial))
    .map((n) => `/${n}`);
  return [hits, line];
}
