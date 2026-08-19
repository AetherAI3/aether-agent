// Effective policy intersection, per-call refusal gate, and the bounded
// sanitized skill context packet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../src/core/brain_protocol.js";
import {
  calculateSkillPolicy,
  refuseUndeclaredToolCall,
  assertRequiredPermissions,
  type PermissionEnvelope,
} from "../src/core/skills/skill_policy.js";
import {
  buildSkillContextPacket,
  sanitizeForTransport,
  approximateTokens,
  SKILL_CONTEXT_CONTRACT_VERSION,
} from "../src/core/skills/context_packet.js";
import { SkillError } from "../src/core/skills/skill_errors.js";
import { SKILL_BOUNDS } from "../src/core/skills/skill_bounds.js";
import { validateToolPermissionCoverage, type PermissionName } from "../src/core/skills/permission_vocabulary.js";
import { validateSkillManifest } from "../src/core/skills/skill_schema.js";
import type { LoadedSkill, SkillDescriptor, SkillPolicy } from "../src/core/skills/skill_types.js";

function makeLoadedSkill(options: {
  id?: string;
  allowed?: readonly string[];
  requires?: readonly string[];
  forbids?: readonly string[];
  instructions?: string;
  loadedBytes?: number;
} = {}): LoadedSkill {
  const id = options.id ?? "user/policy-demo";
  const validation = validateSkillManifest(
    {
      schema_version: 1,
      id,
      version: "1.0.0",
      name: "Policy Demo",
      description: "Fixture skill for policy and packet tests.",
      tools: { allowed: options.allowed ?? ["read_file"], required: [], denied: [] },
      permissions: {
        requires: options.requires ?? [],
        may_request: [],
        forbids: options.forbids ?? [],
      },
    },
    "user",
  );
  assert.equal(validation.ok, true, JSON.stringify(validation.ok ? [] : validation.errors));
  if (!validation.ok) throw new Error("unreachable");
  const descriptor: SkillDescriptor = {
    id,
    version: "1.0.0",
    name: "Policy Demo",
    description: "Fixture skill for policy and packet tests.",
    scope: "user",
    root: "/virtual/" + id,
    sha256: "d".repeat(64),
    trust: "trusted",
    enabled: true,
    automatic: false,
    approxTokens: 100,
    manifest: validation.manifest,
  };
  const instructions = options.instructions ?? "# do the thing\n";
  return {
    descriptor,
    invocation: "explicit",
    instructions,
    resources: [{ name: "notes.md", sha256: "e".repeat(64), content: "note body\n" }],
    loadedBytes: options.loadedBytes ?? instructions.length + 10,
  };
}

function envelope(...names: PermissionName[]): PermissionEnvelope {
  return new Set(names);
}

test("calculateSkillPolicy drops tools whose permission the skill forbids", () => {
  const skill = makeLoadedSkill({
    allowed: ["read_file", "web_fetch", "web_search"],
    forbids: ["network.general"],
  });
  const policy = calculateSkillPolicy(skill);
  assert.deepEqual(policy.allowedTools, ["read_file"]);
  assert.equal(policy.skillId, "user/policy-demo");
  assert.deepEqual(policy.forbiddenPermissions, ["network.general"]);
});

test("refuseUndeclaredToolCall: unknown tool", () => {
  const refusal = refuseUndeclaredToolCall("teleport", [], envelope());
  assert.ok(refusal);
  assert.equal(refusal.code, "skill.tool_not_declared");
  assert.match(refusal.detail, /unknown tool: teleport/);
});

test("refuseUndeclaredToolCall: undeclared tool includes effective_allowed_tools", () => {
  const policy = calculateSkillPolicy(makeLoadedSkill({ allowed: ["read_file"] }));
  const refusal = refuseUndeclaredToolCall("write_file", [policy], envelope("workspace.write"));
  assert.ok(refusal);
  assert.equal(refusal.code, "skill.tool_not_declared");
  assert.equal(refusal.skillId, "user/policy-demo");
  assert.deepEqual(refusal.context?.["effective_allowed_tools"], ["read_file"]);
});

