// `aether sessions` — the project/session library.
//
//   aether sessions                 list this workspace's sessions
//   aether sessions --all           every workspace on this machine
//   aether sessions inspect <id>    one session in full
//   aether sessions continue <id>   the Project Continuity header + how to go on
//   aether sessions export <id>     write the portable handoff
//   aether sessions archive <id>    hide it from the default list (nothing deleted)
//   aether sessions clean           drop index rows whose session is gone
//
// Everything here reads the index (core/session_index.ts) and, for `inspect`,
// the one manifest it is showing. No command on this path parses events.jsonl:
// that file is the transcript, `aether resume` is what replays it, and a
// listing that opened it would grow with the size of the user's history.
//
// The destructive-sounding verbs are deliberately not destructive. `archive`
// sets a flag. `clean` removes INDEX ROWS for sessions that are already gone.
// Neither one deletes a session directory, a worktree, a branch, or a file the
// user wrote — losing work must never be a side effect of tidying a list.

import { join } from "node:path";
import type { AppContext } from "../core/context.js";
import { buildHandoff, readRepoIdentity, writeHandoff } from "../core/handoff.js";
import { logsRoot } from "../core/session_log.js";
import {
  archiveSession,
  entriesForWorkspace,
  findEntry,
  pruneMissingSessions,
  syncSessionIndex,
  type SessionIndexEntry,
} from "../core/session_index.js";
import { loadSession } from "../core/session_resume.js";
import { defaultRunner, type Runner } from "../core/worktree.js";
import { normalizeWorkspace, requireOpaqueId } from "../core/workspace_scope.js";
import {
  classifySession,
  continuityHeader,
  renderCount,
  renderSessionRowsPlain,
  renderSessionTable,
  stateHint,
  stateLabel,
  UNKNOWN,
  type ContinuityProbe,
  type SessionRow,
} from "../ui/continuity.js";
import { runSessionPicker } from "../ui/session_picker.js";
import { theme } from "../ui/theme.js";
import { sanitizeTerm } from "../ui/text.js";
import { existsSync } from "node:fs";

/** The CLI registry entry for this command.
 *
 *  Exported rather than registered here: `src/commands/cli_registry.ts` is not
 *  this module's to edit, so the integration step adds this one spec (and the
 *  `case "sessions"` in main.ts that calls {@link cmdSessions}) as the whole
 *  wiring. Keeping the spec next to the implementation is what stops the help
 *  text and the behaviour from drifting apart. */
export const SESSIONS_CLI_COMMAND = {
  name: "sessions",
  args: "[inspect|continue|export|archive|clean] [id]",
  summary: "browse, inspect and continue past project sessions",
  section: "Start",
} as const;

/**
 * The flags this command answers to, as DATA.
 *
 * The dispatch entry (cli_registry.ts) hands these over already parsed rather
 * than re-rendering them into an argv for this module to parse a second time.
 * A second parse is where a value can be promoted into a flag nobody typed, and
 * the registration seam exists partly to remove that shape.
 */
export interface SessionsFlags {
  /** `--all`: cross workspaces (global flag). */
  all?: boolean;
  /** `--undo`: reverse an archive. */
  undo?: boolean;
  /** `--no-select`: force the flat table on a TTY. */
  noSelect?: boolean;
  /** `--out <file>`: where `export` writes (global flag). */
  out?: string;
}

/** argv spelling -> field, so the two forms cannot drift apart. */
const FLAG_FIELD: Readonly<Record<string, keyof SessionsFlags>> = {
  "--all": "all",
  "--undo": "undo",
  "--no-select": "noSelect",
};

/** Injected so every command below is testable without a checkout or a clock. */
export interface SessionsDeps {
  root?: string;
  run?: Runner;
  out?: NodeJS.WritableStream;
  err?: NodeJS.WritableStream;
  /** Terminal width for the table; the pipe form ignores it. */
  width?: number;
  /** Whether to render the human table (default: stdout is a TTY). */
  tty?: boolean;
}

