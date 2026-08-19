// The lazy-loading contract: discovery retains metadata only — never body
// text — and loadSkillBody re-reads with digest re-verification (TOCTOU-safe).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills, projectSkillsRoot } from "../src/core/skills/skill_discovery.js";
import { loadSkillBody } from "../src/core/skills/skill_loader.js";
import { SkillError } from "../src/core/skills/skill_errors.js";
import { SKILL_BOUNDS } from "../src/core/skills/skill_bounds.js";
import type { SkillIndex, SkillDescriptor } from "../src/core/skills/skill_types.js";

const CANARY = "CANARY-9f3e2d1c-lazy-proof-do-not-index";

let configDir: string;
let projectRoot: string;
let builtinRoot: string;

function manifest(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    id,
    version: "1.0.0",
    name: "Lazy " + (id.split("/")[1] ?? id),
    description: "Fixture skill " + id + " for lazy-loading tests.",
    ...extra,
  };
}

function writeSkill(dirName: string, raw: Record<string, unknown>, files: Readonly<Record<string, string | Buffer>>): string {
  const root = join(projectSkillsRoot(projectRoot), dirName);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "skill.json"), JSON.stringify(raw, null, 2), "utf8");
  for (const [relative, content] of Object.entries(files)) {
    writeFileSync(join(root, relative), content);
  }
  return root;
}

// Tests share one process (--test-isolation=none), so the env override is set
// and restored around every discovery call, never left global.
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
  return withEnv(() => discoverSkills({ projectRoot, builtinRoot }));
}

function byId(index: SkillIndex, id: string): SkillDescriptor {
  const descriptor = index.skills.find((skill) => skill.id === id);
  assert.ok(descriptor, "descriptor missing for " + id);
  return descriptor;
}

before(() => {
  configDir = mkdtempSync(join(tmpdir(), "aether-lazy-cfg-"));
  projectRoot = mkdtempSync(join(tmpdir(), "aether-lazy-proj-"));
  builtinRoot = mkdtempSync(join(tmpdir(), "aether-lazy-builtin-"));

  writeSkill("lazy", manifest("project/lazy"), {
    "SKILL.md": "# Lazy skill\n\n" + CANARY + "\n",
  });
  writeSkill("swap", manifest("project/swap"), {
    "SKILL.md": "# original body\n",
  });
  writeSkill("binary", manifest("project/binary", { context: { resources: ["data.bin"] } }), {
    "SKILL.md": "# binary resource skill\n",
    "data.bin": Buffer.from([0x68, 0x69, 0x00, 0x21]),
  });
  writeSkill("oversized", manifest("project/oversized", { context: { resources: ["huge.md"] } }), {
    "SKILL.md": "# oversized resource skill\n",
    "huge.md": Buffer.alloc(SKILL_BOUNDS.maxResourceBytes + 1, 0x62),
  });
});

after(() => {
  rmSync(configDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(builtinRoot, { recursive: true, force: true });
});

test("discovery retains no instruction body — canary absent from the whole index", () => {
  const index = discover();
  const descriptor = byId(index, "project/lazy");
  assert.equal("instructions" in descriptor, false, "descriptor must not carry an instructions field");
  const serialized = JSON.stringify(index);
  assert.equal(serialized.includes(CANARY), false, "SKILL.md body leaked into the metadata index");
});

test("loadSkillBody re-reads and returns the canary", () => {
  const index = discover();
  const loaded = loadSkillBody(byId(index, "project/lazy"), "explicit");
  assert.ok(loaded.instructions.includes(CANARY));
  assert.equal(loaded.invocation, "explicit");
  assert.equal(loaded.resources.length, 0);
  assert.ok(loaded.loadedBytes > 0);
});

test("TOCTOU: SKILL.md modified after discovery refuses with skill.resource_changed", () => {
  const index = discover();
  const descriptor = byId(index, "project/swap");
  writeFileSync(join(descriptor.root, "SKILL.md"), "# swapped after indexing\n", "utf8");
  try {
    loadSkillBody(descriptor, "explicit");
    assert.fail("expected refusal");
  } catch (error) {
    assert.ok(error instanceof SkillError);
    assert.equal(error.code, "skill.resource_changed");
  }
  // restore so later discoveries in this file stay clean
  writeFileSync(join(descriptor.root, "SKILL.md"), "# original body\n", "utf8");
});

test("oversized declared resource is refused at discovery (digest cap)", () => {
  const index = discover();
  assert.equal(index.skills.some((skill) => skill.id === "project/oversized"), false);
  assert.ok(
    index.errors.some(
      (error) => error.root.endsWith("oversized") && error.errors.some((message) => /exceeds \d+ bytes: huge\.md/.test(message)),
    ),
    "oversized resource must surface as an index error",
  );
});

test("binary declared resource loads at discovery but refuses in loadSkillBody with skill.resource_unsafe", () => {
  const index = discover();
  const descriptor = byId(index, "project/binary");
  try {
    loadSkillBody(descriptor, "explicit");
    assert.fail("expected refusal");
  } catch (error) {
    assert.ok(error instanceof SkillError);
    assert.equal(error.code, "skill.resource_unsafe");
    assert.match(error.refusal.detail, /binary resource not supported: data\.bin/);
  }
});
