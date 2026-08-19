// aether.skill/v1 manifest validation — every invalid class is a hard,
// actionable error; valid manifests normalize deterministically.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSkillManifest,
  compareSemver,
  isSafeRelativePath,
  SKILL_SCHEMA_VERSION,
  type SkillScope,
} from "../src/core/skills/skill_schema.js";

function fullManifest(): Record<string, unknown> {
  return {
    schema_version: SKILL_SCHEMA_VERSION,
    id: "project/review-pr",
    version: "1.2.3",
    name: "Review PR",
    description: "Reviews a pull request against repo conventions.",
    entrypoint: "SKILL.md",
    triggers: {
      commands: ["review-pr"],
      phrases: ["review this pr"],
      automatic: true,
    },
    tools: {
      allowed: ["read_file", "repo_search", "web_fetch"],
      required: ["read_file"],
      denied: ["run_shell"],
    },
    permissions: {
      requires: ["workspace.read"],
      may_request: ["network.general"],
      forbids: ["git.push"],
    },
    context: {
      max_tokens: 2000,
      resources: ["references/checklist.md"],
    },
    outputs: {
      kinds: ["review"],
      verification: ["typecheck passes"],
    },
    dependencies: { skills: ["project/style-guide"] },
    compatibility: { min_agent_version: "0.2.0", capability_contract: 1 },
    health: { eval_manifest: "evals/manifest.json" },
  };
}

function expectErrors(raw: unknown, scope: SkillScope, pattern: RegExp): void {
  const result = validateSkillManifest(raw, scope);
  assert.equal(result.ok, false, "expected validation failure");
  if (result.ok) return;
  assert.ok(
    result.errors.some((error) => pattern.test(error)),
    "no error matched " + pattern + " in: " + JSON.stringify(result.errors),
  );
}

test("valid full manifest passes and normalizes", () => {
  const result = validateSkillManifest(fullManifest(), "project");
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.errors));
  if (!result.ok) return;
  const manifest = result.manifest;
  assert.equal(manifest.schemaVersion, SKILL_SCHEMA_VERSION);
  assert.equal(manifest.id, "project/review-pr");
  assert.equal(manifest.version, "1.2.3");
  assert.equal(manifest.entrypoint, "SKILL.md");
  assert.deepEqual(manifest.triggers, {
    commands: ["review-pr"],
    phrases: ["review this pr"],
    automatic: true,
  });
  assert.deepEqual(manifest.tools, {
    allowed: ["read_file", "repo_search", "web_fetch"],
    required: ["read_file"],
    denied: ["run_shell"],
  });
  assert.deepEqual(manifest.permissions, {
    requires: ["workspace.read"],
    mayRequest: ["network.general"],
    forbids: ["git.push"],
  });
  assert.equal(manifest.context.maxTokens, 2000);
  assert.deepEqual(manifest.context.resources, ["references/checklist.md"]);
  assert.deepEqual(manifest.dependencies.skills, ["project/style-guide"]);
  assert.equal(manifest.compatibility.minAgentVersion, "0.2.0");
  assert.equal(manifest.health.evalManifest, "evals/manifest.json");
});

test("minimal manifest gets documented defaults", () => {
  const result = validateSkillManifest(
    {
      schema_version: SKILL_SCHEMA_VERSION,
      id: "user/tiny",
      version: "0.1.0",
      name: "Tiny",
      description: "Smallest valid skill.",
    },
    "user",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.entrypoint, "SKILL.md");
  assert.equal(result.manifest.triggers.automatic, false);
  assert.deepEqual(result.manifest.tools.allowed, []);
  assert.equal(result.manifest.context.maxTokens, 4000);
  assert.equal(result.manifest.health.evalManifest, null);
});

test("non-object manifest rejected", () => {
  expectErrors([], "project", /must be a JSON object/);
  expectErrors("nope", "project", /must be a JSON object/);
});

test("unknown top-level key rejected", () => {
  expectErrors({ ...fullManifest(), surprise: 1 }, "project", /unknown key: surprise/);
});

