// Tool executor — the ONE tool implementation, host-side. Both brains (local
// and cloud) emit tool_call events; the host executes them here and returns a
// tool_result. One path-guard, one output cap, identical for local and cloud.
//
// Output format mirrors the Python reference (`[exit N]\n<output>`) so the
// brain's grounding gate (tests_pass / parse_fail_count) reads the same shape
// regardless of which side originally ran it.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { ToolName } from "./brain_protocol.js";

const MAX_OUTPUT = 8000;
const DEFAULT_TEST_CMD = "pytest -q";

export interface ToolResult {
  output: string;
  exitCode: number;
}

export class ToolExecutor {
  private readonly root: string;

  constructor(
    cwd: string,
    private readonly testCmd: string = DEFAULT_TEST_CMD,
  ) {
    // Canonicalize the root once (resolve any symlinks in the workspace path).
    const r = resolve(cwd);
    this.root = existsSync(r) ? realpathSync(r) : r;
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
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      return { output: `[timeout after ${Math.round(timeoutMs / 1000)}s]`, exitCode: 124 };
    }
    const code = r.status ?? 1;
    const body = ((r.stdout ?? "") + (r.stderr ?? "")).slice(0, MAX_OUTPUT);
    return { output: `[exit ${code}]\n${body}`, exitCode: code };
  }

  /** Dispatch one tool call. Never throws — guard/IO errors become output. */
  execute(name: string, args: Record<string, unknown>): ToolResult {
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
        default:
          return { output: `[unknown tool: ${name}]`, exitCode: 1 };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: `[tool ${name} error: ${msg}]`, exitCode: 1 };
    }
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

  private repoSearch(query: string): ToolResult {
    // grep across the tree (ripgrep-free for portability); cap to 40 hits.
    const q = JSON.stringify(query);
    return this.run(`grep -rIn -- ${q} . | head -40`);
  }

  private gitCommit(message: string): ToolResult {
    this.run("git add -A");
    const r = this.run(`git commit -q -m ${JSON.stringify(message)} || echo "[nothing to commit]"`);
    // Surface the new short sha so the brain can emit a checkpoint event.
    const sha = this.run("git rev-parse --short HEAD");
    const head = sha.exitCode === 0 ? sha.output.replace(/^\[exit 0\]\n/, "").trim() : "";
    return { output: `${r.output}\n${head}`.slice(0, MAX_OUTPUT), exitCode: r.exitCode };
  }
}
