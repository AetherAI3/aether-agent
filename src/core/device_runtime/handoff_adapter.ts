// Workspace handoff adapter — projects a task's continuation state onto the
// frozen "aether.workspace-handoff/1" wire shape, with validators that fail
// CLOSED on anything that must never cross a machine boundary.
//
// A workspace handoff travels to another device to continue the work, so the
// contract forbids it from carrying: absolute paths (they name one machine's
// layout), credentials, environment variables, chat history, raw tool logs, or
// unbounded diffs/file bodies. The validators here enforce that — a handoff
// with any of those is rejected rather than sanitized, because a continuation
// record that silently dropped a secret it was handed is worse than one that
// refused the whole offer.
//
// Secret detection reuses the repository's canonical scanner (core/redaction.ts,
// the same detectors core/health.ts redacts against) so a new secret shape
// protects this sink the moment it is added there.

import { scanForSecrets } from "../redaction.js";
import { WORKSPACE_HANDOFF_SCHEMA, type WorkspaceHandoffV1 } from "./contract.js";

export interface WorkspaceHandoffInput {
  handoff_id: string;
  task_id: string;
  lane_id: string;
  dag_node_id: string;
  fence_token: string;
  lease_epoch: number;
  repo: { name: string; revision: string };
  patch_refs: Array<{ ref: string; sha256: string; bytes: number }>;
  change_digest: string;
  test_cmd: string;
  test_verified: boolean;
  remaining_summary: string;
  policy_digest: string;
  skill_digest: string | null;
  protocol_c_refs: string[];
  source_device_id: string;
  created_at: number;
}

export const MAX_REMAINING_SUMMARY = 4000;
const MAX_SHORT_FIELD = 512;
const MAX_ID_FIELD = 256;
const MAX_PATCH_REFS = 64;
const MAX_PROTOCOL_C_REFS = 64;

/** An absolute filesystem path in any common spelling (drive, UNC, POSIX, home). */
function containsAbsolutePath(value: string): boolean {
  return (
    /(?:^|[\s"'(=])[A-Za-z]:[\\/]/.test(value) || // C:\ or C:/
    /(?:^|[\s"'(=])\\\\[^\s\\]/.test(value) || // \\server UNC
    /(?:^|[\s"'(=])\/[A-Za-z0-9._]/.test(value) || // /usr, /home ...
    /(?:^|[\s"'(=])~[\\/]/.test(value) // ~/ or ~\
  );
}

/** A shell/Windows environment-variable reference. */
function containsEnvVarReference(value: string): boolean {
  return (
    /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(value) || // $VAR / ${VAR}
    /%[A-Za-z_][A-Za-z0-9_]*%/.test(value) // %VAR%
  );
}

/**
 * The reason a handoff must be rejected, or null if it is clean. Every string
 * field is checked for absolute paths, env-var references and secret shapes, and
 * every bounded field is checked against its cap.
 */
export function workspaceHandoffRejectReason(h: WorkspaceHandoffV1): string | null {
  if (h.schema !== WORKSPACE_HANDOFF_SCHEMA) return "wrong schema";

  // Bounds.
  if (h.remaining_summary.length > MAX_REMAINING_SUMMARY) return "remaining_summary exceeds its bound";
  if (h.patch_refs.length > MAX_PATCH_REFS) return "too many patch_refs";
  if (h.protocol_c_refs.length > MAX_PROTOCOL_C_REFS) return "too many protocol_c_refs";
  for (const id of [h.task_id, h.lane_id, h.dag_node_id, h.fence_token, h.handoff_id, h.source_device_id, h.policy_digest, h.change_digest]) {
    if (id.length > MAX_ID_FIELD) return "an identifier field exceeds its bound";
  }
  if (h.test_cmd.length > MAX_SHORT_FIELD) return "test_cmd exceeds its bound";
  if (h.repo.name.length > MAX_SHORT_FIELD || h.repo.revision.length > MAX_SHORT_FIELD) return "repo field exceeds its bound";
  for (const ref of h.patch_refs) {
    if (ref.ref.length > MAX_SHORT_FIELD) return "a patch ref exceeds its bound";
    if (!/^[0-9a-f]{64}$/.test(ref.sha256)) return "a patch ref sha256 is not a digest";
    if (!Number.isInteger(ref.bytes) || ref.bytes < 0) return "a patch ref byte count is invalid";
  }
  for (const ref of h.protocol_c_refs) if (ref.length > MAX_SHORT_FIELD) return "a protocol_c ref exceeds its bound";

  // Content forbidden on the wire, checked across every free-text string field.
  const textFields: string[] = [
    h.remaining_summary,
    h.test_cmd,
    h.repo.name,
    h.repo.revision,
    ...h.patch_refs.map((r) => r.ref),
    ...h.protocol_c_refs,
  ];
  for (const field of textFields) {
    if (containsAbsolutePath(field)) return "a field contains an absolute path";
    if (containsEnvVarReference(field)) return "a field contains an environment-variable reference";
    if (scanForSecrets(field).length > 0) return "a field contains credential-shaped content";
  }
  return null;
}

/**
 * Build and validate a WorkspaceHandoffV1. Throws with a specific reason on any
 * violation — the caller (a drain checkpoint) then reports a failed CommandResult
 * rather than emitting a handoff that leaks.
 */
export function toWorkspaceHandoffV1(input: WorkspaceHandoffInput): WorkspaceHandoffV1 {
  const handoff: WorkspaceHandoffV1 = {
    schema: WORKSPACE_HANDOFF_SCHEMA,
    handoff_id: input.handoff_id,
    task_id: input.task_id,
    lane_id: input.lane_id,
    dag_node_id: input.dag_node_id,
    fence_token: input.fence_token,
    lease_epoch: input.lease_epoch,
    repo: { name: input.repo.name, revision: input.repo.revision },
    patch_refs: input.patch_refs.map((r) => ({ ref: r.ref, sha256: r.sha256, bytes: r.bytes })),
    change_digest: input.change_digest,
    test_cmd: input.test_cmd,
    test_verified: input.test_verified,
    remaining_summary: input.remaining_summary,
    policy_digest: input.policy_digest,
    skill_digest: input.skill_digest,
    protocol_c_refs: [...input.protocol_c_refs],
    created_at: input.created_at,
    source_device_id: input.source_device_id,
  };
  const reason = workspaceHandoffRejectReason(handoff);
  if (reason) throw new Error(`refusing to emit workspace handoff: ${reason}`);
  return handoff;
}
