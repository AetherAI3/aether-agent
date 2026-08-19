// First behavioural coverage for /rollback and /revert. Both mutate the user's
// working tree, and both shipped with no tests at all.
//
// Every test drives a scripted GitRunner, so nothing here touches a real
// repository. The argv assertions are the point: these commands are destructive,
// and what matters is exactly which git verbs they issue and which they never do.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { AppContext } from "../src/core/context.js";
import type { GitRunner, GitRunResult } from "../src/core/git_commit_guard.js";
import { rollbackSlash, revertSlash, type GitToolDeps } from "../src/commands/slash_git_tools.js";

const OK = (stdout = ""): GitRunResult => ({ ok: true, stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = ""): GitRunResult => ({ ok: false, stdout: "", stderr, exitCode: 1 });

/** Records every argv and answers from a longest-prefix table. */
function fakeGit(table: Record<string, GitRunResult>): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = {
    run(args: string[]): GitRunResult {
      calls.push(args);
      const key = args.join(" ");
      let best: { length: number; result: GitRunResult } | null = null;
      for (const [pattern, result] of Object.entries(table)) {
        if (key.startsWith(pattern) && (best === null || pattern.length > best.length)) {
          best = { length: pattern.length, result };
        }
      }
      return best?.result ?? OK();
    },
  };
  return { git, calls };
}

function deps(table: Record<string, GitRunResult>): { deps: GitToolDeps; calls: string[][] } {
  const { git, calls } = fakeGit({ "rev-parse --show-toplevel": OK("/repo\n"), ...table });
  return { deps: { cwd: "/repo", git }, calls };
}

function ctxWith(answer: boolean, yes = false): AppContext {
  return {
    flags: { yes },
    confirm: async () => answer,
  } as unknown as AppContext;
}

function sink(): { out: PassThrough; text: () => string } {
  const chunks: string[] = [];
  const out = new PassThrough();
  out.on("data", (chunk) => chunks.push(String(chunk)));
  return { out, text: () => chunks.join("") };
}

const ran = (calls: string[][], verb: string): boolean => calls.some((call) => call.includes(verb));

// ── the count that never worked ─────────────────────────────────────────────

test("/rollback rejects a count instead of silently ignoring it", async () => {
  const { deps: d, calls } = deps({ "diff --name-only": OK("a.ts\nb.ts\n") });
  const { out, text } = sink();
  await rollbackSlash(ctxWith(true, true), out, "5", d);
  assert.match(text(), /never/i, "must say the count never did anything");
  assert.equal(ran(calls, "checkout"), false, "a rejected invocation must not mutate the tree");
  assert.equal(ran(calls, "restore"), false);
});

test("/rollback usage text does not promise per-change undo", async () => {
  const { deps: d } = deps({ "diff --name-only": OK("") });
  const { out, text } = sink();
  await rollbackSlash(ctxWith(false), out, "not-a-number", d);
  assert.equal(/revert last n/i.test(text()), false, "the old usage line claimed a capability that does not exist");
});

// ── truthfulness about what was restored ────────────────────────────────────

test("/rollback does not claim 'last commit' while changes are staged", async () => {
  const { deps: d, calls } = deps({
    "diff --name-only": OK("a.ts\n"),
    "diff --cached --name-only": OK("a.ts\n"),
  });
  const { out, text } = sink();
  await rollbackSlash(ctxWith(true, true), out, "", d);
  assert.equal(ran(calls, "checkout") || ran(calls, "restore"), true, "it should still restore");
  assert.equal(
    /restored to last commit/i.test(text()),
    false,
    "with a populated index the restore target is the staged content, not HEAD",
  );
  assert.match(text(), /staged/i, "it must name what it actually restored to");
});

test("/rollback may say 'last commit' only when nothing is staged", async () => {
  const { deps: d } = deps({
    "diff --name-only": OK("a.ts\n"),
    "diff --cached --name-only": OK(""),
  });
  const { out, text } = sink();
  await rollbackSlash(ctxWith(true, true), out, "", d);
  assert.match(text(), /last commit/i);
});