interface Resolved {
  root: string;
  run: Runner;
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;
  width: number;
  tty: boolean;
}

function resolve(deps: SessionsDeps): Resolved {
  return {
    root: deps.root ?? logsRoot(),
    run: deps.run ?? defaultRunner(),
    out: deps.out ?? process.stdout,
    err: deps.err ?? process.stderr,
    width: deps.width ?? (process.stdout.columns || 100),
    tty: deps.tty ?? Boolean(process.stdout.isTTY),
  };
}

/** Probe this machine once, for every row in one listing. The git calls are
 *  best-effort: a directory with no checkout yields nothing, never an error. */
function probeFor(cwd: string, run: Runner): Omit<ContinuityProbe, "sameWorkspace" | "workspaceExists"> {
  const identity = readRepoIdentity(cwd, run);
  return {
    cwd,
    ...(identity?.remote ? { currentRemote: identity.remote } : {}),
    ...(identity?.branch ? { currentBranch: identity.branch } : {}),
  };
}

function rowFor(
  entry: SessionIndexEntry,
  base: Omit<ContinuityProbe, "sameWorkspace" | "workspaceExists">,
): SessionRow {
  let sameWorkspace = false;
  try {
    sameWorkspace = normalizeWorkspace(entry.workspace) === normalizeWorkspace(base.cwd);
  } catch {
    sameWorkspace = false;
  }
  const probe: ContinuityProbe = {
    ...base,
    sameWorkspace,
    workspaceExists: sameWorkspace || existsSync(entry.workspace),
  };
  return { entry, state: classifySession(entry, probe) };
}

/** Report what the listing could not account for. Both facts are always SAID:
 *  a user whose history looked shorter for a moment deserves to know why, and a
 *  session directory that could not be read must not simply be missing from a
 *  list that otherwise looks complete. */
function reportRecovery(res: Resolved, read: ReturnType<typeof syncSessionIndex>): void {
  const { recovery, unreadable } = read;
  if (recovery) {
    res.err.write(
      theme.dim(
        `session index rebuilt from manifests (${recovery.detail})` +
          (recovery.preserved ? `; unreadable copy kept at ${recovery.preserved}` : "") +
          "\n",
      ),
    );
  }
  if (unreadable.length) {
    res.err.write(
      theme.dim(
        `${unreadable.length} session director${unreadable.length === 1 ? "y" : "ies"} ` +
          `could not be read and are missing from this list: ` +
          unreadable.slice(0, 5).join(", ") +
          (unreadable.length > 5 ? ", …" : "") +
          "\n",
      ),
    );
  }
}

/** `aether sessions [--all]`. */
export function cmdSessionsList(ctx: AppContext, all: boolean, deps: SessionsDeps = {}): number {
  const res = resolve(deps);
  const read = syncSessionIndex(res.root);
  reportRecovery(res, read);
  const { entries } = read;
  const scoped = all ? entries : entriesForWorkspace(entries, ctx.flags.cwd);
  const visible = scoped.filter((entry) => !entry.archived);
  const base = probeFor(ctx.flags.cwd, res.run);
  const rows = visible.map((entry) => rowFor(entry, base));

  if (ctx.flags.json) {
    res.out.write(JSON.stringify({ sessions: rows.map((r) => ({ ...r.entry, state: r.state })) }, null, 2) + "\n");
    return 0;
  }
  if (!rows.length) {
    res.out.write(
      (all
        ? "no sessions recorded yet"
        : "no sessions for this project yet (see every project with: aether sessions --all)") +
        '\n  start one with:  aether agent "<task>"\n',
    );
    return 0;
  }
  const lines = res.tty ? renderSessionTable(rows, res.width) : renderSessionRowsPlain(rows);
  for (const line of lines) res.out.write(line + "\n");
  const archived = scoped.length - visible.length;
  if (res.tty) {
    res.out.write(
      theme.dim(
        `\n${rows.length} session(s)` +
          (archived ? ` · ${archived} archived (--all shows every workspace)` : "") +
          "\n  inspect:  aether sessions inspect <id>\n  continue: aether sessions continue <id>\n",
      ),
    );
  }
  return 0;
}

