// Tool executor — the ONE tool implementation, host-side. Both brains (local
// and cloud) emit tool_call events; the host executes them here and returns a
// tool_result. One path-guard, one output cap, identical for local and cloud.
//
// Output format mirrors the Python reference (`[exit N]\n<output>`) so the
// brain's grounding gate (tests_pass / parse_fail_count) reads the same shape
// regardless of which side originally ran it.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import type { ToolName } from "./brain_protocol.js";
import { validateToolCall } from "./tool_registry.js";
import { GitCommitGuard, SpawnGitRunner } from "./git_commit_guard.js";
import { webFetch, webSearch } from "./web.js";

const MAX_OUTPUT = 8000;
const DEFAULT_TEST_CMD = "pytest -q";
const SNAPSHOT_MAX_BYTES = 1024 * 1024;
const SEARCH_MAX_HITS = 40;
const SEARCH_SKIP_DIRS = new Set([".git", "node_modules", "dist"]);

export interface ToolResult {
  output: string;
  exitCode: number;
}

export interface FileSnapshot {
  existed: boolean;
  text: string | null;
  reason?: "binary" | "too-big" | "unsafe";
}

export class ToolExecutor {
  private readonly root: string;
  private readonly committer: GitCommitGuard;

  constructor(
    cwd: string,
    private readonly testCmd: string = DEFAULT_TEST_CMD,
  ) {
    // Canonicalize the root once (resolve any symlinks in the workspace path).
    const r = resolve(cwd);
    this.root = existsSync(r) ? realpathSync(r) : r;
    this.committer = new GitCommitGuard(new SpawnGitRunner(this.root));
  }

