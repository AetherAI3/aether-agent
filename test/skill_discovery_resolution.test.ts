// Discovery over builtin/user/project roots + explicit/automatic resolution.
// Metadata-only indexing, trust folded from the local store, structured errors.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverSkills, projectSkillsRoot, userSkillsRoot } from "../src/core/skills/skill_discovery.js";
import { resolveExplicit, resolveAutomatic, dependencyOrder } from "../src/core/skills/skill_resolver.js";
import { recordTrust } from "../src/core/skills/skill_trust.js";
import { saveSkillSetting } from "../src/core/skills/skill_settings.js";
import { SkillError } from "../src/core/skills/skill_errors.js";
import { SKILL_BOUNDS } from "../src/core/skills/skill_bounds.js";
import type { SkillIndex, SkillDescriptor } from "../src/core/skills/skill_types.js";

let configDir: string;
let projectRoot: string;
let builtinRoot: string;

function manifest(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const shortName = id.split("/")[1] ?? id;
  return {
    schema_version: 1,
    id,
    version: "1.0.0",
    name: "Skill " + shortName,
    description: "Fixture skill " + id + " for discovery tests.",
    ...extra,
  };
}

function writeSkill(scopeRoot: string, dirName: string, raw: Record<string, unknown>, body = "# instructions\n"): string {
  const root = join(scopeRoot, dirName);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "skill.json"), JSON.stringify(raw, null, 2), "utf8");
  writeFileSync(join(root, "SKILL.md"), body, "utf8");
  return root;
}

// Tests share one process (--test-isolation=none), so the env override is set
// and restored around every call that touches configDir(), never left global.
function withEnv<T>(fn: () => T): T {
  const prev = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = configDir;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prev;
  }
}

function discover(): SkillIndex {
  return withEnv(() => discoverSkills({ projectRoot, builtinRoot, now: () => new Date("2026-08-14T12:00:00Z") }));
}

function byId(index: SkillIndex, id: string): SkillDescriptor {
  const descriptor = index.skills.find((skill) => skill.id === id);
  assert.ok(descriptor, "descriptor missing for " + id);
  return descriptor;
}

function skillErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof SkillError, "expected SkillError, got " + String(error));
    return error.code;
  }
  assert.fail("expected a SkillError to be thrown");
}

before(() => {
  configDir = mkdtempSync(join(tmpdir(), "aether-disc-cfg-"));
  projectRoot = mkdtempSync(join(tmpdir(), "aether-disc-proj-"));
  builtinRoot = mkdtempSync(join(tmpdir(), "aether-disc-builtin-"));

  const projRoot = projectSkillsRoot(projectRoot);
  const userRoot = withEnv(() => userSkillsRoot());
  assert.equal(userRoot, join(configDir, "skills", "user"));

  writeSkill(projRoot, "alpha", manifest("project/alpha", {
    triggers: { phrases: ["alpha project phrase"], automatic: true },
  }), "# alpha body v1\n");
  writeSkill(projRoot, "tool", manifest("project/tool"));
  writeSkill(userRoot, "tool", manifest("user/tool"));
  writeSkill(userRoot, "beta", manifest("user/beta", { triggers: { commands: ["beta-cmd"] } }));
  writeSkill(userRoot, "off", manifest("user/off"));
  writeSkill(userRoot, "base", manifest("user/base"));
  writeSkill(userRoot, "child", manifest("user/child", { dependencies: { skills: ["user/base"] } }));
  writeSkill(userRoot, "orphan", manifest("user/orphan", { dependencies: { skills: ["user/ghost"] } }));
  writeSkill(userRoot, "cyc-a", manifest("user/cyc-a", { dependencies: { skills: ["user/cyc-b"] } }));
  writeSkill(userRoot, "cyc-b", manifest("user/cyc-b", { dependencies: { skills: ["user/cyc-a"] } }));

  for (let index = 1; index <= SKILL_BOUNDS.maxAutomaticSkillsPerTurn + 1; index++) {
    writeSkill(builtinRoot, "auto" + index, manifest("builtin/auto" + index, {
      triggers: { phrases: ["shared builtin trigger phrase"], automatic: true },
    }));
  }

  // duplicate fully qualified id across two directories
  writeSkill(projRoot, "dup-one", manifest("project/dupped"));
  writeSkill(projRoot, "dup-two", manifest("project/dupped"));

  // malformed manifest — must land in index.errors, never throw
  const brokenRoot = join(projRoot, "broken");
  mkdirSync(brokenRoot, { recursive: true });
  writeFileSync(join(brokenRoot, "skill.json"), "{ not json at all", "utf8");

  withEnv(() => saveSkillSetting({ projectRoot: "*", skillId: "user/off", enabled: false, automatic: false }));
});