/**
 * `aether sessions` on a terminal: pick one with the arrow keys.
 *
 * The picker is a convenience over the same rows the table renders, so it can
 * always decline: an empty library, a non-TTY stdin, or any failure inside it
 * returns null and falls back to the flat listing. That fallback is why this is
 * safe to make the default — the listing is never lost, only sometimes
 * replaced by something better.
 */
export async function cmdSessionsSelect(
  ctx: AppContext,
  all: boolean,
  deps: SessionsDeps = {},
): Promise<number> {
  const res = resolve(deps);
  const read = syncSessionIndex(res.root);
  reportRecovery(res, read);
  const scoped = all ? read.entries : entriesForWorkspace(read.entries, ctx.flags.cwd);
  const visible = scoped.filter((entry) => !entry.archived);
  if (!visible.length) return cmdSessionsList(ctx, all, deps);
  const base = probeFor(ctx.flags.cwd, res.run);
  const rows = visible.map((entry) => rowFor(entry, base));
  const chosen = await runSessionPicker(rows, {
    width: res.width,
    title: all ? "sessions · every project" : "sessions · this project",
  });
  // Cancelling is a real answer, not an error: the user looked and left.
  if (!chosen) return 0;
  return cmdSessionsInspect(ctx, chosen.entry.sessionId, deps);
}

function requireEntry(
  ctx: AppContext,
  res: Resolved,
  id: string,
): { entry: SessionIndexEntry; row: SessionRow } | null {
  const raw = sanitizeTerm(id).trim();
  if (!raw) {
    res.err.write("usage: aether sessions <inspect|continue|export|archive> <session-id>\n");
    return null;
  }
  try {
    requireOpaqueId(raw, "session id");
  } catch {
    res.err.write(`invalid session id: ${raw}\n`);
    return null;
  }
  const read = syncSessionIndex(res.root);
  reportRecovery(res, read);
  const entry = findEntry(read.entries, raw);
  if (!entry) {
    res.err.write(`no such session: ${raw}\n  list them with: aether sessions --all\n`);
    return null;
  }
  return { entry, row: rowFor(entry, probeFor(ctx.flags.cwd, res.run)) };
}

