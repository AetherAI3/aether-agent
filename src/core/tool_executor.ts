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

const MAX_OUTPUT = 8000;
const DEFAULT_TEST_CMD = "pytest -q";
const SEARCH_MAX_HITS = 40;
const SEARCH_SKIP_DIRS = new Set([".git", "node_modules", "dist"]);

export interface ToolResult {
  output: string;
  exitCode: number;
}

/**
 * A pre-write read of a file, for rendering the live diff. `text` is null when
 * the content is unsuitable to diff (binary or oversized); `reason` says which.
 * Path-guarded by the same allowlist as every other tool — a snapshot can never
 * read outside the workspace.
 */
export interface FileSnapshot {
  existed: boolean;
  text: string | null;
  reason?: "binary" | "too-big";
}

// Files larger than this are not diffed inline (the transcript would drown).
const SNAPSHOT_MAX_BYTES = 1024 * 1024;

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
    const shell =
      process.platform === "win32" ? (process.env["ComSpec"] ?? "C:\\Windows\\System32\\cmd.exe") : true;
    const r = spawnSync(command, {
      shell,
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

  /**
   * Read a file for diffing BEFORE it is overwritten. Same path-guard as every
   * tool. Returns existed=false for a new file (so the host can render `(new)`),
   * and text=null with a reason for binary / oversized content (skip the diff,
   * don't drown the transcript). Never throws — a guard failure reads as a
   * non-existent file so the write still proceeds and surfaces the real error.
   */
  snapshot(path: string): FileSnapshot {
    let abs: string;
    try {
      abs = this.safe(path);
    } catch {
      return { existed: false, text: null };
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return { existed: false, text: null };
    }
    if (statSync(abs).size > SNAPSHOT_MAX_BYTES) {
      return { existed: true, text: null, reason: "too-big" };
    }
    const buf = readFileSync(abs);
    if (buf.includes(0)) {
      return { existed: true, text: null, reason: "binary" };
    }
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

  /** Run a command via argv (no shell) — for git, where the message can
   * contain shell metacharacters the string form of `run()` would interpret. */
  private runArgv(argv: string[], timeoutMs = 900_000): ToolResult {
    const [cmd, ...rest] = argv;
    const r = spawnSync(cmd!, rest, {
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

  private gitCommit(message: string): ToolResult {
    this.run("git add -A");
    // argv form: the commit message reaches git as one real argument, never
    // interpreted by a shell — `fix "cap & retry"` used to split at `&` and
    // could execute what followed it.
    const commit = this.runArgv(["git", "commit", "-q", "-m", message]);
    const nothingToCommit = commit.exitCode !== 0 && /nothing to commit/i.test(commit.output);
    if (commit.exitCode !== 0 && !nothingToCommit) {
      // A real failure (hook rejection, unset user.name, etc.) — surface it
      // as-is. Fetching HEAD here would report the PREVIOUS commit's sha as
      // if this one had landed.
      return commit;
    }
    // Surface the new short sha so the brain can emit a checkpoint event.
    const sha = this.runArgv(["git", "rev-parse", "--short", "HEAD"]);
    const head = sha.exitCode === 0 ? sha.output.replace(/^\[exit 0\]\n/, "").trim() : "";
    const body = nothingToCommit ? "[nothing to commit]" : commit.output;
    return { output: capHeadTail(`${body}\n${head}`, MAX_OUTPUT), exitCode: 0 };
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
