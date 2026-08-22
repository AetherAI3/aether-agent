// review_actions.ts — the mutating half of the review rail: select, stage,
// unstage, revert, commit.
//
// Everything here obeys four rules, and every rule is a test in
// test/review_actions.test.ts:
//
//  1. You may only act on a path the STATE reported. A selection naming a path
//     that was not in the state read a moment ago is refused rather than passed
//     to git. That is what makes a crafted path an impossible input instead of
//     a sanitising problem, and it is why nothing here takes a raw string list.
//  2. State is re-read immediately before a mutation, and the mutation is
//     refused if the tree moved. A preview the user approved is a statement
//     about a tree; if that tree changed, the approval was for something else.
//  3. Nothing is destroyed that a preview did not name. Revert returns a plan
//     carrying the exact content it will discard; applying a plan whose diff no
//     longer matches is refused.
//  4. A commit contains the selection and nothing else. Pre-existing staged
//     changes are refused unless the user explicitly selected them — the index
//     is verified to equal the selection after staging, and reset if it does not.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT_GLOBAL_ARGS } from "./git_commit_guard.js";
import type { ChangedFile, RepoState } from "./review_state.js";
import type { Runner, RunResult } from "./worktree.js";

const git = (run: Runner, dir: string, args: string[]): RunResult =>
  run("git", [...GIT_GLOBAL_ARGS, "-C", dir, ...args], dir);

export interface ActionResult {
  ok: boolean;
  /** What happened, in the user's terms. Rendered verbatim. */
  message: string;
  /** Paths the action actually touched. Empty when it refused. */
  paths: string[];
}

const refuse = (message: string): ActionResult => ({ ok: false, message, paths: [] });

/**
 * Reduce a selection of path strings to the files the state actually reported.
 *
 * Returns the matched files and the names that matched nothing. An unmatched
 * name is an error the caller must surface: silently dropping it would turn
 * "stage these four files" into a three-file commit that still reports success.
 */
export function resolveSelection(
  state: RepoState,
  selection: readonly string[],
): { files: ChangedFile[]; unknown: string[] } {
  const known = new Map(state.files.map((file) => [file.path, file]));
  const files: ChangedFile[] = [];
  const unknown: string[] = [];
  for (const name of selection) {
    const file = known.get(name);
    if (file) files.push(file);
    else unknown.push(name);
  }
  return { files, unknown };
}

// ── staging whole files ─────────────────────────────────────────────────────

/**
 * Stage the selected files.
 *
 * `--` separates the pathspecs from the options, and `core.literalPathspecs`
 * (in GIT_GLOBAL_ARGS) keeps a path that begins with `:` from being read as
 * pathspec magic. Combined with rule 1 — the paths came from the state, not
 * from a user string — there is no route from a crafted name to a git option.
 */
export function stageFiles(run: Runner, state: RepoState, selection: readonly string[]): ActionResult {
  const { files, unknown } = resolveSelection(state, selection);
  if (unknown.length) return refuse(`not a changed path in this repository: ${unknown.join(", ")}`);
  if (!files.length) return refuse("nothing selected to stage");

  const paths = files.map((file) => file.path);
  const added = git(run, state.root, ["add", "--", ...paths]);
  if (added.status !== 0) return refuse(added.stderr.trim() || "git add failed");
  return { ok: true, message: `staged ${paths.length} file(s)`, paths };
}

/**
 * Unstage the selected files.
 *
 * `git restore --staged` rather than `git reset`: restore only ever touches the
 * index for the named paths, so it cannot be talked into moving HEAD, and it
 * works on an unborn branch where `reset HEAD --` does not.
 */
export function unstageFiles(run: Runner, state: RepoState, selection: readonly string[]): ActionResult {
  const { files, unknown } = resolveSelection(state, selection);
  if (unknown.length) return refuse(`not a changed path in this repository: ${unknown.join(", ")}`);
  if (!files.length) return refuse("nothing selected to unstage");

  const paths = files.map((file) => file.path);
  const restored = git(run, state.root, ["restore", "--staged", "--", ...paths]);
  if (restored.status !== 0) return refuse(restored.stderr.trim() || "git restore --staged failed");
  return { ok: true, message: `unstaged ${paths.length} file(s)`, paths };
}

