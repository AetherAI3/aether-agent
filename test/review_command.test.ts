// The command layer's own invariants: what it shows, what it refuses to show,
// and what it will not let through to a process.
//
// core/review_state.ts and core/review_actions.ts are tested where they live.
// What is tested HERE is the layer on top — the screen, the selection parsing,
// the confirmation, and the two things that would be worst to get wrong:
// rendering an unmeasured number as zero, and rendering an unverified tree as
// verified.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RepoState } from "../src/core/review_state.js";
import type { VerificationReading } from "../src/core/verification_record.js";
import type { ShipRequest } from "../src/core/ship.js";
import { parseRepoSpec } from "../src/core/repo.js";
import {
  aheadLine,
  autoApproved,
  needsExplicitApproval,
  parseFileList,
  parseHunkList,
  renderReview,
  selectionFrom,
  stateOf,
} from "../src/commands/review.js";
import {
  UnsafeGhArgvError,
  assertSafeGhArgv,
  plannedCommands,
  publishAutoApproved,
  renderArgvVector,
  renderShipConfirm,
} from "../src/commands/ship.js";
import {
  addCounts,
  formatCount,
  formatTotals,
  parseNumstatZ,
  sumCounts,
  type LineCount,
} from "../src/commands/review_counts.js";

// ── fixtures ────────────────────────────────────────────────────────────────

const file = (path: string, over: Partial<RepoState["files"][number]> = {}): RepoState["files"][number] => ({
  path,
  index: ".",
  worktree: "M",
  staged: false,
  unstaged: true,
  untracked: false,
  unmerged: false,
  ...over,
});

const state = (over: Partial<RepoState> = {}): RepoState => ({
  ok: true,
  root: "/repo",
  remote: {
    name: "origin",
    url: "https://github.com/octocat/hello-world.git",
    pushUrl: "https://github.com/octocat/hello-world.git",
    spec: parseRepoSpec("octocat/hello-world"),
  },
  head: {
    branch: "feature/rail",
    detached: false,
    revision: "a".repeat(40),
    upstream: null,
    ahead: null,
    behind: null,
  },
  base: { branch: "main", revision: "b".repeat(40), fetched: true },
  aheadOfBase: 2,
  behindBase: 0,
  files: [file("src/a.ts"), file("logo.png")],
  ...over,
});

const unknownReading: VerificationReading = {
  status: "unknown",
  reason: "nothing has verified this working tree",
  record: null,
};

const counts = new Map<string, LineCount>([["src/a.ts", { added: 12, deleted: 3 }]]);

const request: ShipRequest = {
  spec: parseRepoSpec("octocat/hello-world"),
  head: "feature/rail",
  base: "main",
  title: "fix: the thing",
  body: "It was broken. Now it is not.",
};

// ── unknown is never zero ───────────────────────────────────────────────────

test("numstat -z: a binary file's counts are unknown, not zero", () => {
  const parsed = parseNumstatZ("12\t3\tsrc/a.ts\0-\t-\tlogo.png\0");
  assert.deepEqual(parsed.get("src/a.ts"), { added: 12, deleted: 3 });
  assert.deepEqual(parsed.get("logo.png"), { added: null, deleted: null });
});

test("numstat -z: a rename record takes its path from the two fields that follow", () => {
  const parsed = parseNumstatZ("1\t1\t\0old/name.ts\0new/name.ts\0");
  assert.deepEqual([...parsed.keys()], ["new/name.ts"]);
});

test("numstat -z survives a path the human --stat form would have mangled", () => {
  // A path with a space and a quote in it. The code this replaces regex-scraped
  // `git diff --stat`, which abbreviates long paths and cannot round-trip these.
  const parsed = parseNumstatZ('4\t0\tsrc/a "weird" name.ts\0');
  assert.deepEqual([...parsed.keys()], ['src/a "weird" name.ts']);
});

test("an unknown count renders ?, and either side unknown makes a sum unknown", () => {
  assert.equal(formatCount({ added: null, deleted: null }), "+? -?");
  assert.equal(formatCount(undefined), "+? -?");
  assert.equal(formatCount({ added: 12, deleted: null }), "+12 -?");
  assert.deepEqual(addCounts({ added: 3, deleted: 0 }, { added: null, deleted: 1 }), { added: null, deleted: 1 });
});

test("totals name the files they could not measure instead of counting them as zero", () => {
  const totals = sumCounts(["src/a.ts", "logo.png"], counts);
  assert.deepEqual(totals.unknownPaths, ["logo.png"], "the excluded paths are named, not merely counted");
  const line = formatTotals(totals);
  assert.match(line, /1 file whose counts git did not report \(logo\.png\)/);
  assert.equal(/\+0 -0/.test(line), false);
});

test("the review screen shows ? for an unmeasured file and never invents a 0", () => {
  const screen = renderReview(state(), new Set(), { counts, verification: unknownReading });
  assert.match(screen, /logo\.png\s+\+\? -\?/);
  assert.match(screen, /src\/a\.ts\s+\+12 -3/);
});

