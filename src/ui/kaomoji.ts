// Kaomoji that personify the Aether AI agent's internal state + tool execution.
// Source: aether_code_kaomoji.txt.

export type AgentState = "active" | "scanning" | "logging" | "idle" | "error";

export const KAOMOJI: Record<AgentState, string> = {
  active: "(๑•̀ㅂ•́)و✧✎", // creating / compiling
  scanning: "(ノ￣ー￣)ノ⌨", // recon / investigating
  logging: "＿φ(°-°=)", // notetaking / background
  idle: "(⌨_⌨)", // awaiting user input
  error: "( Ò﹏Ó)✎", // error / debugging
};

/** Alternate "active" face, for variety on long-running creates/compiles. */
export const ACTIVE_ALT = "ヾ( ー´)シφ__";

export function kaomoji(state: AgentState): string {
  return KAOMOJI[state];
}