// ── hunks ───────────────────────────────────────────────────────────────────

export interface Hunk {
  /** 1-based index within its file, as shown to the user. */
  index: number;
  /** The @@ line, verbatim. */
  header: string;
  /** Body lines, verbatim, including any "\ No newline at end of file". */
  lines: string[];
  additions: number;
  deletions: number;
}

export interface FileDiff {
  path: string;
  /** Everything before the first @@ — the diff/index/---/+++ preamble. */
  preamble: string[];
  hunks: Hunk[];
  /** True for a diff git reported without hunks (binary files). */
  binary: boolean;
}

/**
 * Parse a unified diff into per-file hunks.
 *
 * Written against git's own output rather than a general diff dialect: the
 * preamble is kept verbatim so a reconstructed patch carries the same mode,
 * index and rename metadata git emitted, which is what lets `git apply` accept
 * a subset of hunks without being told anything extra.
 */
export function parseUnifiedDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let hunk: Hunk | null = null;

  const closeHunk = (): void => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      closeHunk();
      if (current) files.push(finishFile(current));
      current = { path: pathFromDiffHeader(line), preamble: [line], hunks: [], binary: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("@@")) {
      closeHunk();
      hunk = { index: current.hunks.length + 1, header: line, lines: [], additions: 0, deletions: 0 };
      continue;
    }
    if (hunk) {
      // A trailing empty string from the final split is not a diff line.
      if (line === "" ) continue;
      hunk.lines.push(line);
      if (line.startsWith("+")) hunk.additions += 1;
      else if (line.startsWith("-")) hunk.deletions += 1;
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) current.binary = true;
    // The `+++` line is the authoritative b-side path: the `diff --git` header
    // is ambiguous for a rename (its two halves differ), and this one is not.
    if (line.startsWith("+++ ") && line.slice(4).trim() !== "/dev/null") {
      const target = line.slice(4).trim();
      current.path = target.startsWith("b/") ? target.slice(2) : target;
    }
    if (line) current.preamble.push(line);
  }
  closeHunk();
  if (current) files.push(finishFile(current));
  return files;
}

const finishFile = (file: FileDiff): FileDiff => file;

/** The b-side path from a `diff --git a/x b/x` header. */
function pathFromDiffHeader(line: string): string {
  const rest = line.slice("diff --git ".length);
  const half = Math.floor(rest.length / 2);
  const b = rest.slice(half).trim();
  return b.startsWith("b/") ? b.slice(2) : b;
}

/**
 * Rebuild a patch containing only the selected hunks of one file.
 *
 * Hunk line numbers are left exactly as git wrote them. They describe the
 * PREIMAGE, which is unchanged by whether an earlier hunk was selected, so a
 * subset applies against the same index `git apply --cached` reads.
 */
export function buildPatch(file: FileDiff, hunkIndexes: readonly number[]): string | null {
  const wanted = new Set(hunkIndexes);
  const hunks = file.hunks.filter((candidate) => wanted.has(candidate.index));
  if (!hunks.length) return null;
  const lines = [...file.preamble];
  for (const selected of hunks) {
    lines.push(selected.header);
    lines.push(...selected.lines);
  }
  return lines.join("\n") + "\n";
}

/** Read the diff a hunk selection is made against. */
export function readFileDiff(run: Runner, state: RepoState, path: string, staged: boolean): FileDiff | null {
  const args = ["diff", ...(staged ? ["--cached"] : []), "--no-color", "--", path];
  const diff = git(run, state.root, args);
  if (diff.status !== 0) return null;
  return parseUnifiedDiff(diff.stdout).find((file) => file.path === path) ?? null;
}

/**
 * Apply a patch to the index only.
 *
 * The patch goes to a temp FILE rather than stdin: the injected Runner has no
 * stdin channel, and inventing one for this path would mean a second process
 * API that tests would have to fake differently from every other git call.
 */