/** `aether sessions inspect <id>`. */
export function cmdSessionsInspect(ctx: AppContext, id: string, deps: SessionsDeps = {}): number {
  const res = resolve(deps);
  const found = requireEntry(ctx, res, id);
  if (!found) return 1;
  const { entry, row } = found;
  if (ctx.flags.json) {
    res.out.write(JSON.stringify({ ...entry, state: row.state }, null, 2) + "\n");
    return 0;
  }
  const line = (label: string, value: string): string => `  ${theme.dim(label.padEnd(10))}${value}\n`;
  res.out.write(theme.cyan(`▚ ${entry.sessionId}\n`));
  res.out.write(line("task", entry.task || UNKNOWN));
  res.out.write(line("started", entry.started || UNKNOWN));
  // "still running" would be a claim nobody can back. A manifest with no `ended`
  // is a manifest that was never closed, and a run that was killed leaves
  // exactly the same record as one that is still going.
  res.out.write(
    line("ended", entry.ended ?? "never — this run may still be live, or may have been interrupted"),
  );
  res.out.write(
    line(
      "status",
      (isUnclosed(entry) ? `${entry.finalStatus || "unknown"} (never verified — the run did not finish)` : entry.finalStatus || "unknown") +
        (entry.remaining ? ` · ${entry.remaining} test(s) failing` : ""),
    ),
  );
  res.out.write(line("brain", `${entry.brain}${entry.model ? ` · ${entry.model}` : ""}`));
  res.out.write(line("verify", entry.testCmd ?? UNKNOWN));
  res.out.write(line("workspace", entry.workspace));
  if (entry.worktree) res.out.write(line("worktree", entry.worktree));
  res.out.write(line("repo", entry.repoRemote ?? "(local)"));
  res.out.write(
    line("branch", `${entry.branch ?? UNKNOWN}${entry.headRev ? ` @ ${entry.headRev.slice(0, 12)}` : ""}`),
  );
  if (entry.baseRev) res.out.write(line("base", entry.baseRev.slice(0, 12)));
  res.out.write(line("written", `${renderCount(entry.filesTouched)} file(s) via write_file`));
  res.out.write(line("events", renderCount(entry.events)));
  res.out.write(line("tools", renderCount(entry.toolCalls)));
  if (entry.skills?.length) res.out.write(line("skills", entry.skills.join(", ")));
  if (entry.instructionsDigest) res.out.write(line("rules", entry.instructionsDigest));
  // Always printed, because silence here would read as "no pull request was
  // opened" — a different fact from "nothing in the record says either way".
  // No path in this build records a pull request against a session yet, so this
  // is unknown by construction rather than by accident.
  res.out.write(line("pr", entry.prUrl ?? `${UNKNOWN} — this build does not record pull requests`));
  res.out.write(line("where", `${stateLabel(row.state)} — ${stateHint(row.state)}`));
  res.out.write(
    theme.dim(`  logs      ${join(res.root, entry.sessionId)}\n`) +
      theme.dim("\n  replay:   ") +
      `aether resume ${entry.sessionId}\n` +
      theme.dim("  continue: ") +
      `aether sessions continue ${entry.sessionId}\n`,
  );
  return 0;
}

/** The exact command that continues a session. One definition, so the header,
 *  the listing footer and `inspect` cannot suggest three different things. */
export function continueCommand(entry: SessionIndexEntry): string {
  return `aether agent --resume ${entry.sessionId} "<what to do next>"`;
}

/** `aether sessions continue <id>` — show what is being continued and how.
 *
 *  It prints the Project Continuity header and the exact next command rather
 *  than starting the agent itself: starting a run is `aether agent`'s job, and
 *  a second entry point into it would be a second place for the resume rules to
 *  drift. States that cannot continue here are refused with the reason. */
export function cmdSessionsContinue(ctx: AppContext, id: string, deps: SessionsDeps = {}): number {
  const res = resolve(deps);
  const found = requireEntry(ctx, res, id);
  if (!found) return 1;
  const { entry, row } = found;
  for (const line of continuityHeader({ kind: "local", entry, state: row.state })) {
    res.out.write(line + "\n");
  }
  if (row.state === "missing-checkout" || row.state === "other-workspace") {
    res.err.write(
      `\ncannot continue from here — ${stateHint(row.state)}\n` +
        `  the session ran in: ${entry.workspace}\n` +
        (row.state === "other-workspace"
          ? `  continue it with:   aether --cwd ${entry.workspace} sessions continue ${entry.sessionId}\n`
          : `  moved the checkout? export it instead: aether sessions export ${entry.sessionId}\n`),
    );
    return 1;
  }
  if (row.state === "stale-branch") {
    res.out.write(
      theme.dim(
        `\nthis checkout is on another branch now — the session ran on ${entry.branch}\n` +
          `  switch first if that matters:  git switch ${entry.branch}\n`,
      ),
    );
  }
  res.out.write("\n" + theme.dim("continue with:  ") + continueCommand(entry) + "\n");
  return 0;
}

/** `aether sessions export <id> [--out <file>]` — the portable handoff, same
 *  document `aether resume export` writes. */
