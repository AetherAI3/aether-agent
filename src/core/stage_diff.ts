// UVT /stage-diff — unified diff + conventional commit message.

import { execSync } from "node:child_process";

export interface StageDiffResult {
  diff: string;
  files: string[];
  commitMessage: string;
  stats: { additions: number; deletions: number; filesChanged: number };
}

export function generateDiff(): StageDiffResult {
  const cwd = process.cwd();
  let diff = "";
  let files: string[] = [];
  let additions = 0;
  let deletions = 0;

  try {
    diff = execSync("git diff", { cwd, encoding: "utf8", timeout: 10000 });
    const status = execSync("git diff --name-only", { cwd, encoding: "utf8", timeout: 5000 });
    files = status.trim().split("\n").filter(Boolean);
    const statOut = execSync("git diff --stat", { cwd, encoding: "utf8", timeout: 5000 });
    const lastLine = statOut.trim().split("\n").pop() ?? "";
    const match = lastLine.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(\-\))?/);
    if (match) {
      additions = parseInt(match[2] ?? "0");
      deletions = parseInt(match[3] ?? "0");
    }
  } catch (err) {
    throw new Error(`git diff failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (files.length === 0) {
    return { diff: "", files: [], commitMessage: "", stats: { additions: 0, deletions: 0, filesChanged: 0 } };
  }

  const commitMessage = generateCommitMessage(files, { additions, deletions });
  return { diff, files, commitMessage, stats: { additions, deletions, filesChanged: files.length } };
}

const TYPE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /test/i, type: "test" },
  { pattern: /docs?|readme/i, type: "docs" },
  { pattern: /fix|bug/i, type: "fix" },
  { pattern: /routes?|endpoint|api/i, type: "feat" },
  { pattern: /component|ui|style|css/i, type: "style" },
  { pattern: /config|setup|docker/i, type: "chore" },
  { pattern: /refactor/i, type: "refactor" },
];

function generateCommitMessage(
  files: string[],
  stats: { additions: number; deletions: number },
): string {
  let type = "feat";
  for (const { pattern, type: t } of TYPE_PATTERNS) {
    if (files.some((f) => pattern.test(f))) {
      type = t;
      break;
    }
  }

  const dirs = files.map((f) => f.split("/")[0]);
  const scope = [...new Set(dirs)].length === 1 ? dirs[0] : null;
  const mainFile = files[0]?.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "changes";
  const scopeStr = scope ? `(${scope})` : "";
  const summary = `${type}${scopeStr}: update ${mainFile}`;
  const body = files.slice(0, 6).map((f) => `- ${f}`).join("\n");
  const more = files.length > 6 ? `\n- ... and ${files.length - 6} more files` : "";

  return [
    summary,
    "",
    body + more,
    "",
    `+${stats.additions} -${stats.deletions} · ${files.length} files`,
  ].join("\n");
}
