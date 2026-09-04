// Startup splash — the AETHER brand (cloud + gradient wordmark) above a compact
// system-status column, and, when the terminal is opened inside a project the
// agent has worked in before, a PROJECT CONTINUITY block above it.
//
// The continuity block is the visible half of what the session library knows:
// which project this is, which session was last here, how it ended, which brain
// ran it, how it is verified, and what is known about the budget. It is built
// from the session index (core/session_index.ts), so it costs one small file
// read rather than a walk of every session — the splash is on the cold-start
// path and #89 already had to take an unbounded `git status` off it. Nothing
// here runs git, and nothing here reads a transcript.
//
// The rule the block exists to keep: a fact nobody recorded is printed as
// "unknown". Never 0, never blank, never a plausible default. A branch the
// record does not name is not "main"; a budget nobody metered is not 0 UVT.

import { basename } from "node:path";
import { theme } from "./theme.js";
import { composeBrand } from "./logo.js";
import { sanitizeTerm } from "./text.js";
import { entriesForWorkspace, syncSessionIndex, type SessionIndexEntry } from "../core/session_index.js";
import { getRegistry } from "../core/context_registry.js";
import { detectTerminalCapabilities, type TerminalCapabilities } from "../core/terminal_capabilities.js";
import {
  DEFAULT_VOICE_SETTINGS,
  initialVoiceMachine,
  terminalVoiceState,
  type TerminalVoiceState,
  type VoiceSettings,
} from "../core/voice.js";
import { voicePromoLines } from "./voice_promo.js";

export interface SplashInfo {
  version: string;
  model: string; // current model id, or "auto"
  effort: string; // effort level
  /** Workspace to report project continuity for. Omitted means no continuity
   *  block — and no disk read at all, which is what keeps this renderer usable
   *  from a unit test and from any caller that has no project. */
  cwd?: string;
  /** Embedders inject proven host facts. Standalone callers omit this and the
   * detector deliberately reports no audio adapter. */
  terminalCapabilities?: TerminalCapabilities;
  voiceSettings?: VoiceSettings;
  voiceState?: TerminalVoiceState;
}

/** Rotating power-feature tips — one shows per launch. Exported for tests. */
export const TIPS: readonly string[] = [
  "Tab completes any slash command",
  "/steer redirects the agent mid-turn",
  "/queue lines up the next task while one runs",
  "Ctrl+→/← jumps words · Ctrl+L clears the screen",
  "↑ recalls history across sessions",
  "Ctrl+C once aborts the turn — twice quits",
];

/** The tip line for slot `i` (wraps). Deterministic — caller picks the slot. */
export function tipLine(i: number): string {
  const tip = TIPS[((i % TIPS.length) + TIPS.length) % TIPS.length]!;
  return theme.dim(`tip: ${tip}`);
}

/** Plain status lines (no art) — exposed for testing the content. Every
 * slash token shown here must exist in the command registry (pinned by
 * test/ui.test.ts): the splash advertises only commands that actually run.
 * /effort earned its place back once it became a real command (the effort
 * dial) — see the slash registry. */
export function statusLines(info: SplashInfo, tipSlot?: number): string[] {
  return [
    theme.dim(`v${info.version}`),
    `[ ${theme.cyan("/model")} ${info.model} ]  [ ${theme.cyan("/effort")} ${info.effort} ]`,
    theme.dim("/help for commands · /doctor if something's off"),
    tipLine(tipSlot ?? Math.floor(Math.random() * TIPS.length)),
  ];
}

// ── project continuity ──────────────────────────────────────────────────────

/** The one spelling of "nobody recorded this". Shared with ui/continuity.ts by
 *  value rather than by import so the splash has no reason to reach into the
 *  library's renderer. */
const UNKNOWN = "unknown";

const LABEL_WIDTH = 12;

function row(label: string, value: string): string {
  return theme.dim(label.padEnd(LABEL_WIDTH)) + value;
}

/** One untrusted cell. A task, a branch name and a remote all originate outside
 *  this process and all reach a terminal, so all three are sanitized. */
function cell(value: string | undefined | null): string {
  return sanitizeTerm(value ?? "").replace(/\s+/g, " ").trim();
}

/** Shorten a remote URL to `owner/name`. Cosmetic only, and deliberately
 *  narrow: a value that is not an https or scp-style git URL — a local path, a
 *  name this function does not recognise — is returned whole rather than being
 *  trimmed into something that reads like a repository it is not. */
