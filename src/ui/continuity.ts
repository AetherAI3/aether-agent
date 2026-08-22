// src/ui/continuity.ts — how the session library looks.
//
// Two renderings of one list, on purpose:
//
//   TTY   a padded, coloured table a person scans, plus a Project Continuity
//         header when a session is re-entered.
//   pipe  tab-separated columns with a fixed field order and no colour, so
//         `aether sessions | awk` keeps working when the table is restyled.
//
// Nothing here reads the filesystem or the clock. The command layer probes and
// passes the facts in, which is what makes every state below testable without
// a checkout — and what keeps "we could not tell" from being rendered as a
// confident answer.

import type { SessionIndexEntry } from "../core/session_index.js";
import { theme } from "./theme.js";
import { sanitizeTerm, sliceVisible, visibleWidth } from "./text.js";

/**
 * What continuing this session would actually mean.
 *
 * These are distinct because the remedies are distinct, and collapsing any two
 * of them lies to the user: a moved checkout is continuable from here, a
 * missing one is not, and a stale branch is continuable but not where they
 * think.
 */
export type ContinuityState =
  | "ready" // this workspace, branch matches (or none was recorded)
  | "stale-branch" // this workspace, but HEAD moved off the session's branch
  | "moved-checkout" // same repository, different path on this machine
  | "other-workspace" // a different project entirely
  | "missing-checkout" // the recorded workspace is not on this disk
  | "archived"; // hidden from the default listing by the user

/** The facts the classifier needs. Every one is probed by the caller — this
 *  module never touches disk. `undefined` means "not known", which is treated
 *  as "do not claim", never as "no". */
export interface ContinuityProbe {
  /** Normalized workspace of the current process. */
  cwd: string;
  /** True when the session's recorded workspace exists on this disk. */
  workspaceExists: boolean;
  /** True when the session's workspace is the current one. */
  sameWorkspace: boolean;
  /** `git remote get-url origin` here, when there is a checkout. */
  currentRemote?: string | undefined;
  /** Current branch here, when there is a checkout. */
  currentBranch?: string | undefined;
}

/** Classify one row against the current machine. Order matters: the first rule
 *  that applies is the one the user must act on. */
export function classifySession(entry: SessionIndexEntry, probe: ContinuityProbe): ContinuityState {
  if (entry.archived) return "archived";
  if (probe.sameWorkspace) {
    // A branch is only "stale" when both sides are known. An unknown current
    // branch is not evidence that the branch changed.
    if (entry.branch && probe.currentBranch && entry.branch !== probe.currentBranch) return "stale-branch";
    return "ready";
  }
  if (!probe.workspaceExists) {
    // Same repository, different (existing) checkout is a MOVE, not a loss —
    // the work is reachable from here even though the path is gone.
    if (entry.repoRemote && probe.currentRemote && entry.repoRemote === probe.currentRemote) {
      return "moved-checkout";
    }
    return "missing-checkout";
  }
  if (entry.repoRemote && probe.currentRemote && entry.repoRemote === probe.currentRemote) {
    return "moved-checkout";
  }
  return "other-workspace";
}

/** One line of plain English per state — what it means and what to do. */
export function stateHint(state: ContinuityState): string {
  switch (state) {
    case "ready":
      return "continues here";
    case "stale-branch":
      return "this checkout has moved to another branch since the session ran";
    case "moved-checkout":
      return "same repository, different checkout on this machine";
    case "other-workspace":
      return "belongs to another project — run it from that directory";
    case "missing-checkout":
      return "the directory this ran in is not on this disk";
    case "archived":
      return "archived — still on disk, hidden from the default list";
  }
}

const STATE_LABEL: Record<ContinuityState, string> = {
  "ready": "ready",
  "stale-branch": "stale-branch",
  "moved-checkout": "moved",
  "other-workspace": "elsewhere",
  "missing-checkout": "missing",
  "archived": "archived",
};

export function stateLabel(state: ContinuityState): string {
  return STATE_LABEL[state];
}

/** The value shown for a field that was never recorded.
 *
 *  This constant exists so the rule has exactly one spelling: a count nobody
 *  measured renders as "unknown". It is never 0, never "-", never "none" —
 *  a session that wrote three files before crashing without a manifest close
 *  must not read as a session that wrote nothing. */
export const UNKNOWN = "unknown";

/** Render a count that may not have been recorded. */
export function renderCount(value: number | undefined): string {
  return typeof value === "number" ? String(value) : UNKNOWN;
}

/** Clean one untrusted cell: control characters and escape sequences from a
 *  task string or a branch name never reach the terminal. */
function cell(value: string | undefined): string {
  return sanitizeTerm(value ?? "").replace(/\s+/g, " ").trim();
}

/** Short, still-unique form of a session id for the narrow column. Ids begin
 *  with an ISO timestamp, so the head is the readable part. */
export function shortId(sessionId: string): string {
  return cell(sessionId).slice(0, 24);
}