test("refuseUndeclaredToolCall: forbidden permission wins even when tool is listed", () => {
  // Handcrafted policy: allowedTools still contains the tool, so the forbidden
  // permission branch (not the undeclared branch) must fire.
  const policy: SkillPolicy = {
    skillId: "user/handmade",
    allowedTools: ["web_fetch"],
    requiredPermissions: [],
    forbiddenPermissions: ["network.general"],
  };
  const refusal = refuseUndeclaredToolCall("web_fetch", [policy], envelope("network.general"));
  assert.ok(refusal);
  assert.equal(refusal.code, "skill.permission_denied");
  assert.equal(refusal.context?.["permission"], "network.general");
});

test("refuseUndeclaredToolCall: missing envelope permission", () => {
  const policy = calculateSkillPolicy(makeLoadedSkill({ allowed: ["read_file"] }));
  const refusal = refuseUndeclaredToolCall("read_file", [policy], envelope("workspace.write"));
  assert.ok(refusal);
  assert.equal(refusal.code, "skill.permission_unavailable");
  assert.equal(refusal.context?.["permission"], "workspace.read");
});

test("refuseUndeclaredToolCall: null when declared and permitted", () => {
  const policy = calculateSkillPolicy(makeLoadedSkill({ allowed: ["read_file"] }));
  assert.equal(refuseUndeclaredToolCall("read_file", [policy], envelope("workspace.read")), null);
});

test("assertRequiredPermissions throws skill.permission_unavailable", () => {
  const policy = calculateSkillPolicy(makeLoadedSkill({ allowed: ["git_commit"], requires: ["git.commit"] }));
  assert.equal(undefined, assertRequiredPermissions(policy, envelope("git.commit")));
  try {
    assertRequiredPermissions(policy, envelope("workspace.read"));
    assert.fail("expected refusal");
  } catch (error) {
    assert.ok(error instanceof SkillError);
    assert.equal(error.code, "skill.permission_unavailable");
    assert.equal(error.refusal.context?.["permission"], "git.commit");
  }
});

test("buildSkillContextPacket produces the versioned, digest-prefixed shape", () => {
  const packet = buildSkillContextPacket([makeLoadedSkill()]);
  assert.equal(packet.contract_version, SKILL_CONTEXT_CONTRACT_VERSION);
  assert.equal(packet.contract_version, 1);
  assert.equal(packet.skills.length, 1);
  const entry = packet.skills[0];
  assert.ok(entry);
  assert.equal(entry.id, "user/policy-demo");
  assert.equal(entry.digest, "sha256:" + "d".repeat(64));
  assert.equal(entry.invocation, "explicit");
  assert.equal(entry.scope, "user");
  const resource = entry.resources[0];
  assert.ok(resource);
  assert.equal(resource.digest, "sha256:" + "e".repeat(64));
  assert.deepEqual(entry.tool_policy.allowed, ["read_file"]);
});

test("skill count over maxSkillsPerTurn refuses with skill.context_budget_exceeded", () => {
  const skills = Array.from({ length: SKILL_BOUNDS.maxSkillsPerTurn + 1 }, (_, index) =>
    makeLoadedSkill({ id: "user/many-" + index }),
  );
  try {
    buildSkillContextPacket(skills);
    assert.fail("expected refusal");
  } catch (error) {
    assert.ok(error instanceof SkillError);
    assert.equal(error.code, "skill.context_budget_exceeded");
  }
});

test("token budget overflow refuses with skill.context_budget_exceeded", () => {
  const overBudgetBytes = (SKILL_BOUNDS.maxLoadedSkillTokens + 1) * 4;
  assert.ok(approximateTokens(overBudgetBytes) > SKILL_BOUNDS.maxLoadedSkillTokens);
  try {
    buildSkillContextPacket([makeLoadedSkill({ loadedBytes: overBudgetBytes })]);
    assert.fail("expected refusal");
  } catch (error) {
    assert.ok(error instanceof SkillError);
    assert.equal(error.code, "skill.context_budget_exceeded");
    assert.match(error.refusal.detail, /budget/);
  }
});

test("sanitizeForTransport strips NUL and ESC but keeps newline and tab", () => {
  assert.equal(sanitizeForTransport("a\u0000b\u001bc\nd\te\u007ff"), "abc\nd\tef");
  assert.equal(sanitizeForTransport("clean text\n"), "clean text\n");
});

test("validateToolPermissionCoverage over the frozen tool set returns no findings", () => {
  assert.deepEqual(validateToolPermissionCoverage(TOOLS), []);
  assert.notDeepEqual(validateToolPermissionCoverage([...TOOLS, "extra_tool"]), []);
});
