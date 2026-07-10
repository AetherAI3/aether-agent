import { test } from "node:test";
import assert from "node:assert/strict";
import { basename, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  ContextRegistry,
  listSnapshots,
  loadSnapshot,
  saveSnapshot,
} from "../src/core/context_registry.js";
import { normalizeWorkspace } from "../src/core/workspace_scope.js";

test("snapshots carry canonical scope and reject cross-workspace or legacy restore", () => {
  const root = mkdtempSync(join(tmpdir(), "ctx-"));
  const other = mkdtempSync(join(tmpdir(), "ctx-other-"));
  try {
    const file = join(root, "pinned.txt");
    writeFileSync(file, "ok");
    const registry = new ContextRegistry();
    registry.pin(file, "pinned", "needed");
    const data = registry.toSnapshot(root);
    assert.equal(data.cwd, normalizeWorkspace(root));
    assert.equal(ContextRegistry.fromSnapshot(data, root).pins.length, 1);
    assert.throws(() => ContextRegistry.fromSnapshot(data, other), /another workspace/);
    assert.throws(() => ContextRegistry.fromSnapshot({ ...data, cwd: undefined }, root), /unscoped/);
    assert.throws(
      () => ContextRegistry.fromSnapshot({ ...data, pins: [{ ...data.pins[0]!, path: join(root, "..", "escape") }] }, root),
      /escapes workspace/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test("snapshot persistence uses opaque ids and workspace-filtered listing", () => {
  const root = mkdtempSync(join(tmpdir(), "ctx-"));
  const store = mkdtempSync(join(tmpdir(), "snaps-"));
  const old = process.env["AETHER_SNAPSHOT_DIR"];
  process.env["AETHER_SNAPSHOT_DIR"] = store;
  try {
    const path = saveSnapshot(new ContextRegistry(), root);
    assert.equal(loadSnapshot(basename(path))?.cwd, normalizeWorkspace(root));
    assert.equal(listSnapshots(root).length, 1);
    assert.throws(() => loadSnapshot("../outside.json"), /invalid snapshot id/);
  } finally {
    if (old === undefined) delete process.env["AETHER_SNAPSHOT_DIR"];
    else process.env["AETHER_SNAPSHOT_DIR"] = old;
    rmSync(root, { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
  }
});