export interface SessionRow {
  entry: SessionIndexEntry;
  state: ContinuityState;
}

/** The stable machine-readable form. Field order is part of the contract; add
 *  new fields at the END so an existing `cut -f3` keeps meaning what it did. */
export function renderSessionRowsPlain(rows: readonly SessionRow[]): string[] {
  const out = [
    ["SESSION", "STARTED", "STATUS", "STATE", "BRAIN", "MODEL", "FILES_WRITTEN", "BRANCH", "TASK"].join("\t"),
  ];
  for (const { entry, state } of rows) {
    out.push(
      [
        cell(entry.sessionId),
        cell(entry.started),
        cell(entry.finalStatus) || "unknown",
        stateLabel(state),
        entry.brain,
        cell(entry.model) || UNKNOWN,
        renderCount(entry.filesTouched),
        cell(entry.branch) || UNKNOWN,
        cell(entry.task),
      ].join("\t"),
    );
  }
  return out;
}

function pad(value: string, width: number): string {
  const clipped = visibleWidth(value) > width ? sliceVisible(value, width) : value;
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

const STATE_COLOR: Record<ContinuityState, (s: string) => string> = {
  "ready": (s) => theme.cyan(s),
  "stale-branch": (s) => theme.dim(s),
  "moved-checkout": (s) => theme.dim(s),
  "other-workspace": (s) => theme.dim(s),
  "missing-checkout": (s) => theme.dim(s),
  "archived": (s) => theme.dim(s),
};

/** The human table. `width` is the terminal width; the task column absorbs
 *  whatever is left so the fixed columns never wrap. */
export function renderSessionTable(rows: readonly SessionRow[], width = 100): string[] {
  if (!rows.length) return [];
  const idWidth = Math.max(7, ...rows.map((r) => visibleWidth(shortId(r.entry.sessionId))));
  const statusWidth = Math.max(6, ...rows.map((r) => visibleWidth(cell(r.entry.finalStatus) || "unknown")));
  const stateWidth = Math.max(5, ...rows.map((r) => visibleWidth(stateLabel(r.state))));
  const fixed = idWidth + statusWidth + stateWidth + 3;
  const taskWidth = Math.max(20, width - fixed - 3);
  const out = [
    theme.dim(
      [pad("SESSION", idWidth), pad("STATUS", statusWidth), pad("WHERE", stateWidth), "TASK"].join(" "),
    ),
  ];
  for (const { entry, state } of rows) {
    out.push(
      [
        pad(shortId(entry.sessionId), idWidth),
        pad(cell(entry.finalStatus) || "unknown", statusWidth),
        STATE_COLOR[state](pad(stateLabel(state), stateWidth)),
        pad(cell(entry.task), taskWidth),
      ].join(" "),
    );
  }
  return out;
}

/** How this session is being re-entered. Named separately from
 *  {@link ContinuityState} because it answers a different question: not "can
 *  this be continued" but "where did the continuation come from". */
export type ContinuationKind = "local" | "handoff";

export interface ContinuityHeaderInput {
  kind: ContinuationKind;
  entry: SessionIndexEntry;
  state: ContinuityState;
  /** Where a handoff was imported from, for the handoff kind. */
  source?: string | undefined;
}

/**
 * The Project Continuity header shown when a session is continued.
 *
 * It states the four things a person needs before typing the next task: which
 * session this is, what its verify gate actually said, where it lives now, and
 * how it got here. `finalStatus` is quoted from the record — this header never
 * upgrades an unverified run to a verified one.
 */
export function continuityHeader(input: ContinuityHeaderInput): string[] {
  const { entry, state, kind } = input;
  const lines = [
    theme.cyan("▚ Project Continuity"),
    `  session   ${theme.bold(cell(entry.sessionId))}`,
    `  task      ${cell(entry.task) || UNKNOWN}`,
    `  status    ${cell(entry.finalStatus) || "unknown"}` +
      (entry.remaining ? ` · ${entry.remaining} test(s) still failing` : ""),
    `  brain     ${entry.brain}${entry.model ? ` · ${cell(entry.model)}` : ""}`,
  ];
  if (entry.testCmd) lines.push(`  verify    ${cell(entry.testCmd)}`);
  if (entry.branch || entry.repoRemote) {
    lines.push(
      `  repo      ${cell(entry.repoRemote) || "(local)"}${entry.branch ? ` on ${cell(entry.branch)}` : ""}`,
    );
  }
  lines.push(`  written   ${renderCount(entry.filesTouched)} file(s) via write_file`);
  if (entry.prUrl) lines.push(`  pr        ${cell(entry.prUrl)}`);
  lines.push(
    theme.dim(
      `  ${kind === "handoff" ? `imported handoff${input.source ? ` from ${cell(input.source)}` : ""}` : "local session"} · ${stateHint(state)}`,
    ),
  );
  return lines;
}