export function cmdSessionsExport(ctx: AppContext, id: string, out: string | undefined, deps: SessionsDeps = {}): number {
  const res = resolve(deps);
  const found = requireEntry(ctx, res, id);
  if (!found) return 1;
  const target = out?.trim() ? out.trim() : join(ctx.flags.cwd, "aether-handoff.json");
  let handoff;
  try {
    // The handoff carries the narration, so this is the one path that does read
    // the transcript — and it reads exactly one session's.
    const session = loadSession(found.entry.sessionId, res.root);
    handoff = buildHandoff(session, { repo: readRepoIdentity(ctx.flags.cwd, res.run) });
  } catch (err) {
    res.err.write(`✗ cannot read session ${found.entry.sessionId}: ${err instanceof Error ? err.message : err}\n`);
    return 1;
  }
  try {
    writeHandoff(target, handoff);
  } catch (err) {
    res.err.write(`✗ could not write ${target}: ${err instanceof Error ? err.message : err}\n`);
    return 1;
  }
  res.out.write(
    `${theme.cyan("⇄ handoff written")} ${theme.bold(target)}\n` +
      theme.dim(`  session ${handoff.sessionId} · ${handoff.finalStatus} · ${handoff.filesTouched.length} file(s)\n`) +
      theme.dim("  continue anywhere with:  ") +
      `aether agent --resume ${target} "<what to do next>"\n`,
  );
  return 0;
}

/** True when the record says this session never reached a terminal state.
 *
 *  It is NOT the same as "still running": nothing on this machine can tell a
 *  live run from one whose process was killed before it could close its
 *  manifest, and pretending otherwise (by matching a pid, say) would be a guess
 *  wearing a fact's clothes. So both cases carry the same honest label, and
 *  both are protected from the same operations. */
export function isUnclosed(entry: SessionIndexEntry): boolean {
  return entry.ended == null || entry.finalStatus === "running";
}

/** The sentence a destructive prompt has to include for an unclosed session. */
const UNCLOSED_WARNING =
  "never finished — it may still be running, or it may have been interrupted; nobody can tell from the record";

/** `aether sessions archive <id> [--undo]`. Confirmed, and reversible. */
export async function cmdSessionsArchive(
  ctx: AppContext,
  id: string,
  undo: boolean,
  deps: SessionsDeps = {},
): Promise<number> {
  const res = resolve(deps);
  const found = requireEntry(ctx, res, id);
  if (!found) return 1;
  const verb = undo ? "restore" : "archive";
  const caveat = !undo && isUnclosed(found.entry) ? ` — this session ${UNCLOSED_WARNING}` : "";
  if (caveat) res.out.write(theme.yellow(`⚠ ${found.entry.sessionId} ${UNCLOSED_WARNING}\n`));
  if (!(await ctx.confirm(`${verb} session ${found.entry.sessionId}${caveat}? [y/N] `))) {
    res.err.write("cancelled\n");
    return 1;
  }
  // The storage layer refuses to overwrite an index a newer Aether Agent
  // wrote, so this can legitimately not happen. Saying "archived" then would be
  // reporting a change that is not on disk.
  const result = archiveSession(found.entry.sessionId, res.root, !undo);
  if (result === "not-saved") {
    res.err.write(
      `✗ not ${undo ? "restored" : "archived"} — the session index was written by a newer Aether Agent\n` +
        "  upgrade with: npm i -g aether-agents\n",
    );
    return 1;
  }
  if (result === "not-found") {
    res.err.write(`✗ no such session in the index: ${found.entry.sessionId}\n`);
    return 1;
  }
  res.out.write(
    `${undo ? "restored" : "archived"} ${found.entry.sessionId}\n` +
      theme.dim("  the session log, worktree and branch are untouched\n"),
  );
  return 0;
}

/** `aether sessions clean` — drop index rows whose session directory is gone.
 *
 *  This is the ONLY mutation `clean` performs. It does not delete session
 *  directories, and it never touches a worktree, a branch, or a user file. */
