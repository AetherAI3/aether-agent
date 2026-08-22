// A run redirected into a worktree executes somewhere other than where it was
// launched. The session record has to say both, and the branch it reports has
// to be the branch the commits landed on — naming the launch directory's branch
// there would be a confident wrong answer, which is the one failure mode this
// library exists to avoid.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionLog } from "../src/core/session_log.js";
import { readSessionIndex } from "../src/core/session_index.js";
import { normalizeWorkspace } from "../src/core/workspace_scope.js";

function withRoot(body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "aether-worktree-"));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const NOW = "2026-08-22T10:00:00.000Z";

test("the branch recorded is the one the work happened on, not the launch directory's", () =>
  withRoot((root) => {
    const launch = join(root, "repo");
    const worktree = join(root, "repo-worktree");
    const probed: string[] = [];
    const log = new SessionLog(
      {
        task: "land the parser fix",
        model: "qwen3:4b",
        poolGb: 1,
        brain: "local",
        cwd: launch,
        worktree,
      },
      NOW,
      root,
      (cwd) => {
        probed.push(cwd);
        return cwd === worktree
          ? { remote: "git@github.com:AetherAI3/aether-agent.git", branch: "aether/parser-fix", head: "abc1234" }
          : { remote: "git@github.com:AetherAI3/aether-agent.git", branch: "main", head: "deadbee" };
      },
    );
    log.close("ok", "2026-08-22T10:05:00.000Z");

    assert.deepEqual(probed, [worktree], "the probe asks the checkout the work ran in");
    const manifest = JSON.parse(readFileSync(join(root, log.sessionId, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(manifest["branch"], "aether/parser-fix");
    assert.equal(manifest["worktree"], worktree);
    assert.equal(
      manifest["cwd"],
      normalizeWorkspace(launch),
      "the session stays scoped to where the user was standing",
    );

    // And the library shows both, so a user can find the checkout again.
    const row = readSessionIndex(root).entries.find((e) => e.sessionId === log.sessionId);
    assert.equal(row?.branch, "aether/parser-fix");
    assert.equal(row?.worktree, worktree);
  }));

test("with no worktree the launch directory is the checkout, and nothing invents one", () =>
  withRoot((root) => {
    const launch = join(root, "repo");
    const probed: string[] = [];
    const log = new SessionLog(
      { task: "t", model: "m", poolGb: 1, brain: "local", cwd: launch },
      NOW,
      root,
      (cwd) => {
        probed.push(cwd);
        return undefined; // no checkout at all
      },
    );
    log.close("unverified", "2026-08-22T10:05:00.000Z");

    assert.deepEqual(probed, [launch]);
    const manifest = JSON.parse(readFileSync(join(root, log.sessionId, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(manifest["worktree"], undefined, "an absent worktree is absent, not the cwd");
    assert.equal(manifest["branch"], undefined, "a probe that found nothing does not name a branch");
    const row = readSessionIndex(root).entries.find((e) => e.sessionId === log.sessionId);
    assert.ok(row, "the session is still in the library");
    assert.equal(row?.branch, undefined);
  }));
