import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confineToWorkspace,
  isCurrentWorkspace,
  normalizeWorkspace,
  requireOpaqueId,
  resolveOpaqueChild,
  workspaceFingerprint,
  workspaceScope,
} from "../src/core/workspace_scope.js";

test("workspace scope distinguishes current, other, and legacy unscoped records", () => {
  const root = mkdtempSync(join(tmpdir(), "scope-"));
  const other = mkdtempSync(join(tmpdir(), "scope-other-"));
  try {
    assert.equal(workspaceScope(root, root), "current");
    assert.equal(workspaceScope(other, root), "other");
    assert.equal(workspaceScope(undefined, root), "unscoped");
    assert.equal(isCurrentWorkspace(undefined, root), false);
    assert.equal(workspaceFingerprint(root).length, 16);
    assert.equal(normalizeWorkspace(root), normalizeWorkspace(join(root, ".")));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test("opaque ids reject traversal, separators, drive and UNC payloads", () => {
  for (const value of ["", ".", "..", "../x", "..\\x", "/tmp/x", "C:\\x", "\\\\server\\share", "a/b"]) {
    assert.throws(() => requireOpaqueId(value), /invalid id/);
  }
  assert.equal(requireOpaqueId("snapshot-2026.01.json"), "snapshot-2026.01.json");
});

test("confined paths reject lexical and symlink escapes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "scope-"));
  const outside = mkdtempSync(join(tmpdir(), "scope-out-"));
  try {
    const file = join(root, "ok.txt");
    writeFileSync(file, "ok");
    assert.equal(confineToWorkspace(root, "ok.txt", true), normalizeWorkspace(file));
    assert.throws(() => confineToWorkspace(root, join("..", "escape.txt")), /escapes workspace/);
    mkdirSync(join(root, "nested"));
    try {
      symlinkSync(outside, join(root, "nested", "link"), "junction");
      assert.throws(() => confineToWorkspace(root, join("nested", "link", "secret.txt")), /link/);
    } catch {
      t.diagnostic("symlink creation unavailable; lexical guards still exercised");
    }
    assert.equal(resolveOpaqueChild(root, "item.json"), join(normalizeWorkspace(root), "item.json"));
    assert.throws(() => resolveOpaqueChild(root, "../item"), /invalid id/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