export async function cmdSessionsClean(ctx: AppContext, deps: SessionsDeps = {}): Promise<number> {
  const res = resolve(deps);
  const read = syncSessionIndex(res.root);
  reportRecovery(res, read);
  const stale = read.entries.filter(
    (entry) => !existsSync(join(res.root, entry.sessionId, "manifest.json")),
  );
  if (!stale.length) {
    res.out.write("session index is already clean\n");
    return 0;
  }
  res.out.write(`${stale.length} index row(s) point at sessions that are no longer on disk:\n`);
  for (const entry of stale.slice(0, 20)) res.out.write(`  ${entry.sessionId}  ${entry.task}\n`);
  if (stale.length > 20) res.out.write(theme.dim(`  … and ${stale.length - 20} more\n`));
  if (!(await ctx.confirm(`remove ${stale.length} index row(s)? (no session data is deleted) [y/N] `))) {
    res.err.write("cancelled\n");
    return 1;
  }
  const prune = pruneMissingSessions(res.root);
  if (!prune.written) {
    res.err.write(
      "✗ nothing removed — the session index was written by a newer Aether Agent\n" +
        "  upgrade with: npm i -g aether-agents\n",
    );
    return 1;
  }
  res.out.write(`removed ${prune.removed.length} index row(s)\n`);
  return 0;
}

/** Argument parser + dispatcher for `aether sessions ...`.
 *
 *  Exported as the single entry point so wiring it up is one `case` in main.ts
 *  and nothing else. */
export async function cmdSessions(
  ctx: AppContext,
  argv: readonly string[],
  deps: SessionsDeps = {},
  parsed: SessionsFlags = {},
): Promise<number> {
  const args = argv.map((a) => String(a));
  // Typed flags win. The argv fallback exists for direct callers that never
  // went through the CLI parse at all (tests, and `aether resume list`), NOT as
  // a second parse of what the host already parsed: the dispatch entry hands
  // values over as data, so no token the user typed is ever re-interpreted.
  const flag = (name: string): boolean => {
    const key = FLAG_FIELD[name];
    if (key && parsed[key] !== undefined) return Boolean(parsed[key]);
    return args.includes(name);
  };
  const valueOf = (name: string): string | undefined => {
    if (name === "--out" && parsed.out !== undefined) return parsed.out;
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const positional = args.filter((a) => !a.startsWith("-"));
  const sub = positional[0] ?? "";
  const id = positional[1] ?? "";
  switch (sub) {
    case "":
    case "list":
      // A terminal gets to pick; a pipe gets the table. `--json` is a pipe by
      // intent even on a TTY, and `--no-select` is the escape hatch for anyone
      // who wants the flat listing in front of them.
      return resolve(deps).tty && !ctx.flags.json && !flag("--no-select")
        ? cmdSessionsSelect(ctx, flag("--all"), deps)
        : cmdSessionsList(ctx, flag("--all"), deps);
    case "inspect":
    case "show":
      return cmdSessionsInspect(ctx, id, deps);
    case "continue":
      return cmdSessionsContinue(ctx, id, deps);
    case "export":
      return cmdSessionsExport(ctx, id, valueOf("--out"), deps);
    case "archive":
      return cmdSessionsArchive(ctx, id, flag("--undo"), deps);
    case "clean":
      return cmdSessionsClean(ctx, deps);
    default: {
      const res = resolve(deps);
      res.err.write(
        `unknown: aether sessions ${sanitizeTerm(sub)}\n` +
          "  aether sessions [--all]\n" +
          "  aether sessions inspect <id>\n" +
          "  aether sessions continue <id>\n" +
          "  aether sessions export <id> [--out <file>]\n" +
          "  aether sessions archive <id> [--undo]\n" +
          "  aether sessions clean\n",
      );
      return 1;
    }
  }
}
