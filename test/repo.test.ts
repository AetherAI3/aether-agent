import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepoSpec, cloneArgs, prCreateHint, refreshMirror } from "../src/core/repo.js";
import type { Runner, RunResult } from "../src/core/worktree.js";

test("parseRepoSpec accepts owner/name", () => {
  const s = parseRepoSpec("octocat/hello-world");
  assert.equal(s.owner, "octocat");
  assert.equal(s.name, "hello-world");
  assert.equal(s.full, "octocat/hello-world");
});

test("parseRepoSpec strips github URL forms and .git", () => {
  assert.equal(parseRepoSpec("https://github.com/octocat/hello-world.git").full, "octocat/hello-world");
  assert.equal(parseRepoSpec("git@github.com:octocat/hello-world").full, "octocat/hello-world");
  assert.equal(parseRepoSpec("octocat/hello-world/").full, "octocat/hello-world");
});

test("parseRepoSpec rejects junk", () => {
  assert.throws(() => parseRepoSpec("not-a-repo"), /expected owner\/name/);
  assert.throws(() => parseRepoSpec("a/b/c"), /expected owner\/name/);
  assert.throws(() => parseRepoSpec(""), /expected owner\/name/);
});

test("parseRepoSpec rejects argument-injection segments (leading dash, '.'/'..')", () => {
  assert.throws(() => parseRepoSpec("-x/y"), /may not start with '-'/);
  assert.throws(() => parseRepoSpec("x/-y"), /may not start with '-'/);
  assert.throws(() => parseRepoSpec("../y"), /'\.'\/'\.\.'/);
  assert.throws(() => parseRepoSpec("a/.."), /'\.'\/'\.\.'/);
  assert.throws(() => parseRepoSpec("./y"), /'\.'\/'\.\.'/);
  // Legit names containing dots/dashes (not leading) still parse.
  assert.equal(parseRepoSpec("my.org/my-repo.js").full, "my.org/my-repo.js");
});

test("cloneArgs uses gh when available, git otherwise", () => {
  const s = parseRepoSpec("octocat/hello-world");
  assert.deepEqual(cloneArgs(s, "/d", true), { cmd: "gh", args: ["repo", "clone", "octocat/hello-world", "/d"] });
  assert.deepEqual(cloneArgs(s, "/d", false), {
    cmd: "git",
    args: ["clone", "https://github.com/octocat/hello-world.git", "/d"],
  });
});

test("prCreateHint targets the repo + branch", () => {
  const hint = prCreateHint(parseRepoSpec("octocat/hello-world"), "aether/fix-1");
  assert.match(hint, /gh pr create -R octocat\/hello-world --head aether\/fix-1 --fill/);
});

// ── mirror freshness (SC-A2) ────────────────────────────────────────────────
// An existing --repo mirror must never be reused as-is. Before a task worktree
// branches off it, the mirror's remote is validated and the mirror is fetched
// through the user's own git/gh auth. When that cannot happen, the result says
// stale or unknown — never fresh.

function recordingRunner(table: Record<string, RunResult>): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = [cmd, ...args].join(" ");
    for (const [pattern, result] of Object.entries(table)) {
      if (key.startsWith(pattern)) return result;
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

const OK = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "" });

test("an existing mirror is fetched, not silently reused", () => {
  const spec = parseRepoSpec("octocat/hello-world");
  const { run, calls } = recordingRunner({
    "git -C": OK("https://github.com/octocat/hello-world.git\n"),
  });
  const result = refreshMirror(spec, "/mirror", run, { exists: true });
  assert.equal(result.freshness.state, "fresh");
  const fetched = calls.some((call) => call.includes("fetch"));
  assert.equal(fetched, true, "an existing mirror must be fetched before use");
});

test("a mirror pointing at a different repo is rejected, never used", () => {
  const spec = parseRepoSpec("octocat/hello-world");
  const { run } = recordingRunner({
    "git -C": OK("https://github.com/somebody-else/other-repo.git\n"),
  });
  assert.throws(
    () => refreshMirror(spec, "/mirror", run, { exists: true }),
    /does not point at octocat\/hello-world/,
  );
});

test("a failed fetch reports unknown, never fresh", () => {
  const spec = parseRepoSpec("octocat/hello-world");
  const run: Runner = (_cmd, args) => {
    if (args.includes("fetch")) return { status: 1, stdout: "", stderr: "Could not resolve host: github.com" };
    return OK("https://github.com/octocat/hello-world.git\n");
  };
  const result = refreshMirror(spec, "/mirror", run, { exists: true });
  assert.notEqual(result.freshness.state, "fresh");
  assert.equal(result.freshness.state, "unknown");
  assert.match(result.freshness.reason ?? "", /Could not resolve host/);
});

test("refreshing a mirror never checks out, resets or cleans the user's tree", () => {
  const spec = parseRepoSpec("octocat/hello-world");
  const { run, calls } = recordingRunner({
    "git -C": OK("https://github.com/octocat/hello-world.git\n"),
  });
  refreshMirror(spec, "/mirror", run, { exists: true });
  for (const mutation of ["checkout", "reset", "clean", "merge", "pull", "rebase"]) {
    assert.equal(
      calls.some((call) => call.includes(mutation)),
      false,
      `refresh must not run git ${mutation} on the user's mirror`,
    );
  }
});

test("no Aether credential is ever handed to git or gh", () => {
  const spec = parseRepoSpec("octocat/hello-world");
  const { run, calls } = recordingRunner({
    "git -C": OK("https://github.com/octocat/hello-world.git\n"),
  });
  refreshMirror(spec, "/mirror", run, { exists: true });
  const flat = calls.flat().join(" ");
  for (const leak of ["aek_", "Authorization", "http.extraheader", "GIT_ASKPASS", "x-access-token"]) {
    assert.equal(flat.includes(leak), false, `credential material reached the git argv: ${leak}`);
  }
});

test("a fresh mirror reports the exact base commit a worktree would branch from", () => {
  const spec = parseRepoSpec("octocat/hello-world");
  const tip = "a".repeat(40);
  const run: Runner = (_cmd, args) => {
    if (args.includes("rev-parse")) return OK(tip + "\n");
    return OK("https://github.com/octocat/hello-world.git\n");
  };
  const result = refreshMirror(spec, "/mirror", run, { exists: true });
  assert.equal(result.freshness.state, "fresh");
  assert.equal(result.freshness.remoteTip, tip);
});
