// Temp workspaces for tests that build a ToolExecutor.
//
// Every workspace here lives under os.tmpdir(). On a hosted CI runner that is
// harmless: the temp root is not inside a git repository, so any `git` command
// an executor runs from a temp workspace fails discovery immediately. On a
// developer machine it is not harmless. If the temp root happens to sit inside
// a repository — a Windows box whose %TEMP% is C:\Users\<name>\AppData\Local\Temp
// and whose home directory is version-controlled is the common case — repository
// discovery walks up out of the temp directory, finds that ambient repository,
// and every probe becomes O(entire home directory). Measured on such a machine:
// a single `git status --porcelain=v1 -z --untracked-files=all` from a temp
// workspace did not finish inside a 120s cap, and the full suite hung.
//
// Pinning GIT_CEILING_DIRECTORIES at the temp root stops discovery there, so a
// temp workspace is "not a git repository" on every machine — the same thing CI
// has always seen. It is preferred over `git init`-ing each workspace because
// it changes nothing about what the tests exercise: a `git init` would silently
// convert the non-repository paths these tests cover into live-repository paths
// and spawn an extra git process per test, whereas the ceiling only removes an
// accident of where the temp directory happens to live.
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/** Canonical temp root; also the ceiling for git repository discovery. */
export const TEMP_ROOT = realpathSync(tmpdir());

function pinGitCeiling(): void {
  const current = process.env["GIT_CEILING_DIRECTORIES"];
  const parts = current ? current.split(delimiter).filter(Boolean) : [];
  if (parts.includes(TEMP_ROOT)) return;
  parts.push(TEMP_ROOT);
  process.env["GIT_CEILING_DIRECTORIES"] = parts.join(delimiter);
}

// Applied at import time so it is in place before any test body runs. Child
// processes inherit process.env, which is how the executor's `git` calls see it.
pinGitCeiling();

/** Create a temp workspace directory under the ceiling-pinned temp root. */
export function tmpWorkspace(prefix: string): string {
  pinGitCeiling();
  return mkdtempSync(join(TEMP_ROOT, prefix));
}
