// src/ui/phase_verb.ts — the heartbeat's activity word. A known stage uses an
// anchored present-participle verb; otherwise a whimsical pool is cycled
// deterministically by tick (no Date/random) so the line is honest about
// liveness without flickering between repaints.

export interface Verb {
  verb: string;
  kao: string;
}

const STAGE: Record<string, Verb> = {
  recon: { verb: "Reconnoitring", kao: "( ⚆ _ ⚆ )" },
  parse: { verb: "Parsing", kao: "＿φ(°-°=)" },
  brainstorm: { verb: "Brainstorming", kao: "[•_•]→[•‿•]" },
  "write-plans": { verb: "Drafting", kao: "[⌐■_■]" },
  execute: { verb: "Forging", kao: "(ง'̀-'́)ง" },
  "self-review": { verb: "Scrutinising", kao: "(¬_¬\")" },
  reveal: { verb: "Revealing", kao: "ᕙ(`▽`)ᕗ" },
  anchoring: { verb: "Anchoring", kao: "＿φ(°-°=)" },
  scanning: { verb: "Scanning", kao: "(ノ￣ー￣)ノ⌨" },
  reasoning: { verb: "Reasoning", kao: "(๑•̀ㅂ•́)و✧" },
  grounding: { verb: "Grounding", kao: "( Ò﹏Ó)✎" },
  paging: { verb: "Paging", kao: "(⌨_⌨)" },
  error: { verb: "Recovering", kao: "(；・∀・)" },
  "memory-extract": { verb: "Extracting memory", kao: "(◕‿◕)✎" },
  "memory-skill":   { verb: "Learning skill",   kao: "🧠✨" },
  "compacting":     { verb: "Compacting context", kao: "(；・∀・)📦" },
  "consolidating":  { verb: "Consolidating",    kao: "(￣～￣;)💭" },
  "memory-style":   { verb: "Adapting style",   kao: "(｡•̀ᴗ-)✧" },
};

const WHIMSY: Verb[] = [
  { verb: "Gesticulating", kao: "(｡•̀ᴗ-)✧" },
  { verb: "Pondering", kao: "(￣～￣;)" },
  { verb: "Conjuring", kao: "(づ｡◕‿‿◕｡)づ" },
  { verb: "Percolating", kao: "(¬‿¬)" },
  { verb: "Ruminating", kao: "(._.)" },
  { verb: "Tinkering", kao: "(•_•)>⌐■-■" },
  { verb: "Noodling", kao: "♪(˘▿˘)♪" },
  { verb: "Marinating", kao: "(◕‿◕)" },
];

/** Whimsical verb for a tick (cycles, deterministic). */
export function whimsicalVerb(tick: number): Verb {
  const i = ((tick % WHIMSY.length) + WHIMSY.length) % WHIMSY.length;
  return WHIMSY[i]!;
}

/** Verb for the current stage; `tick` only matters for the whimsical fallback. */
export function phaseVerb(stage: string, tick = 0): Verb {
  return STAGE[stage] ?? whimsicalVerb(tick);
}
