import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getActiveGoal,
  getGoalForWorkspace,
  goalsForWorkspace,
  newGoal,
  readGoals,
  upsertGoal,
} from "../src/core/goals.js";
import { normalizeWorkspace } from "../src/core/workspace_scope.js";

test("new goals are scoped and default selectors exclude other and legacy records", () => {
  const root = mkdtempSync(join(tmpdir(), "goals-"));
  const file = join(root, "goals.json");
  const workspace = join(root, "workspace");
  const other = join(root, "other");
  try {
    const current = newGoal("current", workspace);
    current.status = "running";
    const elsewhere = newGoal("other", other);
    elsewhere.status = "running";
    const legacy = { ...newGoal("legacy", workspace), id: "legacy", cwd: undefined, status: "running" as const };
    writeFileSync(file, JSON.stringify([current, elsewhere, legacy]));
    assert.equal(current.cwd, normalizeWorkspace(workspace));
    assert.deepEqual(goalsForWorkspace(workspace, file).map((goal) => goal.id), [current.id]);
    assert.equal(getActiveGoal(workspace, file)?.id, current.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("corrupt goal stores fail closed and preserve exact bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "goals-corrupt-"));
  const file = join(root, "goals.json");
  try {
    const corrupt = "{ definitely not json";
    writeFileSync(file, corrupt);
    assert.equal(readGoals(file).status, "corrupt");
    assert.throws(() => upsertGoal(newGoal("safe", root), file), /refusing to overwrite/);
    assert.equal(readFileSync(file, "utf8"), corrupt);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("explicit goal lookup is workspace-scoped", () => {
  const root = mkdtempSync(join(tmpdir(), "goals-explicit-"));
  const file = join(root, "goals.json");
  const current = join(root, "current");
  const other = join(root, "other");
  try {
    const elsewhere = newGoal("other", other);
    writeFileSync(file, JSON.stringify([elsewhere]));
    assert.equal(getGoalForWorkspace(elsewhere.id, current, file), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
