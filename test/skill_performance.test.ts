// Loop F — lazy-loading and performance bounds.
// Discovery over many skills stays linear and never opens non-selected bodies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills } from "../src/core/skills/skill_discovery.js";
import { resolveAutomatic } from "../src/core/skills/skill_resolver.js";
import { SKILL_BOUNDS } from "../src/core/skills/skill_bounds.js";

function withEnv<T>(key: string, value: string, fn: () => T): T {
  const prior = process.env[key];
  process.env[key] = value;
  try {
    return fn();
  } finally {
    if (prior == null) delete process.env[key];
    else process.env[key] = prior;
  }
}

function seedProject(count: number): string {
  const root = mkdtempSync(join(tmpdir(), "aether-perf-"));
  for (let index = 0; index < count; index++) {
    const name = "skill-" + String(index).padStart(4, "0");
    const dir = join(root, ".aether", "skills", "project", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "skill.json"), JSON.stringify({
      schema_version: 1,
      id: "project/" + name,
      version: "1.0.0",
      name: "Skill " + index,
      description: "perf fixture " + index,
      entrypoint: "SKILL.md",
      triggers: { commands: [], phrases: ["perf trigger " + index], automatic: true },
      tools: { allowed: ["read_file"], required: [], denied: [] },
      permissions: { requires: ["workspace.read"], may_request: [], forbids: [] },
      context: { max_tokens: 100, resources: [] },
      outputs: { kinds: [], verification: [] },
      dependencies: { skills: [] },
      compatibility: { min_agent_version: "0.1.0", capability_contract: 1 },
      health: { eval_manifest: null },
    }));
    writeFileSync(join(dir, "SKILL.md"), "BODY-CANARY-" + index + "\n");
  }
  return root;
}

test("indexing 200 skills stays bounded and retains no body text", () => {
  const root = seedProject(200);
  withEnv("AETHER_CONFIG_DIR", mkdtempSync(join(tmpdir(), "aether-cfg-")), () => {
    const emptyBuiltin = mkdtempSync(join(tmpdir(), "aether-bi-"));
    const started = process.hrtime.bigint();
    const index = discoverSkills({ projectRoot: root, builtinRoot: emptyBuiltin });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(index.skills.length, 200);
    // Generous CI bound: linear digest walk over 200 tiny skills. A quadratic
    // regression (directory rescan per skill) blows far past this.
    assert.ok(elapsedMs < 10_000, "indexing took " + elapsedMs.toFixed(0) + "ms");
    const serialized = JSON.stringify(index);
    assert.ok(!serialized.includes("BODY-CANARY-"), "index retained skill body text");
  });
});

test("automatic selection over a large index respects the candidate cap", () => {
  const root = seedProject(50);
  withEnv("AETHER_CONFIG_DIR", mkdtempSync(join(tmpdir(), "aether-cfg-")), () => {
    const emptyBuiltin = mkdtempSync(join(tmpdir(), "aether-bi-"));
    const index = discoverSkills({ projectRoot: root, builtinRoot: emptyBuiltin });
    // Project skills are untrusted by default → automatic selection yields
    // NOTHING even though every manifest says automatic: true. Trust is the
    // gate; the cap only applies after it.
    const prompt = "perf trigger 0 perf trigger 1 perf trigger 2 perf trigger 3 perf trigger 4";
    const matches = resolveAutomatic(index, prompt);
    assert.equal(matches.length, 0);
    assert.ok(SKILL_BOUNDS.maxAutomaticSkillsPerTurn <= 3);
  });
});