// ── destructive-scope guards ────────────────────────────────────────────────

test("/rollback never removes untracked files", async () => {
  const { deps: d, calls } = deps({ "diff --name-only": OK("a.ts\n") });
  const { out } = sink();
  await rollbackSlash(ctxWith(true, true), out, "", d);
  assert.equal(ran(calls, "clean"), false, "reverting tracked files must not delete untracked ones");
});

test("/rollback declining the prompt mutates nothing", async () => {
  const { deps: d, calls } = deps({ "diff --name-only": OK("a.ts\nb.ts\n") });
  const { out, text } = sink();
  await rollbackSlash(ctxWith(false), out, "", d);
  assert.match(text(), /cancel/i);
  assert.equal(ran(calls, "checkout"), false);
  assert.equal(ran(calls, "restore"), false);
});

test("/rollback on a clean tree issues no mutation", async () => {
  const { deps: d, calls } = deps({ "diff --name-only": OK("") });
  const { out, text } = sink();
  await rollbackSlash(ctxWith(true, true), out, "", d);
  assert.match(text(), /clean/i);
  assert.equal(ran(calls, "checkout"), false);
  assert.equal(ran(calls, "restore"), false);
});

// ── repository detection ────────────────────────────────────────────────────

test("/rollback works from a subdirectory, not only a repo root", async () => {
  const { git, calls } = fakeGit({
    "rev-parse --show-toplevel": OK("/repo\n"),
    "diff --name-only": OK("a.ts\n"),
  });
  const { out, text } = sink();
  await rollbackSlash(ctxWith(true, true), out, "", { cwd: "/repo/src/deep", git });
  assert.equal(/not in a git repository/i.test(text()), false, "a subdirectory of a repo is still in the repo");
  assert.equal(ran(calls, "rev-parse"), true, "detection must ask git, not look for a .git directory");
});

test("/rollback outside a repository refuses and mutates nothing", async () => {
  const { git, calls } = fakeGit({ "rev-parse --show-toplevel": FAIL("not a git repository") });
  const { out, text } = sink();
  await rollbackSlash(ctxWith(true, true), out, "", { cwd: "/tmp", git });
  assert.match(text(), /not in a git repository/i);
  assert.equal(ran(calls, "checkout"), false);
});

// ── /revert ─────────────────────────────────────────────────────────────────

test("/revert does not claim 'last commit' while the file is staged", async () => {
  const { deps: d } = deps({
    "ls-files --error-unmatch": OK("a.ts\n"),
    "diff --name-only -- a.ts": OK("a.ts\n"),
    "diff -- a.ts": OK("--- a\n+++ b\n+x\n"),
    "diff --cached --name-only -- a.ts": OK("a.ts\n"),
  });
  const { out, text } = sink();
  await revertSlash(ctxWith(true, true), out, "a.ts", d);
  assert.equal(/restored to last commit/i.test(text()), false);
  assert.match(text(), /staged/i);
});

test("/revert passes the path after -- and never through a shell", async () => {
  const { deps: d, calls } = deps({
    "ls-files --error-unmatch": OK("-weird file.ts\n"),
    "diff --name-only": OK("-weird file.ts\n"),
    "diff -- ": OK("+x\n"),
    "diff --cached --name-only": OK(""),
  });
  const { out } = sink();
  await revertSlash(ctxWith(true, true), out, "-weird file.ts", d);
  for (const call of calls) {
    const target = call.indexOf("-weird file.ts");
    if (target === -1) continue;
    assert.equal(call[target - 1], "--", `path must follow a -- separator: ${call.join(" ")}`);
  }
});

test("/revert on an untracked file refuses and mutates nothing", async () => {
  const { deps: d, calls } = deps({ "ls-files --error-unmatch": FAIL("did not match any file") });
  const { out, text } = sink();
  await revertSlash(ctxWith(true, true), out, "new.ts", d);
  assert.match(text(), /not tracked/i);
  assert.equal(ran(calls, "checkout"), false);
  assert.equal(ran(calls, "restore"), false);
});
