// src/core/handoff.ts — the portable continuation record.
//
// A session log (session_log.ts) is the human's record of one run: append-only
// JSONL plus a rendered monologue, keyed to one absolute working directory on
// one machine. `aether resume` could already REPLAY it to the screen, but the
// brain never saw a byte of it — resuming meant re-typing the story so far.
//
// A handoff is the machine-facing half of that record: a small, self-contained
// JSON document distilled from a session (what the task was, which model ran
// it, what it touched, whether the tests were green, what is still failing)
// plus the repository identity it belongs to. Two things follow:
//
//   1. `aether agent --resume <id> "<next task>"` prepends the CONTINUATION
//      BRIEF built from it, so a different model picks the thread up with the
//      project context already in hand.
//   2. `aether resume export` writes it to a file. Copy that file anywhere —
//      another checkout, another machine, another OS — and
//      `aether agent --resume <file>` continues there. Nothing in it is keyed
//      to an absolute path, so the receiving side needs no matching layout.
//
// Deliberately NOT a transcript: full chat history is large, leaks file
// contents and shell commands, and is exactly what the session log already
// redacts. The brief is a summary a human could have written, which is what
// makes it safe to move between machines.

import { readFileSync, writeFileSync } from "node:fs";
import type { BrainEvent } from "./brain_protocol.js";
import { decodeEvent } from "./brain_protocol.js";
import { loadSession, type LoadedSession } from "./session_resume.js";
import { logsRoot } from "./session_log.js";
import type { RunResult, Runner } from "./worktree.js";

export const HANDOFF_SCHEMA_VERSION = 1;
export const HANDOFF_KIND = "aether-agent-handoff";

/** Where the work lives, expressed so it survives the trip to another machine. */
export interface HandoffRepo {
  /** `git remote get-url origin`, when there is one. */
  remote?: string;
  /** Branch the prior run ended on. */
  branch?: string;
  /** HEAD sha at export time — lets the receiving side spot a diverged tree. */
  head?: string;
}

export interface Handoff {
  schemaVersion: number;
  kind: typeof HANDOFF_KIND;
  sessionId: string;
  /** The task the prior run was given. */
  task: string;
  /** Model id the prior run used ("" when it ran on the account default). */
  model: string;
  brain: "local" | "cloud";
  started: string;
  ended: string | null;
  /** The prior run's verify-gate verdict — "ok" only if its tests were green. */
  finalStatus: string;
  /** Failing tests the prior run left behind, when it left any. */
  remaining?: number;
  repo?: HandoffRepo;
  /** Compacted narration of what the prior run actually did. */
  highlights: string[];
  /** Files the prior run wrote. */
  filesTouched: string[];
  /** The command the verify gate ran, when the prior run named one. */
  testCmd?: string;
}

/** Highlights are a summary, not a transcript — these bounds keep it one. */
const MAX_HIGHLIGHTS = 40;
const MAX_HIGHLIGHT_CHARS = 300;
const MAX_FILES = 60;

