// skills.lock.json round-trip + drift, and the local digest-bound trust store.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSkillLock,
  writeSkillLock,
  compareLock,
  projectLockPath,
  userLockPath,
  type SkillLockEntry,
} from "../src/core/skills/skill_lock.js";
import {
  loadTrustStore,
  lookupTrust,
  recordTrust,
  removeTrust,
  trustStorePath,
  type SkillTrustRecord,
} from "../src/core/skills/skill_trust.js";

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "aether-trustlock-"));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Tests share one process (--test-isolation=none), so the env override is set
// and restored around every call that touches configDir(), never left global.
function withEnv<T>(fn: () => T): T {
  const prev = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = dir;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prev;
  }
}

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function lockEntry(id: string, sha256: string): SkillLockEntry {
  return { id, version: "1.0.0", source: ".aether/skills/project/" + id.split("/")[1], sha256, dependencies: [] };
}

test("lock paths derive from project root and config dir", () => {
  assert.equal(projectLockPath(join(dir, "proj")), join(dir, "proj", ".aether", "skills.lock.json"));
  withEnv(() => {
    assert.equal(userLockPath(), join(dir, "skills.lock.json"));
    assert.equal(trustStorePath(), join(dir, "skill-trust.json"));
  });
});

test("writeSkillLock then readSkillLock round-trips sorted", () => {
  const path = join(dir, "roundtrip", "skills.lock.json");
  writeSkillLock(path, [lockEntry("project/zeta", SHA_B), lockEntry("project/alpha", SHA_A)]);
  const result = readSkillLock(path);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.lock.skills.map((entry) => entry.id),
    ["project/alpha", "project/zeta"],
  );
  const first = result.lock.skills[0];
  assert.ok(first);
  assert.equal(first.sha256, SHA_A);
  assert.equal(first.version, "1.0.0");
});

test("missing lock reports missing=true", () => {
  const result = readSkillLock(join(dir, "nowhere", "skills.lock.json"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.missing, true);
});

test("corrupt JSON lock is an error, not missing", () => {
  const path = join(dir, "corrupt.lock.json");
  writeFileSync(path, "{ not json", "utf8");
  const result = readSkillLock(path);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.missing, false);
  assert.match(result.error, /not valid JSON/);
});

test("lock entry with bad sha256 rejected", () => {
  const path = join(dir, "badsha.lock.json");
  writeFileSync(
    path,
    JSON.stringify({
      schema_version: 1,
      skills: [{ id: "project/x", version: "1.0.0", source: "s", sha256: "abc123", dependencies: [] }],
    }),
    "utf8",
  );
  const result = readSkillLock(path);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /sha256 must be 64 hex chars/);
});

test("unsupported lock schema_version rejected", () => {
  const path = join(dir, "badver.lock.json");
  writeFileSync(path, JSON.stringify({ schema_version: 9, skills: [] }), "utf8");
  const result = readSkillLock(path);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /unsupported lock schema_version/);
});

test("compareLock classifies unlocked, missing, changed", () => {
  const path = join(dir, "drift.lock.json");
  writeSkillLock(path, [lockEntry("project/kept", SHA_A), lockEntry("project/gone", SHA_B)]);
  const read = readSkillLock(path);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const discovered = new Map<string, string>([
    ["project/kept", SHA_C], // digest drifted
    ["project/new", SHA_A], // never locked
  ]);
  const drift = compareLock(read.lock, discovered);
  assert.deepEqual(drift.unlocked, ["project/new"]);
  assert.deepEqual(drift.missing, ["project/gone"]);
  assert.deepEqual(drift.changed, ["project/kept"]);
});

function trustRecord(overrides: Partial<SkillTrustRecord> = {}): SkillTrustRecord {
  return {
    projectRoot: join(dir, "proj"),
    repository: null,
    skillId: "project/alpha",
    version: "1.0.0",
    sha256: SHA_A,
    trustedAt: new Date("2026-08-14T00:00:00Z").toISOString(),
    method: "inspect",
    requestedPermissions: ["workspace.read"],
    ...overrides,
  };
}

test("recordTrust then lookupTrust with same digest is trusted", () => {
  withEnv(() => {
    recordTrust(trustRecord());
    const lookup = lookupTrust(loadTrustStore(), join(dir, "proj"), "project/alpha", SHA_A);
    assert.equal(lookup.state, "trusted");
    if (lookup.state === "trusted") assert.equal(lookup.record.method, "inspect");
  });
});

test("different digest reports changed, never trusted", () => {
  withEnv(() => {
    recordTrust(trustRecord());
    const lookup = lookupTrust(loadTrustStore(), join(dir, "proj"), "project/alpha", SHA_B);
    assert.equal(lookup.state, "changed");
    if (lookup.state === "changed") assert.equal(lookup.record.sha256, SHA_A);
  });
});

test("no record at all is untrusted", () => {
  withEnv(() => {
    const lookup = lookupTrust(loadTrustStore(), join(dir, "proj"), "project/unknown", SHA_A);
    assert.equal(lookup.state, "untrusted");
  });
});

test("recordTrust replaces the prior record for the same (projectRoot, skillId)", () => {
  withEnv(() => {
    recordTrust(trustRecord({ sha256: SHA_A }));
    recordTrust(trustRecord({ sha256: SHA_B, version: "1.1.0" }));
    const store = loadTrustStore();
    const matches = store.records.filter(
      (record) => record.projectRoot === join(dir, "proj") && record.skillId === "project/alpha",
    );
    assert.equal(matches.length, 1, "one live record per (projectRoot, skillId)");
    assert.equal(lookupTrust(store, join(dir, "proj"), "project/alpha", SHA_B).state, "trusted");
    assert.equal(lookupTrust(store, join(dir, "proj"), "project/alpha", SHA_A).state, "changed");
  });
});

test("removeTrust deletes the record and reports whether one existed", () => {
  withEnv(() => {
    recordTrust(trustRecord());
    assert.equal(removeTrust(join(dir, "proj"), "project/alpha"), true);
    assert.equal(lookupTrust(loadTrustStore(), join(dir, "proj"), "project/alpha", SHA_A).state, "untrusted");
    assert.equal(removeTrust(join(dir, "proj"), "project/alpha"), false);
  });
});