test("an unmeasured branch position renders unknown, not level with its base", () => {
  assert.match(aheadLine(state({ aheadOfBase: null, behindBase: null })), /unknown ahead of main, unknown behind/);
  assert.equal(/0 ahead/.test(aheadLine(state({ aheadOfBase: null }))), false);
});

// ── unknown is never verified ───────────────────────────────────────────────
//
// The single most dangerous change that could be made to this layer is a branch
// that turns a stale or unknown reading into a green one. These assert the
// reason text is carried through VERBATIM, in both surfaces that show it.

test("the review screen prints the verification status and reason verbatim", () => {
  const stale: VerificationReading = {
    status: "stale",
    reason: "verified at aaaaaaaa, HEAD is now bbbbbbbb",
    record: null,
  };
  const screen = renderReview(state(), new Set(), { counts, verification: stale });
  assert.match(screen, /Tests:\s+stale — verified at aaaaaaaa, HEAD is now bbbbbbbb/);
  assert.equal(/Tests:\s+verified/.test(screen), false, "a stale reading must never render as verified");
  assert.equal(/Tests:\s+0/.test(screen), false, "and never as a number nobody measured");
});

test("the ship confirmation prints the verification status and reason verbatim", () => {
  const failed: VerificationReading = {
    status: "failed",
    reason: "npm test exited 1 (3 failing)",
    record: null,
  };
  const screen = renderShipConfirm(state(), request, failed);
  assert.match(screen, /verified\s+failed — npm test exited 1 \(3 failing\)/);
  assert.equal(/verified\s+verified/.test(screen), false);
});

test("every non-verified status reaches the screen unchanged", () => {
  for (const status of ["unknown", "stale", "failed"] as const) {
    const reading: VerificationReading = { status, reason: `because ${status}`, record: null };
    const screen = renderShipConfirm(state(), request, reading);
    assert.match(screen, new RegExp(`verified\\s+${status} — because ${status}`));
  }
});

// ── the confirmation is complete ────────────────────────────────────────────

test("the argv vector shows every element, including a multi-line body, in full", () => {
  const body = Array.from({ length: 40 }, (_, index) => `body line ${index}`).join("\n");
  const long = "x".repeat(5000);
  const screen = renderShipConfirm(state(), { ...request, title: long, body }, unknownReading);

  assert.ok(screen.includes(long), "a long title is shown in full");
  for (const line of body.split("\n")) {
    assert.ok(screen.includes(line), `body line missing from the confirmation: ${line}`);
  }
  // No ellipsis, no truncation notice: the user cannot approve what they were
  // not shown, so there is no path here that abbreviates.
  for (const marker of ["…", "...", "truncated", "and N more", "(more)"]) {
    assert.equal(screen.includes(marker), false, `the confirmation must not abbreviate (${marker})`);
  }
});

test("the confirmation shows the PUSH url, which is what a pushurl remote makes different", () => {
  const forked = state({
    remote: {
      name: "origin",
      url: "https://github.com/upstream/hello-world.git",
      pushUrl: "https://github.com/octocat/hello-world.git",
      spec: parseRepoSpec("octocat/hello-world"),
    },
  });
  const screen = renderShipConfirm(forked, request, unknownReading);
  assert.match(screen, /destination https:\/\/github\.com\/octocat\/hello-world\.git/);
  assert.match(screen, /fetches from https:\/\/github\.com\/upstream\/hello-world\.git and pushes somewhere else/);
});

test("an unmeasured commit count is stated as unknown on the confirmation", () => {
  const screen = renderShipConfirm(state({ aheadOfBase: null }), request, unknownReading);
  assert.match(screen, /commits\s+unknown ahead of main/);
});

test("the confirmation states that nothing merges and nothing forces", () => {
  const screen = renderShipConfirm(state(), request, unknownReading);
  assert.match(screen, /does not merge/);
  assert.match(screen, /does not force-push/);
});

test("the planned push argv names the head branch on both sides of the refspec", () => {
  const [push, create] = plannedCommands(state(), request);
  assert.deepEqual(push!.args, [
    "push",
    "--set-upstream",
    "--",
    "origin",
    "refs/heads/feature/rail:refs/heads/feature/rail",
  ]);
  assert.equal(push!.args.includes("--force"), false);
  assert.equal(create!.args[create!.args.indexOf("--head") + 1], "feature/rail");
});

test("--set-upstream is only planned when the branch has no upstream", () => {
  const tracked = state({ head: { ...state().head, upstream: "origin/feature/rail" } });
  assert.equal(plannedCommands(tracked, request)[0]!.args.includes("--set-upstream"), false);
});