test("unsupported schema_version mentions migration path", () => {
  const result = validateSkillManifest({ ...fullManifest(), schema_version: 99 }, "project");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.length, 1);
  const message = result.errors[0] ?? "";
  assert.match(message, /unsupported schema_version 99/);
  assert.match(message, /upgrade the agent or re-author/);
  assert.match(message, new RegExp("aether\\.skill/v" + SKILL_SCHEMA_VERSION));
});

test("bad id casing rejected", () => {
  expectErrors({ ...fullManifest(), id: "Project/Review-PR" }, "project", /id must match/);
});

test("id scope mismatch rejected", () => {
  expectErrors({ ...fullManifest(), id: "user/review-pr" }, "project", /does not match discovery scope 'project'/);
});

test("aether/* namespace rejected outside builtin scope", () => {
  expectErrors({ ...fullManifest(), id: "aether/review-pr" }, "project", /reserved for signed built-in skills/);
});

test("non-semver version rejected", () => {
  expectErrors({ ...fullManifest(), version: "1.2" }, "project", /strict semver/);
  expectErrors({ ...fullManifest(), version: "v1.2.3" }, "project", /strict semver/);
  expectErrors({ ...fullManifest(), version: "1.02.3" }, "project", /strict semver/);
});

test("tools.required must be subset of tools.allowed", () => {
  const raw = fullManifest();
  raw["tools"] = { allowed: ["read_file"], required: ["write_file"], denied: [] };
  expectErrors(raw, "project", /required must be a subset of tools\.allowed: write_file/);
});

test("tools.denied must not intersect tools.allowed", () => {
  const raw = fullManifest();
  raw["tools"] = { allowed: ["read_file"], required: [], denied: ["read_file"] };
  expectErrors(raw, "project", /denied must not intersect tools\.allowed: read_file/);
});

test("unknown tool name rejected", () => {
  const raw = fullManifest();
  raw["tools"] = { allowed: ["teleport"], required: [], denied: [] };
  expectErrors(raw, "project", /unknown tool name: teleport/);
});

test("unknown permission name rejected", () => {
  const raw = fullManifest();
  raw["permissions"] = { requires: ["universe.admin"], may_request: [], forbids: [] };
  expectErrors(raw, "project", /unknown permission name: universe\.admin/);
});

test("undeclarable permission secrets.read rejected in requires", () => {
  const raw = fullManifest();
  raw["permissions"] = { requires: ["secrets.read"], may_request: [], forbids: [] };
  expectErrors(raw, "project", /'secrets\.read' cannot be declared by a skill/);
});

test("permission both requested and forbidden rejected", () => {
  const raw = fullManifest();
  raw["permissions"] = { requires: ["workspace.read"], may_request: [], forbids: ["workspace.read"] };
  expectErrors(raw, "project", /'workspace\.read' is both requested and forbidden/);
});

test("absolute, traversal, and URL resource paths rejected", () => {
  for (const bad of ["/etc/passwd", "C:/windows/win.ini", "../outside.md", "docs/../../escape.md", "https://evil.example/x.md", "file:x"]) {
    const raw = fullManifest();
    raw["context"] = { resources: [bad] };
    expectErrors(raw, "project", /safe relative path/);
  }
  assert.equal(isSafeRelativePath("docs/notes.md"), true);
  assert.equal(isSafeRelativePath("docs\\notes.md"), false);
  assert.equal(isSafeRelativePath(""), false);
});

test("oversized description rejected", () => {
  expectErrors({ ...fullManifest(), description: "x".repeat(1025) }, "project", /description is required, at most/);
});

test("duplicate list entries rejected", () => {
  const raw = fullManifest();
  raw["tools"] = { allowed: ["read_file", "read_file"], required: [], denied: [] };
  expectErrors(raw, "project", /duplicate entry: read_file/);
});

test("self-dependency rejected", () => {
  const raw = fullManifest();
  raw["dependencies"] = { skills: ["project/review-pr"] };
  expectErrors(raw, "project", /cannot depend on itself/);
});

test("compareSemver orders strictly", () => {
  assert.ok(compareSemver("1.0.0", "1.0.1") < 0);
  assert.ok(compareSemver("1.0.9", "1.1.0") < 0);
  assert.ok(compareSemver("1.9.0", "1.10.0") < 0);
  assert.ok(compareSemver("2.0.0", "1.99.99") > 0);
  assert.equal(compareSemver("1.2.3", "1.2.3"), 0);
});
