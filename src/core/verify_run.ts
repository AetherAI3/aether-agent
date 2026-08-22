// verify_run.ts — the writer for verification_record.ts.
//
// A stored verification is only worth reading if something stores one, and the
// class of defect this repository keeps finding is the field that exists with
// nothing writing it. This is that writer, and it is the ONLY one: the rail
// reads a verification through classifyVerification and writes one through
// here, so there is a single place where "verified" can be created and a single
// set of conditions under which it can be.
//
// The condition that matters is attribution. A test run takes time, and a
// working tree can move while it runs — the agent writes another file, the user
// saves in their editor. The result is then true of a tree that no longer
// exists, and nobody can say which one it was true of. So the tree is
// identified before AND after the run, and a run whose tree moved underneath it
// is reported as unattributable rather than recorded. It is the same rule
// classifyVerification enforces on read, applied at the moment of writing so a
// misleading record is never created in the first place.
//
// The command itself is executed by the caller's VerifyRunner — the same
// interface verify_gate.ts uses, and the same ToolExecutor in production. No
// command string is assembled or interpreted here.

import { parseFailCount, type VerifyRunner } from "./verify_gate.js";
import {
  VERIFICATION_RECORD_VERSION,
  classifyVerification,
  treeIdentity,
  writeVerification,
  type VerificationReading,
  type VerificationRecord,
} from "./verification_record.js";
import type { Runner } from "./worktree.js";

export interface VerifyRunResult {
  reading: VerificationReading;
  /** The record that was written, or null when none was. */
  written: VerificationRecord | null;
  /** The raw output of the run, for the caller to render or discard. */
  output: string;
  exitCode: number;
}

export interface VerifyRunOptions {
  now?: string;
}

/**
 * Run the verification command and record what it proved, about which tree.
 *
 * Returns the reading the rail should display. Three outcomes, and none of them
 * is a guess:
 *
 *  - the tree held still and the command exited 0 → "verified", recorded;
 *  - the tree held still and it did not          → "failed", recorded;
 *  - the tree moved while it ran                 → "unknown", NOT recorded,
 *    with a reason saying the run cannot be attributed to any tree.
 */
export async function verifyAndRecord(
  exec: VerifyRunner,
  run: Runner,
  root: string,
  command: string,
  options: VerifyRunOptions = {},
): Promise<VerifyRunResult> {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      reading: { status: "unknown", reason: "no verification command is configured", record: null },
      written: null,
      output: "",
      exitCode: -1,
    };
  }

  const before = treeIdentity(run, root);
  const result = await exec.executeAsync("run_tests", { command: trimmed });
  const after = treeIdentity(run, root);

  if (before.digest !== after.digest || before.head !== after.head) {
    return {
      reading: {
        status: "unknown",
        reason: `the working tree changed while ${trimmed} was running — the result describes no tree that exists`,
        record: null,
      },
      written: null,
      output: result.output,
      exitCode: result.exitCode,
    };
  }

  const record: VerificationRecord = {
    version: VERIFICATION_RECORD_VERSION,
    command: trimmed,
    exitCode: result.exitCode,
    ranAt: options.now ?? new Date().toISOString(),
    head: after.head,
    treeDigest: after.digest,
    remaining: parseFailCount(result.output),
  };
  writeVerification(root, record);

  // Classified through the same function a later read would use, so the status
  // shown now and the status shown in ten minutes come from one implementation.
  return { reading: classifyVerification(record, after), written: record, output: result.output, exitCode: result.exitCode };
}