function applyToIndex(run: Runner, dir: string, patch: string, reverse: boolean): RunResult {
  const scratch = mkdtempSync(join(tmpdir(), "aether-hunk-"));
  const file = join(scratch, "selection.patch");
  try {
    writeFileSync(file, patch, "utf8");
    return git(run, dir, ["apply", "--cached", "--whitespace=nowarn", ...(reverse ? ["--reverse"] : []), "--", file]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function stageHunks(
  run: Runner,
  state: RepoState,
  path: string,
  hunkIndexes: readonly number[],
): ActionResult {
  const { unknown } = resolveSelection(state, [path]);
  if (unknown.length) return refuse(`not a changed path in this repository: ${path}`);
  const file = readFileDiff(run, state, path, false);
  if (!file) return refuse(`no unstaged diff to select hunks from in ${path}`);
  if (file.binary) return refuse(`${path} is binary — stage the whole file or nothing`);
  const patch = buildPatch(file, hunkIndexes);
  if (!patch) return refuse(`no such hunk in ${path}`);

  const applied = applyToIndex(run, state.root, patch, false);
  if (applied.status !== 0) {
    return refuse((applied.stderr || applied.stdout).trim() || "the selected hunks did not apply");
  }
  return { ok: true, message: `staged ${hunkIndexes.length} hunk(s) of ${path}`, paths: [path] };
}

export function unstageHunks(
  run: Runner,
  state: RepoState,
  path: string,
  hunkIndexes: readonly number[],
): ActionResult {
  const { unknown } = resolveSelection(state, [path]);
  if (unknown.length) return refuse(`not a changed path in this repository: ${path}`);
  const file = readFileDiff(run, state, path, true);
  if (!file) return refuse(`no staged diff to select hunks from in ${path}`);
  if (file.binary) return refuse(`${path} is binary — unstage the whole file or nothing`);
  const patch = buildPatch(file, hunkIndexes);
  if (!patch) return refuse(`no such hunk in ${path}`);

  const applied = applyToIndex(run, state.root, patch, true);
  if (applied.status !== 0) {
    return refuse((applied.stderr || applied.stdout).trim() || "the selected hunks did not un-apply");
  }
  return { ok: true, message: `unstaged ${hunkIndexes.length} hunk(s) of ${path}`, paths: [path] };
}

// ── revert ──────────────────────────────────────────────────────────────────

export interface RevertPlan {
  path: string;
  /** Hunk indexes to discard, or null for the whole file. */
  hunks: number[] | null;
  /** The exact patch text that will be discarded — this is the preview. */
  preview: string;
  /** What the file will contain afterwards, stated honestly. */
  restoresTo: "the last commit" | "its staged state";
}

/**
 * Plan a revert. Nothing is discarded here; the caller shows `preview` and
 * confirms before calling applyRevert.
 *
 * `git restore` (and `git checkout --`) restore from the INDEX, so a file with
 * staged content does NOT come back as the last commit. Saying "last commit"
 * there would be false exactly when the user has staged work they are counting
 * on, so the plan states which one it is.
 */
export function planRevert(
  run: Runner,
  state: RepoState,
  path: string,
  hunkIndexes: readonly number[] | null,
): RevertPlan | ActionResult {
  const { files, unknown } = resolveSelection(state, [path]);
  if (unknown.length) return refuse(`not a changed path in this repository: ${path}`);
  const file = files[0]!;
  if (file.untracked) return refuse(`${path} is untracked — git has nothing to restore it from`);
  if (file.unmerged) return refuse(`${path} is unmerged — resolve the conflict before reverting`);

  const diff = readFileDiff(run, state, path, false);
  if (!diff) return refuse(`no unstaged changes in ${path}`);
  const preview = hunkIndexes ? buildPatch(diff, hunkIndexes) : buildPatch(diff, diff.hunks.map((h) => h.index));
  if (!preview) return refuse(hunkIndexes ? `no such hunk in ${path}` : `no unstaged changes in ${path}`);

  return {
    path,
    hunks: hunkIndexes ? [...hunkIndexes] : null,
    preview,
    restoresTo: file.staged ? "its staged state" : "the last commit",
  };
}

/**
 * Discard exactly what the plan previewed.
 *
 * The current diff is re-read and compared to the preview. If the file changed
 * between the preview and the confirmation — the agent wrote to it, the user
 * saved in their editor — the approval was for content that no longer exists,
 * so this refuses instead of discarding whatever is there now.
 */
export function applyRevert(run: Runner, state: RepoState, plan: RevertPlan): ActionResult {
  const diff = readFileDiff(run, state, plan.path, false);
  if (!diff) return refuse(`no unstaged changes in ${plan.path} any more — nothing was discarded`);
  const current = plan.hunks ? buildPatch(diff, plan.hunks) : buildPatch(diff, diff.hunks.map((h) => h.index));
  if (current !== plan.preview) {
    return refuse(
      `${plan.path} changed since the preview — nothing was discarded. Review it again.`,
    );
  }

  if (plan.hunks === null) {
    const restored = git(run, state.root, ["restore", "--", plan.path]);
    if (restored.status !== 0) return refuse(restored.stderr.trim() || "git restore failed");
    return { ok: true, message: `${plan.path} restored to ${plan.restoresTo}`, paths: [plan.path] };
  }

  // Hunk-level: reverse-apply the previewed patch to the worktree only.
  const scratch = mkdtempSync(join(tmpdir(), "aether-revert-"));
  const file = join(scratch, "revert.patch");
  try {
    writeFileSync(file, plan.preview, "utf8");
    const applied = git(run, state.root, ["apply", "--reverse", "--whitespace=nowarn", "--", file]);
    if (applied.status !== 0) {
      return refuse((applied.stderr || applied.stdout).trim() || "the selected hunks could not be discarded");
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { ok: true, message: `discarded ${plan.hunks.length} hunk(s) of ${plan.path}`, paths: [plan.path] };
}

// ── commit ──────────────────────────────────────────────────────────────────

export interface CommitPlan {
  /** Paths that will be in the commit. */
  paths: string[];
  /** Paths already staged that the user did NOT select. */
  unrelatedStaged: string[];
  ok: boolean;
  reason?: string;
}

/**
 * Decide what a commit of `selection` would contain.
 *
 * The refusal that matters: an index carrying changes the user did not select.
 * A rail that committed them anyway would attach someone else's work — or the
 * agent's own unrelated edit — to a message describing something different.
 * Selecting those paths explicitly is the way to include them, and it is
 * visible in the plan either way.
 */
export function planCommit(state: RepoState, selection: readonly string[]): CommitPlan {
  const { files, unknown } = resolveSelection(state, selection);
  if (unknown.length) {
    return { ok: false, paths: [], unrelatedStaged: [], reason: `not a changed path: ${unknown.join(", ")}` };
  }
  if (!files.length) return { ok: false, paths: [], unrelatedStaged: [], reason: "nothing selected to commit" };

  const unmerged = files.filter((file) => file.unmerged).map((file) => file.path);
  if (unmerged.length) {
    return { ok: false, paths: [], unrelatedStaged: [], reason: `unresolved conflicts: ${unmerged.join(", ")}` };
  }

  const selected = new Set(files.map((file) => file.path));
  const unrelatedStaged = state.files
    .filter((file) => file.staged && !selected.has(file.path))
    .map((file) => file.path);
  if (unrelatedStaged.length) {
    return {
      ok: false,
      paths: [],
      unrelatedStaged,
      reason:
        `the index already holds changes you did not select: ${unrelatedStaged.join(", ")}. ` +
        "Select them too, or unstage them first.",
    };
  }
  return { ok: true, paths: [...selected].sort(), unrelatedStaged: [] };
}

export interface CommitOutcome extends ActionResult {
  /** The new commit, when one was made. */
  revision?: string;
}

/**
 * Stage the plan, verify the index equals it, commit, and report the revision.
 *
 * Between staging and committing the index is verified twice: once that it
 * contains exactly the planned paths, and once that the worktree still matches
 * it. Both failures reset the paths that were staged rather than committing a
 * set nobody approved.
 */
export function commitSelected(
  run: Runner,
  state: RepoState,
  plan: CommitPlan,
  message: string,
): CommitOutcome {
  if (!plan.ok) return refuse(plan.reason ?? "the commit plan was refused");
  if (!message.trim()) return refuse("a commit needs a message");

  const staged = git(run, state.root, ["add", "--", ...plan.paths]);
  if (staged.status !== 0) return refuse(staged.stderr.trim() || "git add failed");

  const reset = (): void => {
    git(run, state.root, ["restore", "--staged", "--", ...plan.paths]);
  };

  const after = git(run, state.root, ["diff", "--cached", "--name-only", "-z"]);
  const inIndex = after.status === 0 ? [...new Set(after.stdout.split("\0").filter(Boolean))].sort() : null;
  if (!inIndex || !sameSet(inIndex, plan.paths)) {
    reset();
    return refuse(
      `the index does not match the selection (${inIndex ? inIndex.join(", ") : "unreadable"}) — nothing was committed`,
    );
  }

  // The index must still match the worktree immediately before the commit. This
  // closes the stage-then-edit window for a concurrent writer or a save hook.
  const drift = git(run, state.root, ["diff", "--quiet", "--", ...plan.paths]);
  if (drift.status !== 0) {
    reset();
    return refuse("the working tree changed after staging — nothing was committed");
  }

  const committed = git(run, state.root, ["commit", "-q", "-m", message]);
  if (committed.status !== 0) {
    reset();
    return refuse((committed.stderr || committed.stdout).trim() || "git commit failed");
  }
  const revision = git(run, state.root, ["rev-parse", "HEAD"]);
  const outcome: CommitOutcome = {
    ok: true,
    message: `committed ${plan.paths.length} file(s)`,
    paths: plan.paths,
  };
  if (revision.status === 0 && revision.stdout.trim()) outcome.revision = revision.stdout.trim();
  return outcome;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// ── suggested message ───────────────────────────────────────────────────────

const TYPE_RULES: Array<{ test: (path: string) => boolean; type: string }> = [
  { test: (path) => /(^|\/)(test|tests|__tests__)\//.test(path) || /\.test\.[cm]?[jt]sx?$/.test(path), type: "test" },
  { test: (path) => /(^|\/)docs?\//.test(path) || /\.mdx?$/i.test(path), type: "docs" },
  { test: (path) => /(^|\/)\.github\//.test(path) || /(^|\/)(scripts|Dockerfile|Makefile)/.test(path), type: "chore" },
];

/**
 * A conventional-commit first line for the selection, offered as a starting
 * point. It describes the SHAPE of the change (which files, how many), never
 * its intent — a generated summary that guesses at intent reads as if someone
 * decided it, and nobody did.
 */
export function suggestCommitMessage(paths: readonly string[]): string {
  if (!paths.length) return "";
  let type = "feat";
  for (const rule of TYPE_RULES) {
    if (paths.every((path) => rule.test(path))) {
      type = rule.type;
      break;
    }
  }
  const segments = paths.map((path) => path.split("/").slice(0, -1).join("/"));
  const directory = new Set(segments).size === 1 ? (segments[0] ?? "").split("/").pop() : null;
  // `test(test):` and `docs(docs):` say the same thing twice; the scope is only
  // worth printing when it adds a location the type does not already imply.
  const scope = directory && directory !== type ? directory : null;
  const head = paths.length === 1 ? (paths[0]!.split("/").pop() ?? paths[0]!) : `${paths.length} files`;
  const subject = `${type}${scope ? `(${scope})` : ""}: update ${head}`;
  const body = paths.slice(0, 10).map((path) => `- ${path}`);
  if (paths.length > 10) body.push(`- ... and ${paths.length - 10} more`);
  return [subject, "", ...body].join("\n");
}