function clip(text: string, max = MAX_HIGHLIGHT_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

/** The narration worth carrying forward: stages entered, what the model said it
 *  was doing, checkpoints, and the terminal result. Tool spam is dropped — the
 *  next model will re-read the files itself, and it is the DECISIONS that do not
 *  survive a fresh context. */
export function summarizeEvents(events: Array<Record<string, unknown>>): {
  highlights: string[];
  filesTouched: string[];
} {
  const highlights: string[] = [];
  const files: string[] = [];
  for (const raw of events) {
    const ev: BrainEvent | null = decodeEvent(raw);
    if (!ev) continue;
    if (ev.type === "tool_call") {
      const path = ev.args["path"];
      if (ev.name === "write_file" && typeof path === "string") {
        if (!files.includes(path) && files.length < MAX_FILES) files.push(path);
      }
      continue;
    }
    if (ev.type === "stage") highlights.push(`stage: ${clip(ev.name)}`);
    else if (ev.type === "monologue" && ev.text.trim()) highlights.push(clip(ev.text));
    else if (ev.type === "checkpoint") highlights.push(`checkpoint ${clip(ev.gitSha, 40)}`);
    else if (ev.type === "done") {
      // The final answer usually arrives twice — once as the closing monologue,
      // once inside `done`. Say it once.
      const said = `${ev.ok ? "finished" : "stopped"}: ${clip(ev.result)}`;
      if (highlights[highlights.length - 1] !== clip(ev.result)) highlights.push(said);
    }
    else if (ev.type === "error") highlights.push(`error: ${clip(ev.msg)}`);
  }
  // Keep the tail: the END of a run is what the next one has to build on.
  return { highlights: highlights.slice(-MAX_HIGHLIGHTS), filesTouched: files };
}

/** Read the repository identity of `cwd`. Every probe is best-effort — a plain
 *  directory with no git in it yields an empty record, never an error. */
export function readRepoIdentity(cwd: string, run: Runner): HandoffRepo | undefined {
  const value = (args: string[]): string | undefined => {
    let r: RunResult;
    try {
      r = run("git", args, cwd);
    } catch {
      return undefined;
    }
    const out = r.stdout.trim();
    return r.status === 0 && out ? out : undefined;
  };
  const remote = value(["remote", "get-url", "origin"]);
  const branch = value(["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = value(["rev-parse", "HEAD"]);
  if (!remote && !branch && !head) return undefined;
  return { ...(remote && { remote }), ...(branch && { branch }), ...(head && { head }) };
}

export interface BuildHandoffOptions {
  repo?: HandoffRepo | undefined;
  testCmd?: string | undefined;
}

/** Distil one loaded session into a handoff. Pure — the caller supplies the
 *  repo identity so this stays testable without a git checkout. */
export function buildHandoff(session: LoadedSession, opts: BuildHandoffOptions = {}): Handoff {
  const m = session.manifest;
  const { highlights, filesTouched } = summarizeEvents(session.events);
  const remaining = m.remaining;
  const testCmd = opts.testCmd ?? m.testCmd;
  return {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    kind: HANDOFF_KIND,
    sessionId: m.sessionId,
    task: m.task,
    model: m.model ?? "",
    brain: m.brain,
    started: m.started,
    ended: m.ended ?? null,
    finalStatus: m.finalStatus ?? "running",
    ...(typeof remaining === "number" && remaining > 0 ? { remaining } : {}),
    ...(opts.repo ? { repo: opts.repo } : {}),
    highlights,
    filesTouched,
    ...(testCmd ? { testCmd } : {}),
  };
}

/** Validate an untrusted handoff document. Handoffs travel between machines, so
 *  a file that is merely JSON is not enough — every field the brief renders is
 *  checked, and anything unrecognized is rejected rather than half-used. */
export function parseHandoff(value: unknown): Handoff {
  const body = value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
  if (!body) throw new Error("handoff file is not a JSON object");
  if (body["kind"] !== HANDOFF_KIND) throw new Error("not an Aether Agent handoff file");
  const version = body["schemaVersion"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("handoff file has no usable schemaVersion");
  }
  if (version > HANDOFF_SCHEMA_VERSION) {
    throw new Error(
      `handoff was written by a newer Aether Agent (schema ${version}); upgrade with: npm i -g aether-agents`,
    );
  }
  const str = (key: string): string => (typeof body[key] === "string" ? (body[key] as string) : "");
  const strings = (key: string): string[] =>
    Array.isArray(body[key]) ? (body[key] as unknown[]).filter((v): v is string => typeof v === "string") : [];
  const brain = body["brain"] === "cloud" ? "cloud" : "local";
  const sessionId = str("sessionId");
  const task = str("task");
  if (!sessionId || !task) throw new Error("handoff file is missing its session id or task");
  const repoRaw = body["repo"];
  const repo = repoRaw != null && typeof repoRaw === "object" && !Array.isArray(repoRaw)
    ? (repoRaw as Record<string, unknown>)
    : undefined;
  const repoStr = (key: string): string | undefined =>
    repo && typeof repo[key] === "string" && repo[key] ? (repo[key] as string) : undefined;
  const remoteId = repoStr("remote");
  const branchId = repoStr("branch");
  const headId = repoStr("head");
  const remaining = body["remaining"];
  const ended = body["ended"];
  const testCmd = str("testCmd");
  return {
    schemaVersion: version,
    kind: HANDOFF_KIND,
    sessionId,
    task,
    model: str("model"),
    brain,
    started: str("started"),
    ended: typeof ended === "string" ? ended : null,
    finalStatus: str("finalStatus") || "unknown",
    ...(typeof remaining === "number" && remaining > 0 ? { remaining } : {}),
    ...(remoteId || branchId || headId
      ? { repo: { ...(remoteId && { remote: remoteId }), ...(branchId && { branch: branchId }), ...(headId && { head: headId }) } }
      : {}),
    highlights: strings("highlights").map((h) => clip(h)).slice(-MAX_HIGHLIGHTS),
    filesTouched: strings("filesTouched").slice(0, MAX_FILES),
    ...(testCmd ? { testCmd } : {}),
  };
}

export function writeHandoff(path: string, handoff: Handoff): void {
  writeFileSync(path, JSON.stringify(handoff, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

export function readHandoff(path: string): Handoff {
  return parseHandoff(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Render the brief the NEXT brain reads before its own task.
 *
 * Written as plain prose on purpose: it is prepended to the task text, so it
 * has to be legible to every brain on every path — a hosted frontier model, a
 * 4B local model, and the human reading the log a week later — without any of
 * them having to parse a format.
 */
export function continuationBrief(h: Handoff): string {
  const lines: string[] = [];
  lines.push("## Continuing a prior Aether Agent session");
  lines.push("");
  lines.push(`Prior session: ${h.sessionId}`);
  lines.push(`Ran on: ${h.model || "the account default model"} (${h.brain} brain)`);
  lines.push(`Original task: ${h.task}`);
  lines.push(
    `Where it left off: ${h.finalStatus}` +
      (h.remaining ? ` — ${h.remaining} test${h.remaining === 1 ? "" : "s"} still failing` : ""),
  );
  if (h.testCmd) lines.push(`Verification command: ${h.testCmd}`);
  if (h.repo?.remote || h.repo?.branch) {
    lines.push(`Repository: ${h.repo.remote ?? "(local)"}${h.repo.branch ? ` on ${h.repo.branch}` : ""}`);
  }
  if (h.filesTouched.length) {
    lines.push("");
    lines.push("Files the prior session changed:");
    for (const f of h.filesTouched) lines.push(`- ${f}`);
  }
  if (h.highlights.length) {
    lines.push("");
    lines.push("What it did, in order:");
    for (const line of h.highlights) lines.push(`- ${line}`);
  }
  lines.push("");
  lines.push(
    "You are continuing this work in the same repository. Read the files above " +
      "before changing them — the summary is what happened, not what the code " +
      "says now. Do not redo finished work.",
  );
  return lines.join("\n");
}

/** Compose the brief and the next instruction into the task the brain receives. */
export function continuationTask(h: Handoff, nextTask: string): string {
  const next = nextTask.trim() || h.task;
  return `${continuationBrief(h)}\n\n## Your task now\n\n${next}\n`;
}

/**
 * Resolve a `--resume` value into a handoff.
 *
 * Two shapes, distinguished without guessing: a session id is an opaque
 * directory name under the logs root (no separators, no extension), so anything
 * carrying a path separator or ending in .json is read as a handoff FILE — the
 * form that came from another machine. Everything else is a local session id
 * and is distilled on the spot.
 *
 * A file is never workspace-scoped: importing one is an explicit act by the
 * person holding it, and its whole purpose is to land in a checkout whose
 * absolute path does not match where the work started.
 */
export function resolveHandoff(
  value: string,
  cwd: string,
  load: (id: string, root: string, scope: string) => LoadedSession = defaultLoadSession,
  root?: string,
): Handoff {
  const ref = value.trim();
  if (!ref) throw new Error("--resume needs a session id or a handoff file");
  if (isHandoffPath(ref)) {
    try {
      return readHandoff(ref);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        throw new Error(`no handoff file at ${ref} — write one with: aether resume export --out ${ref}`);
      }
      const why = err instanceof Error ? err.message : String(err);
      throw new Error(`cannot read handoff ${ref}: ${why}`);
    }
  }
  return buildHandoff(load(ref, root ?? logsRoot(), cwd));
}

/** A --resume value that names a file on disk rather than a local session id. */
export function isHandoffPath(value: string): boolean {
  return /[\/]/.test(value) || value.toLowerCase().endsWith(".json");
}

const defaultLoadSession = (id: string, root: string, scope: string): LoadedSession =>
  loadSession(id, root, scope);
