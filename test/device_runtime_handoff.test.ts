import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REMAINING_SUMMARY,
  toWorkspaceHandoffV1,
  workspaceHandoffRejectReason,
  type WorkspaceHandoffInput,
} from "../src/core/device_runtime/handoff_adapter.js";
import { WORKSPACE_HANDOFF_SCHEMA } from "../src/core/device_runtime/contract.js";

function input(overrides: Partial<WorkspaceHandoffInput> = {}): WorkspaceHandoffInput {
  return {
    handoff_id: "ho-1",
    task_id: "task-1",
    lane_id: "lane-1",
    dag_node_id: "node-1",
    fence_token: "fence-1",
    lease_epoch: 2,
    repo: { name: "aether-agent", revision: "abc123" },
    patch_refs: [{ ref: "refs/aether/patch-1", sha256: "c".repeat(64), bytes: 42 }],
    change_digest: "sha256:" + "d".repeat(64),
    test_cmd: "npm test",
    test_verified: true,
    remaining_summary: "Finish wiring the publisher and add tests.",
    policy_digest: "sha256:" + "e".repeat(64),
    skill_digest: null,
    protocol_c_refs: ["proof-1"],
    source_device_id: "dev-1",
    created_at: 1000,
    ...overrides,
  };
}

test("a clean handoff is accepted and carries the frozen schema", () => {
  const h = toWorkspaceHandoffV1(input());
  assert.equal(h.schema, WORKSPACE_HANDOFF_SCHEMA);
  assert.equal(h.task_id, "task-1");
  assert.equal(workspaceHandoffRejectReason(h), null);
});

test("an absolute path anywhere is rejected", () => {
  const win = input({ remaining_summary: "see C:\\Users\\me\\secret.txt" });
  assert.throws(() => toWorkspaceHandoffV1(win), /absolute path/);
  const posix = input({ remaining_summary: "edit /etc/passwd next" });
  assert.throws(() => toWorkspaceHandoffV1(posix), /absolute path/);
});

test("an environment-variable reference is rejected", () => {
  assert.throws(() => toWorkspaceHandoffV1(input({ remaining_summary: "use $HOME/config" })), /environment-variable/);
  assert.throws(() => toWorkspaceHandoffV1(input({ remaining_summary: "read %USERPROFILE% dir" })), /environment-variable/);
});

test("credential-shaped content is rejected", () => {
  const jwt = "eyJhbGciOi.eyJzdWIiOi.SflKxwRJ";
  assert.throws(() => toWorkspaceHandoffV1(input({ remaining_summary: `token ${jwt}` })), /credential/);
});

test("an oversized remaining_summary is rejected", () => {
  const big = "x".repeat(MAX_REMAINING_SUMMARY + 1);
  assert.throws(() => toWorkspaceHandoffV1(input({ remaining_summary: big })), /exceeds its bound/);
});

test("a bad patch-ref digest is rejected", () => {
  assert.throws(
    () => toWorkspaceHandoffV1(input({ patch_refs: [{ ref: "r", sha256: "nothex", bytes: 1 }] })),
    /not a digest/,
  );
});
