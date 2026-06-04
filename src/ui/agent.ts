// Agentic-visibility renderers — the Aether AI agent's internal monologue +
// tool execution, in real time.
//
//   Aether AI
//   * creating worktree (๑•̀ㅂ•́)و✧✎ aether/worktree |████████████████████####| 80%
//     : (ノ￣ー￣)ノ⌨ recon -
//        scanning uvt diagram and financial logs. |██████████##########| 20%

import { theme } from "./theme.js";
import { progressParts } from "./progress.js";
import { kaomoji, type AgentState } from "./kaomoji.js";

/** Bold "Aether AI" header above an agent run. */
export function header(): string {
  return theme.bold("Aether AI");
}

function bar(fraction: number, width: number): string {
  const { filled, empty, pct } = progressParts(fraction, width);
  return `|${theme.cyan(filled)}${theme.dim(empty)}| ${pct}%`;
}

/** Primary action line: `* {desc} {kaomoji} {target} |{bar}| {pct}`. */
export function actionLine(
  desc: string,
  state: AgentState,
  target: string,
  fraction: number,
): string {
  return `${theme.cyan("*")} ${desc} ${kaomoji(state)} ${theme.dim(target)}  ${bar(fraction, 24)}`;
}

/**
 * Nested sub-action (recon / tool usage), indented below its primary action:
 *   : {kaomoji} {tool} -
 *      {detail} |{bar}|
 */
export function subActionLine(
  state: AgentState,
  tool: string,
  detail: string,
  fraction: number,
): string {
  const head = `  ${theme.muted(":")} ${kaomoji(state)} ${tool} -`;
  const body = `     ${theme.dim(detail)}  ${bar(fraction, 20)}`;
  return `${head}\n${body}`;
}