export function shortRemote(remote: string): string {
  const trimmed = remote.replace(/\/+$/, "");
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const isScp = /^[^/\\:]+@[^/\\:]+:/.test(trimmed);
  if (!isUrl && !isScp) return trimmed;
  const match = /([^/:]+\/[^/]+?)(?:\.git)?$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/** The exact usage facts {@link budgetLine} needs — the shape
 *  `ContextRegistry.checkUvtCap()` already returns. */
export interface UsageFacts {
  status: "unknown" | "observed" | "local-unmetered";
  /** Authoritative spend, or null when the server has reported none. */
  observed: number | null;
  cap: number | null;
}

const uvt = (n: number): string => n.toLocaleString("en-US");

/**
 * Render the budget.
 *
 * `ContextRegistry.uvtSpent` is a back-compat getter that turns "unknown" into
 * 0 for the HUD. That lie stops here: this reads `observed`/`status` and prints
 * "unknown" when nothing authoritative has been seen, because a user who has
 * spent an unmeasured amount has not spent nothing. Metering is lane
 * AA-USAGE-06's to change; this only reports what it already says.
 */
export function budgetLine(usage: UsageFacts): string {
  if (usage.status === "local-unmetered") return "not metered (local brain)";
  const cap = usage.cap == null ? "no cap set" : `${uvt(usage.cap)} UVT cap`;
  if (usage.status !== "observed" || usage.observed == null) return `${UNKNOWN} spent · ${cap}`;
  if (usage.cap == null) return `${uvt(usage.observed)} UVT spent · no cap set`;
  return `${uvt(usage.observed)} / ${uvt(usage.cap)} UVT`;
}

/** Facts the continuity block renders. Passed in rather than probed so every
 *  state below — including "no session here yet" — is testable without a disk. */
export interface ContinuityFacts {
  /** Directory this terminal was opened in. */
  cwd: string;
  /** The newest non-archived session recorded for `cwd`, when there is one. */
  entry?: SessionIndexEntry | undefined;
  usage: UsageFacts;
}

/**
 * The PROJECT CONTINUITY column.
 *
 * Every line is either a recorded fact or the word "unknown". The three states
 * a reader must be able to tell apart are kept apart:
 *
 *   finished        `status` names the verify gate's verdict ("ok" only when
 *                   the host's own tests were green).
 *   never finished  `status` says so, and does not claim the run is live —
 *                   nothing on this machine can tell a running session from an
 *                   interrupted one, and guessing is worse than saying so.
 *   never recorded  "unknown".
 */
export function continuityLines(facts: ContinuityFacts): string[] {
  const project = basename(facts.cwd.replace(/[\\/]+$/, "")) || facts.cwd;
  const lines = [theme.cyan("PROJECT CONTINUITY"), row("Project", cell(project) || UNKNOWN)];
  const entry = facts.entry;
  if (!entry) {
    lines.push(row("Session", `none recorded here yet`));
    lines.push(row("Budget", budgetLine(facts.usage)));
    lines.push(theme.dim(`  start one with:  aether agent "<task>"`));
    return lines;
  }
  lines.push(row("Repository", entry.repoRemote ? shortRemote(cell(entry.repoRemote)) : UNKNOWN));
  lines.push(
    row(
      "Branch",
      (cell(entry.branch) || UNKNOWN) + (entry.headRev ? theme.dim(` @ ${cell(entry.headRev).slice(0, 8)}`) : ""),
    ),
  );
  const status = cell(entry.finalStatus) || UNKNOWN;
  lines.push(
    row(
      "Session",
      cell(entry.sessionId) +
        theme.dim(" · ") +
        (entry.ended == null || status === "running"
          ? theme.yellow("never finished (running or interrupted — unknown which)")
          : status) +
        (entry.remaining ? theme.dim(` · ${entry.remaining} test(s) failing`) : ""),
    ),
  );
  lines.push(row("Brain", `${entry.brain}${entry.model ? ` · ${cell(entry.model)}` : theme.dim(" · account default")}`));
  if (entry.instructionsDigest) lines.push(row("Rules", cell(entry.instructionsDigest)));
  if (entry.skills?.length) lines.push(row("Skills", entry.skills.map((s) => cell(s)).join(" · ")));
  lines.push(row("Verify", entry.testCmd ? cell(entry.testCmd) : `${UNKNOWN} — no verify command recorded`));
  lines.push(row("Budget", budgetLine(facts.usage)));
  lines.push(theme.dim(`  continue:  aether sessions continue ${cell(entry.sessionId)}`));
  return lines;
}

/**
 * Gather the continuity facts for `cwd`.
 *
 * Best-effort in the strongest sense: a locked, unreadable or absent index
 * yields no block at all rather than a wrong one, and never a thrown error on
 * the cold-start path.
 */
export function readContinuity(cwd: string): ContinuityFacts | null {
  try {
    const entries = entriesForWorkspace(syncSessionIndex().entries, cwd).filter((e) => !e.archived);
    const usage = getRegistry().checkUvtCap();
    return { cwd, entry: entries[0], usage: { status: usage.status, observed: usage.observed, cap: usage.cap } };
  } catch {
    return null;
  }
}

/** The full splash: the brand banner, the project continuity block when there
 *  is a project to report on, then the status column. */
export function renderSplash(info: SplashInfo, tipSlot?: number): string {
  const facts = info.cwd ? readContinuity(info.cwd) : null;
  const continuity = facts ? [...continuityLines(facts), ""] : [];
  const capabilities = info.terminalCapabilities ?? detectTerminalCapabilities();
  const voiceSettings = info.voiceSettings ?? { ...DEFAULT_VOICE_SETTINGS };
  const voiceState = info.voiceState ?? terminalVoiceState(initialVoiceMachine, voiceSettings, capabilities);
  const voice = voicePromoLines({ capabilities, settings: voiceSettings, state: voiceState });
  return [...composeBrand(), "", ...voice, "", ...continuity, ...statusLines(info, tipSlot)].join("\n");
}