test("renderArgvVector labels each element and indents wrapped lines under the label", () => {
  const rendered = renderArgvVector({ cmd: "gh", args: ["pr", "create", "--body", "a\nb"] });
  assert.match(rendered, /argv\[0\]\s+pr/);
  assert.match(rendered, /argv\[3\]\s+a/);
  const lines = rendered.split("\n");
  const at = lines.findIndex((line) => line.includes("argv[3]"));
  assert.match(lines[at + 1]!, /^\s+b$/, "the second line of a value is indented under it, not lost");
});

// ── the gh allowlist ────────────────────────────────────────────────────────

test("the gh allowlist admits the three shapes the rail uses and nothing else", () => {
  assert.doesNotThrow(() => assertSafeGhArgv(["--version"]));
  assert.doesNotThrow(() => assertSafeGhArgv(["auth", "status"]));
  assert.doesNotThrow(() =>
    assertSafeGhArgv(["pr", "create", "-R", "o/n", "--head", "h", "--title", "t", "--body", "b", "--base", "m"]),
  );
  for (const argv of [
    ["pr", "merge", "42"],
    ["pr", "create", "--admin"],
    ["pr", "create", "-R", "o/n", "--auto", "true"],
    ["pr", "create", "-R", "o/n", "--squash", "true"],
    ["pr", "create", "-R", "o/n", "--delete-branch", "true"],
    ["api", "-X", "PUT", "/repos/o/n/pulls/1/merge"],
    ["pr", "edit", "1"],
    ["pr", "create", "-R"],
  ]) {
    assert.throws(() => assertSafeGhArgv(argv), UnsafeGhArgvError, `should have refused: gh ${argv.join(" ")}`);
  }
});

test("a hostile title is a VALUE, so the allowlist leaves it alone", () => {
  // Refusing a title because it contains the word "merge" would be theatre: it
  // is one argv element and no shell ever sees it. The allowlist checks flag
  // positions only, and this proves it does not wander into values.
  const argv = ["pr", "create", "-R", "o/n", "--title", "merge --admin $(rm -rf ~) --force", "--body", "--auto"];
  assert.doesNotThrow(() => assertSafeGhArgv(argv));
});

// ── the authority boundary ──────────────────────────────────────────────────

test("--yes approves reading, staging and committing but never publishing or destroying", () => {
  assert.equal(autoApproved("index", { yes: true }), true);
  assert.equal(autoApproved("commit", { yes: true }), true);
  assert.equal(autoApproved("destructive", { yes: true }), false);
  assert.equal(autoApproved("publish", { yes: true }), false);
  assert.equal(publishAutoApproved({ yes: true }), false);
});

test("only the named action approves it, and the name has to match", () => {
  assert.equal(autoApproved("destructive", { yes: false, approve: "destructive" }), true);
  assert.equal(autoApproved("destructive", { yes: false, approve: "publish" }), false);
  assert.equal(publishAutoApproved({ yes: false, approve: "publish" }), true);
  assert.equal(publishAutoApproved({ yes: false, approve: "PUBLISH " }), true);
  assert.equal(publishAutoApproved({ yes: false, approve: "yes" }), false);
  assert.deepEqual(
    [needsExplicitApproval("destructive"), needsExplicitApproval("publish"), needsExplicitApproval("commit")],
    [true, true, false],
  );
});

// ── selection ───────────────────────────────────────────────────────────────

test("parseFileList splits on commas and whitespace and de-duplicates", () => {
  assert.deepEqual(parseFileList("a.ts, b.ts  a.ts"), ["a.ts", "b.ts"]);
  assert.deepEqual(parseFileList(undefined), []);
});

test("parseHunkList refuses anything that is not a hunk number", () => {
  assert.deepEqual(parseHunkList("1,3").hunks, [1, 3]);
  assert.match(parseHunkList("1,x").error ?? "", /not a hunk number/);
  assert.match(parseHunkList("0").error ?? "", /not a hunk number/);
});

test("a --files typo is named, never treated as an empty or a full selection", () => {
  const resolved = selectionFrom(state(), { all: false, yes: false, json: false, files: "src/a.ts,nope.ts" });
  assert.deepEqual(resolved.paths, []);
  assert.match(resolved.error ?? "", /not a changed path in this repository: nope\.ts/);
});

test("--all and --files together are refused rather than one silently winning", () => {
  const resolved = selectionFrom(state(), { all: true, yes: false, json: false, files: "src/a.ts" });
  assert.match(resolved.error ?? "", /mutually exclusive/);
});

test("no selection at all is an error, not an implicit select-everything", () => {
  assert.match(selectionFrom(state(), { all: false, yes: false, json: false }).error ?? "", /nothing selected/);
});

test("a conflicted file is labelled CONFLICT rather than quietly listed as changed", () => {
  assert.equal(stateOf(file("a.ts", { unmerged: true })), "CONFLICT");
  assert.equal(stateOf(file("a.ts", { staged: true, unstaged: true })), "staged + more");
  assert.equal(stateOf(file("a.ts", { untracked: true })), "untracked");
});