  /**
   * Resolve a workspace-relative path and refuse any escape. The guard
   * canonicalizes BEFORE the allowlist check so it cannot be bypassed by:
   *  - `..` traversal (resolve collapses it),
   *  - an absolute path (resolve replaces the base),
   *  - a symlink pointing outside the worktree (realpath on the nearest
   *    existing ancestor follows the link, so the real target is checked).
   * The non-existent tail of a write target can't contain a symlink (it doesn't
   * exist yet), so checking the real ancestor is sufficient.
   */
  private safe(path: string): string {
    const abs = resolve(this.root, path);
    let ancestor = abs;
    while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) {
      ancestor = dirname(ancestor);
    }
    const realAncestor = existsSync(ancestor) ? realpathSync(ancestor) : ancestor;
    const within = realAncestor === this.root || realAncestor.startsWith(this.root + sep);
    if (!within) {
      throw new Error(`refusing path outside workspace: ${path}`);
    }
    return abs;
  }

  /** Run a shell command in the workspace; capture combined output, capped. */
  private run(command: string, timeoutMs = 900_000): ToolResult {
    const r = spawnSync(command, {
      shell: true,
      cwd: this.root,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) {
      const err = r.error as NodeJS.ErrnoException;
      if (err.code === "ETIMEDOUT") {
        return { output: `[timeout after ${Math.round(timeoutMs / 1000)}s]`, exitCode: 124 };
      }
      const code = err.code === "ENOENT" ? 127 : 1;
      return { output: `[spawn error ${err.code ?? "UNKNOWN"}: ${err.message}]`, exitCode: code };
    }
    const code = r.status ?? 1;
    const body = capHeadTail((r.stdout ?? "") + (r.stderr ?? ""), MAX_OUTPUT);
    return { output: `[exit ${code}]\n${body}`, exitCode: code };
  }

  /**
   * Dispatch one SYNC tool call (the 6 file/shell tools). Never throws —
   * guard/IO errors become output. The two web tools are async (network +
   * SSRF resolve) and live on executeAsync; called here they return a clear
   * pointer rather than silently no-op'ing.
   */
  execute(name: string, rawArgs: unknown): ToolResult {
    const validation = validateToolCall(name, rawArgs);
    if (!validation.ok) {
      return { output: `[tool ${name} rejected: ${validation.error}]`, exitCode: 1 };
    }
    const args = validation.args;
    try {
      switch (name as ToolName) {
        case "read_file":
          return this.readFile(String(args["path"] ?? ""));
        case "write_file":
          return this.writeFile(String(args["path"] ?? ""), String(args["content"] ?? ""));
        case "run_shell":
          return this.run(String(args["command"] ?? ""));
        case "run_tests":
          return this.run(String(args["command"] ?? "") || this.testCmd);
        case "repo_search":
          return this.repoSearch(String(args["query"] ?? ""));
        case "git_commit":
          return this.gitCommit(String(args["message"] ?? ""));
        case "web_search":
        case "web_fetch":
          return { output: `[tool ${name} is async — call executeAsync]`, exitCode: 1 };
        default:
          return { output: `[unknown tool: ${name}]`, exitCode: 1 };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: `[tool ${name} error: ${msg}]`, exitCode: 1 };
    }
  }

  /**
   * Dispatch one tool call, awaiting the async web tools and delegating the 6
   * sync tools to execute(). The host loop calls this so file/shell stay sync
   * (identical behavior) while web_search/web_fetch get their network path.
   * Web tools never throw — they return a bracketed string, exit 0 (advisory
   * output the brain reads as ordinary tool output).
   */
  async executeAsync(name: string, rawArgs: unknown): Promise<ToolResult> {
    const validation = validateToolCall(name, rawArgs);
    if (!validation.ok) {
      return { output: `[tool ${name} rejected: ${validation.error}]`, exitCode: 1 };
    }
    const args = validation.args;
    if (name === "web_search") {
      const limit = Number(args["limit"]);
      const text = await webSearch(
        String(args["query"] ?? ""),
        Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5,
      );
      return { output: capHeadTail(text, MAX_OUTPUT), exitCode: 0 };
    }
    if (name === "web_fetch") {
      const text = await webFetch(String(args["url"] ?? ""), MAX_OUTPUT);
      return { output: capHeadTail(text, MAX_OUTPUT), exitCode: 0 };
    }
    return this.execute(name, args);
  }

  private readFile(path: string): ToolResult {
    const abs = this.safe(path);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return { output: `[no such file: ${path}]`, exitCode: 1 };
    }
    return { output: readFileSync(abs, "utf8").slice(0, MAX_OUTPUT), exitCode: 0 };
  }

  private writeFile(path: string, content: string): ToolResult {
    const abs = this.safe(path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    return { output: `[wrote ${path} · ${Buffer.byteLength(content)} bytes]`, exitCode: 0 };
  }

  snapshot(path: string): FileSnapshot {
    let abs: string;
    try {
      abs = this.safe(path);
    } catch {
      return { existed: false, text: null, reason: "unsafe" };
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) return { existed: false, text: null };
    if (statSync(abs).size > SNAPSHOT_MAX_BYTES) return { existed: true, text: null, reason: "too-big" };
    const buf = readFileSync(abs);
    if (buf.includes(0)) return { existed: true, text: null, reason: "binary" };
    return { existed: true, text: buf.toString("utf8") };
  }

  private repoSearch(query: string): ToolResult {
    if (!query) return { output: "[exit 0]\n", exitCode: 0 };

    const hits: string[] = [];
    const visit = (dir: string): void => {
      if (hits.length >= SEARCH_MAX_HITS) return;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (hits.length >= SEARCH_MAX_HITS) return;
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) {
          if (SEARCH_SKIP_DIRS.has(ent.name)) continue;
          const child = resolve(dir, ent.name);
          const real = realpathSync(child);
          if (real === this.root || real.startsWith(this.root + sep)) visit(child);
          continue;
        }
        if (!ent.isFile()) continue;

        const file = resolve(dir, ent.name);
        const buf = readFileSync(file);
        if (buf.includes(0)) continue;
        const rel = "./" + relative(this.root, file).split(sep).join("/");
        const lines = buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
        for (let i = 0; i < lines.length && hits.length < SEARCH_MAX_HITS; i++) {
          const line = lines[i]!;
          if (line.includes(query)) hits.push(`${rel}:${i + 1}:${line}`);
        }
      }
    };

    visit(this.root);
    return { output: `[exit 0]\n${capHeadTail(hits.join("\n"), MAX_OUTPUT)}`, exitCode: 0 };
  }

  private gitCommit(message: string): ToolResult {
    return this.committer.commit(message);
  }
}

/** Cap text to `max` chars keeping BOTH ends. Test runners print detail first and
 * the summary (`N failed`, final assertion) LAST — a head-only slice loses the
 * count the brain parses. Keep ~1/3 head + ~2/3 tail with an elision marker. */
export function capHeadTail(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max / 3);
  const tail = max - head;
  return text.slice(0, head) + `\n…[${text.length - max} chars elided]…\n` + text.slice(text.length - tail);
}