after(() => {
  rmSync(configDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(builtinRoot, { recursive: true, force: true });
});

test("index has correct scopes and default trust states", () => {
  const index = discover();
  assert.equal(byId(index, "project/alpha").scope, "project");
  assert.equal(byId(index, "project/alpha").trust, "untrusted");
  assert.equal(byId(index, "project/alpha").automatic, false, "untrusted project skill never automatic");
  assert.equal(byId(index, "user/beta").scope, "user");
  assert.equal(byId(index, "user/beta").trust, "trusted");
  assert.equal(byId(index, "builtin/auto1").scope, "builtin");
  assert.equal(byId(index, "builtin/auto1").trust, "builtin");
  assert.equal(byId(index, "builtin/auto1").automatic, true);
  assert.equal(byId(index, "user/off").enabled, false);
});

test("duplicate skill id and malformed manifest are index errors, not throws", () => {
  const index = discover();
  assert.ok(
    index.errors.some((error) => error.errors.some((message) => message.includes("duplicate skill id: project/dupped"))),
    "duplicate id error missing",
  );
  assert.ok(
    index.errors.some((error) => error.root.endsWith("broken") && error.errors.some((message) => message.includes("not valid JSON"))),
    "malformed skill.json error missing",
  );
  assert.equal(index.skills.filter((skill) => skill.id === "project/dupped").length, 1);
});

test("untrusted project skill refuses explicit resolution", () => {
  const index = discover();
  assert.equal(skillErrorCode(() => resolveExplicit(index, "project/alpha")), "skill.untrusted");
});

test("recordTrust with the resolved project root makes the skill trusted, edits flip it to changed", () => {
  let index = discover();
  const alpha = byId(index, "project/alpha");
  withEnv(() => recordTrust({
    projectRoot: resolve(projectRoot),
    repository: null,
    skillId: alpha.id,
    version: alpha.version,
    sha256: alpha.sha256,
    trustedAt: new Date().toISOString(),
    method: "inspect",
    requestedPermissions: [],
  }));
  index = discover();
  assert.equal(byId(index, "project/alpha").trust, "trusted");
  const resolved = resolveExplicit(index, "project/alpha");
  assert.equal(resolved.candidate.descriptor.id, "project/alpha");
  assert.equal(resolved.candidate.invocation, "explicit");

  writeFileSync(join(projectSkillsRoot(projectRoot), "alpha", "SKILL.md"), "# alpha body v2 EDITED\n", "utf8");
  index = discover();
  assert.equal(byId(index, "project/alpha").trust, "changed");
  assert.equal(skillErrorCode(() => resolveExplicit(index, "project/alpha")), "skill.changed");
});

test("resolveExplicit: full id, unique short name, command alias", () => {
  const index = discover();
  assert.equal(resolveExplicit(index, "user/beta").candidate.descriptor.id, "user/beta");
  assert.equal(resolveExplicit(index, "beta").candidate.descriptor.id, "user/beta");
  assert.equal(resolveExplicit(index, "beta-cmd").candidate.descriptor.id, "user/beta");
});

test("short name shared across scopes is ambiguous", () => {
  const index = discover();
  try {
    resolveExplicit(index, "tool");
    assert.fail("expected ambiguity");
  } catch (error) {
    assert.ok(error instanceof SkillError);
    assert.equal(error.code, "skill.ambiguous");
    const matches = error.refusal.context?.["matches"];
    assert.ok(Array.isArray(matches) && matches.length === 2, "ambiguity lists both candidates");
  }
});

test("disabled skill refuses with skill.disabled", () => {
  const index = discover();
  assert.equal(skillErrorCode(() => resolveExplicit(index, "user/off")), "skill.disabled");
});

test("unknown reference is skill.not_found", () => {
  const index = discover();
  assert.equal(skillErrorCode(() => resolveExplicit(index, "user/never-existed")), "skill.not_found");
});

test("dependencyOrder puts dependencies first", () => {
  const index = discover();
  const order = dependencyOrder(index, byId(index, "user/child"));
  assert.deepEqual(order.map((descriptor) => descriptor.id), ["user/base", "user/child"]);
});

test("missing dependency is skill.dependency_missing", () => {
  const index = discover();
  assert.equal(
    skillErrorCode(() => dependencyOrder(index, byId(index, "user/orphan"))),
    "skill.dependency_missing",
  );
});

test("dependency cycle is skill.dependency_cycle", () => {
  const index = discover();
  assert.equal(
    skillErrorCode(() => dependencyOrder(index, byId(index, "user/cyc-a"))),
    "skill.dependency_cycle",
  );
});

test("resolveAutomatic matches only automatic trusted skills by phrase", () => {
  const index = discover();
  // project/alpha declares automatic + a phrase but has no trusted opt-in.
  const alphaMatches = resolveAutomatic(index, "please run the alpha project phrase now");
  assert.equal(alphaMatches.length, 0, "non-automatic project skill must not match");

  const none = resolveAutomatic(index, "prompt without any trigger");
  assert.equal(none.length, 0);

  const matches = resolveAutomatic(index, "do the shared builtin trigger phrase please");
  assert.ok(matches.length > 0);
  for (const match of matches) {
    assert.equal(match.candidate.invocation, "automatic");
    assert.match(match.candidate.reason, /trigger phrase/);
    assert.ok(match.candidate.descriptor.id.startsWith("builtin/auto"));
  }
});

test("resolveAutomatic caps at SKILL_BOUNDS.maxAutomaticSkillsPerTurn", () => {
  const index = discover();
  const eligible = index.skills.filter((skill) => skill.automatic).length;
  assert.ok(eligible > SKILL_BOUNDS.maxAutomaticSkillsPerTurn, "fixture must exceed the cap");
  const matches = resolveAutomatic(index, "do the shared builtin trigger phrase please");
  assert.equal(matches.length, SKILL_BOUNDS.maxAutomaticSkillsPerTurn);
});
