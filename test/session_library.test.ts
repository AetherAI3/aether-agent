// What the session library must cost, and what it must never claim.
//
// The cost tests do not count calls — they make the expensive files
// UNREADABLE and then require the answer to still be right. A manifest that has
// been replaced by a directory throws EISDIR the instant anything opens it, so
// "the listing does not read manifests" stops being a claim about the code and
// becomes a property of the run: if it opened one, the test throws. Same for
// events.jsonl, which is the file that actually grows without bound.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  entriesForWorkspace,
  indexPath,
  readSessionIndex,
  syncSessionIndex,
  upsertSessionIndex,
} from "../src/core/session_index.js";
import { latestSession } from "../src/core/session_resume.js";
import { SessionLog } from "../src/core/session_log.js";
import { cmdSessions, SESSIONS_CLI_COMMAND } from "../src/commands/sessions.js";
import { CLI_PARSE_OPTIONS, findDispatchedCliCommand } from "../src/commands/cli_registry.js";
import { budgetLine, continuityLines, shortRemote } from "../src/ui/splash.js";
import { stripAnsi } from "../src/ui/theme.js";
import type { SessionIndexEntry } from "../src/core/session_index.js";

/** A session directory that looks exactly like one SessionLog wrote. */
function seed(root: string, id: string, workspace: string, started: string): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      sessionId: id,
      task: `task for ${id}`,
      model: "qwen3:4b",
      brain: "local",
      cwd: workspace,
      started,
      ended: `${started.slice(0, -1)}1Z`,
      finalStatus: "ok",
      events: 400,
      toolCalls: 12,
      filesTouched: 3,
    }),
  );
  // 400 lines of transcript — the file whose size is the whole reason the
  // index exists.
  let jsonl = "";
  for (let i = 0; i < 400; i += 1) {
    jsonl += JSON.stringify({ ts: started, type: "monologue", text: "x".repeat(200), depth: 0 }) + "\n";
  }
  writeFileSync(join(dir, "events.jsonl"), jsonl);
}

/** Replace a session's files with directories of the same name. Everything
 *  that merely checks existence still sees them; everything that OPENS one
 *  fails loudly. */
function sabotage(root: string, id: string): void {
  for (const name of ["manifest.json", "events.jsonl"]) {
    const path = join(root, id, name);
    rmSync(path, { force: true });
    mkdirSync(path);
  }
}

function withRoot(body: (root: string, workspace: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "aether-library-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  try {
    body(root, workspace);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const N = 300;

test("listing N sessions opens no manifest and no transcript once the index is warm", () => {
  withRoot((root, workspace) => {
    for (let i = 0; i < N; i += 1) {
      seed(root, `s${String(i).padStart(4, "0")}`, workspace, `2026-08-19T10:00:${String(i % 60).padStart(2, "0")}.000Z`);
    }
    // One reconciliation pass pays for every session that predates the index,
    // and writes the result down so it is paid exactly once.
    assert.equal(existsSync(indexPath(root)), false, "no index before the first read");
    const warm = syncSessionIndex(root);
    assert.equal(warm.entries.length, N);
    assert.equal(existsSync(indexPath(root)), true, "the rebuild is persisted, not repeated");

    // Now nothing under a session directory can be opened at all.
    for (let i = 0; i < N; i += 1) sabotage(root, `s${String(i).padStart(4, "0")}`);

    const second = syncSessionIndex(root);
    assert.equal(second.entries.length, N, "every row still answers from the index alone");
    assert.equal(second.backfilled, 0, "and nothing needed rebuilding");
    assert.deepEqual(second.unreadable, [], "no directory had to be opened, so none failed");
    assert.equal(second.recovery, undefined);
    // The rows are real records, not placeholders.
    const one = second.entries.find((e) => e.sessionId === "s0007");
    assert.equal(one?.task, "task for s0007");
    assert.equal(one?.filesTouched, 3);
    assert.equal(entriesForWorkspace(second.entries, workspace).length, N);
  });
});

test("picking the latest session loads exactly one session's transcript", () => {
  withRoot((root, workspace) => {
    for (let i = 0; i < 40; i += 1) {
      seed(root, `s${String(i).padStart(4, "0")}`, workspace, `2026-08-19T10:00:${String(i).padStart(2, "0")}.000Z`);
    }
    syncSessionIndex(root);
    // Every session EXCEPT the newest is made unopenable. An implementation
    // that walked the library to find the newest one would die here — which is
    // exactly what the previous implementation did, for every session, on
    // every `aether resume`.
    for (let i = 0; i < 39; i += 1) sabotage(root, `s${String(i).padStart(4, "0")}`);

    const latest = latestSession(workspace, root);
    assert.equal(latest?.manifest.sessionId, "s0039");
    assert.equal(latest?.events.length, 400, "the one session it returns is fully loaded");
  });
});

test("sessions recorded before the index existed are reconciled into it, not lost", () => {
  withRoot((root, workspace) => {
    seed(root, "old-a", workspace, "2026-08-01T10:00:00.000Z");
    seed(root, "old-b", workspace, "2026-08-02T10:00:00.000Z");
    seed(root, "new-c", workspace, "2026-08-03T10:00:00.000Z");
    // An index that knows about only the newest session — the shape left behind
    // by any build that wrote a row without reconciling first.
    writeFileSync(
      indexPath(root),
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            sessionId: "new-c",
            workspace,
            workspaceFingerprint: "f",
            task: "task for new-c",
            model: "m",
            brain: "local",
            started: "2026-08-03T10:00:00.000Z",
            ended: null,
            finalStatus: "ok",
          },
        ],
      }),
    );

    // Trusting the stored file here would silently erase two thirds of the
    // user's history the first time a new session was written.
    const read = readSessionIndex(root);
    assert.equal(read.entries.length, 1, "the stored file is genuinely short");

    const synced = syncSessionIndex(root);
    assert.deepEqual(
      synced.entries.map((e) => e.sessionId).sort(),
      ["new-c", "old-a", "old-b"],
      "the disk is the authority the index has to agree with",
    );
    assert.equal(synced.backfilled, 2);
    // And the repair is durable: the next read needs no backfill.
    const again = syncSessionIndex(root);
    assert.equal(again.backfilled, 0);
    assert.equal(again.entries.length, 3);
  });
});

test("a session directory that cannot be read is named, not quietly dropped", () => {
  withRoot((root, workspace) => {
    seed(root, "good", workspace, "2026-08-19T10:00:00.000Z");
    seed(root, "broken", workspace, "2026-08-19T10:00:01.000Z");
    writeFileSync(join(root, "broken", "manifest.json"), "{ truncated");

    const synced = syncSessionIndex(root);
    assert.deepEqual(synced.entries.map((e) => e.sessionId), ["good"]);
    assert.deepEqual(synced.unreadable, ["broken"], "a shorter list must not look like a complete one");
  });
});

test("an index row never invents a session that is gone", () => {
  withRoot((root, workspace) => {
    seed(root, "gone", workspace, "2026-08-19T10:00:00.000Z");
    syncSessionIndex(root);
    rmSync(join(root, "gone"), { recursive: true, force: true });
    // The row survives (clean removes it), but resuming must not pretend.
    assert.equal(latestSession(workspace, root), null);
  });
});

// ── the invariant: unknown is not zero, and not healthy ─────────────────────

test("an unmeasured budget reads as unknown, never as zero spent", () => {
  assert.equal(budgetLine({ status: "unknown", observed: null, cap: null }), "unknown spent · no cap set");
  assert.equal(budgetLine({ status: "unknown", observed: null, cap: 50_000 }), "unknown spent · 50,000 UVT cap");
  assert.equal(budgetLine({ status: "local-unmetered", observed: null, cap: null }), "not metered (local brain)");
  assert.equal(budgetLine({ status: "observed", observed: 0, cap: 50_000 }), "0 / 50,000 UVT");
  assert.equal(budgetLine({ status: "observed", observed: 1234, cap: null }), "1,234 UVT spent · no cap set");
  // The distinction this whole line exists for: a metered zero and an unmeasured
  // amount must not render the same way.
  assert.notEqual(
    budgetLine({ status: "unknown", observed: null, cap: 50_000 }),
    budgetLine({ status: "observed", observed: 0, cap: 50_000 }),
  );
});

function entry(over: Partial<SessionIndexEntry> = {}): SessionIndexEntry {
  return {
    sessionId: "2026-08-19T10-00-00-000Z-cloud-4242",
    workspace: "/w/aether-agent",
    workspaceFingerprint: "f",
    task: "wire the session library",
    model: "gpt56_sol",
    brain: "cloud",
    started: "2026-08-19T10:00:00.000Z",
    ended: "2026-08-19T10:40:00.000Z",
    finalStatus: "ok",
    ...over,
  };
}

const plain = (lines: string[]): string => lines.map(stripAnsi).join("\n");

test("the splash continuity block prints unknowns as unknown", () => {
  const out = plain(
    continuityLines({
      cwd: "/w/aether-agent",
      entry: entry(),
      usage: { status: "unknown", observed: null, cap: null },
    }),
  );
  assert.match(out, /Project\s+aether-agent/);
  assert.match(out, /Repository\s+unknown/, "a remote nobody recorded is not guessed from this checkout");
  assert.match(out, /Branch\s+unknown/, "and neither is the branch");
  assert.match(out, /Verify\s+unknown — no verify command recorded/);
  assert.match(out, /Budget\s+unknown spent/);
  assert.ok(!/Budget\s+0/.test(out));
});

test("a session whose record never closed says so, and is not called running", () => {
  const out = plain(
    continuityLines({
      cwd: "/w/aether-agent",
      entry: entry({ ended: null, finalStatus: "running" }),
      usage: { status: "unknown", observed: null, cap: null },
    }),
  );
  assert.match(out, /never finished \(running or interrupted — unknown which\)/);
  assert.ok(!/\bok\b/.test(out), "an unfinished run is never reported as verified");
});

test("recorded facts are printed as recorded", () => {
  const out = plain(
    continuityLines({
      cwd: "/w/aether-agent",
      entry: entry({
        repoRemote: "git@github.com:AetherAI3/aether-agent.git",
        branch: "aether/ship-rail-k91d",
        headRev: "ed094dc8885945e69f66e166e854142005bf1d62",
        testCmd: "npm test",
        skills: ["review-pr", "ship"],
        instructionsDigest: "AGENTS.md",
        remaining: 2,
      }),
      usage: { status: "observed", observed: 12_500, cap: 50_000 },
    }),
  );
  assert.match(out, /Repository\s+AetherAI3\/aether-agent/);
  assert.match(out, /Branch\s+aether\/ship-rail-k91d @ ed094dc8/);
  assert.match(out, /Rules\s+AGENTS\.md/);
  assert.match(out, /Skills\s+review-pr · ship/);
  assert.match(out, /Verify\s+npm test/);
  assert.match(out, /Budget\s+12,500 \/ 50,000 UVT/);
  assert.match(out, /2 test\(s\) failing/);
});

test("no session here yet is its own state, not an empty project", () => {
  const out = plain(
    continuityLines({ cwd: "/w/fresh-project", usage: { status: "unknown", observed: null, cap: null } }),
  );
  assert.match(out, /Project\s+fresh-project/);
  assert.match(out, /Session\s+none recorded here yet/);
  assert.match(out, /aether agent/);
});

test("a hostile task string cannot repaint the splash", () => {
  const out = continuityLines({
    cwd: "/w/aether-agent",
    entry: entry({ branch: "main[31m", model: "m]0;pwned" }),
    usage: { status: "unknown", observed: null, cap: null },
  }).join("\n");
  assert.ok(!out.includes(""));
  assert.ok(!out.includes("pwned"));
});

test("remotes shorten to owner/name and are never dropped when they do not", () => {
  assert.equal(shortRemote("git@github.com:AetherAI3/aether-agent.git"), "AetherAI3/aether-agent");
  assert.equal(shortRemote("https://github.com/AetherAI3/aether-agent"), "AetherAI3/aether-agent");
  assert.equal(shortRemote("/srv/git/bare-repo"), "/srv/git/bare-repo", "a local path is not a repository name");
  assert.equal(shortRemote("weird"), "weird");
});

test("an index write that cannot happen still returns the right answer", () => {
  withRoot((root, workspace) => {
    seed(root, "s1", workspace, "2026-08-19T10:00:00.000Z");
    // A directory where the index file belongs: every write fails, forever.
    mkdirSync(indexPath(root), { recursive: true });
    const synced = syncSessionIndex(root);
    assert.equal(synced.entries.length, 1, "the manifests still answer the question");
    assert.equal(synced.entries[0]?.sessionId, "s1");
    // And the next read is just as correct, if just as expensive.
    assert.equal(syncSessionIndex(root).entries.length, 1);
  });
});

// ── what a real run records ─────────────────────────────────────────────────
// The fields above are only worth having if something fills them. These drive
// SessionLog itself and read the manifest back off disk.

const TS = "2026-08-22T09:00:00.000Z";
const meta = (cwd: string) => ({ task: "wire the library", model: "gpt56_sol", poolGb: 5, brain: "local" as const, cwd });

test("a run records the branch it was on and the skills it used — probed once, at close", () => {
  const root = mkdtempSync(join(tmpdir(), "aether-record-"));
  try {
    const probed: string[] = [];
    const log = new SessionLog(meta(root), TS, root, (cwd) => {
      probed.push(cwd);
      return { remote: "git@github.com:AetherAI3/aether-agent.git", branch: "aether/ship-rail-k91d", head: "ed094dc8885945e69f66e166e854142005bf1d62" };
    });
    // Startup must spawn no git. #89 took an unbounded `git status` off this
    // path and nothing may put one back.
    assert.deepEqual(probed, [], "constructing a session log runs no git");

    log.event({ type: "skill", name: "review-pr", reason: "trigger matched" }, TS);
    log.event({ type: "skill", name: "review-pr", reason: "matched again" }, TS);
    log.event({ type: "skill", name: "ship", reason: "trigger matched" }, TS);
    log.event({ type: "tool_call", id: "1", name: "write_file", args: { path: "src/a.ts" } }, TS);
    log.event({ type: "tool_call", id: "2", name: "write_file", args: { path: "src/a.ts" } }, TS);
    log.close("ok", TS);

    assert.deepEqual(probed, [root], "probed exactly once, after the run finished");
    const manifest = JSON.parse(readFileSync(join(log.dir, "manifest.json"), "utf8"));
    assert.equal(manifest.branch, "aether/ship-rail-k91d");
    assert.equal(manifest.repoRemote, "git@github.com:AetherAI3/aether-agent.git");
    assert.deepEqual(manifest.skills, ["review-pr", "ship"], "one entry per skill, not one per event");
    assert.equal(manifest.filesTouched, 1, "the same file written twice is one file touched");

    // And the library reads them back without opening the transcript.
    const row = syncSessionIndex(root).entries.find((e) => e.sessionId === log.sessionId);
    assert.equal(row?.branch, "aether/ship-rail-k91d");
    assert.deepEqual(row?.skills, ["review-pr", "ship"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a probe that finds nothing, or throws, leaves the branch absent — never blank", () => {
  const root = mkdtempSync(join(tmpdir(), "aether-record-"));
  try {
    const none = new SessionLog(meta(root), TS, root, () => undefined);
    none.close("unverified", TS);
    const a = JSON.parse(readFileSync(join(none.dir, "manifest.json"), "utf8"));
    assert.equal("branch" in a, false, "a directory with no checkout has no branch to record");
    assert.equal("repoRemote" in a, false);
    assert.equal("skills" in a, false, "a run that used no skills records none, not an empty list");

    // A probe that throws must not take the session's own record down with it.
    const boom = new SessionLog(meta(root), TS + "1", root, () => {
      throw new Error("git exploded");
    });
    boom.close("ok", TS);
    const b = JSON.parse(readFileSync(join(boom.dir, "manifest.json"), "utf8"));
    assert.equal(b.finalStatus, "ok", "the manifest is still written");
    assert.equal("branch" in b, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI registry row and the command's own spec are the same row", async () => {
  // The spec lives next to the implementation and is copied into the shared,
  // additive-only registry by hand. Asserting the copy's own fields (which is
  // what the sessions test does) proves nothing about the registry: this is the
  // assertion that actually fails if the two drift, or if the row is dropped.
  const registered = findDispatchedCliCommand(SESSIONS_CLI_COMMAND.name);
  assert.ok(registered, "`aether sessions` is missing from the dispatch table — the command would be unreachable");
  assert.equal(registered.args, SESSIONS_CLI_COMMAND.args);
  assert.equal(registered.summary, SESSIONS_CLI_COMMAND.summary);
  assert.equal(registered.section, SESSIONS_CLI_COMMAND.section);
  // Reachability is now structural rather than asserted: the entry carries its
  // own loader, so a mistyped wiring cannot fall through to a billed chat turn.
  assert.equal(typeof (await registered.load()), "function");
  // The flags the command reads must be flags the parser was told about, and
  // the ones it does NOT own (--all, --out are global) must not be redeclared.
  assert.deepEqual(Object.keys(registered.flags ?? {}).sort(), ["no-select", "undo"]);
  for (const owned of ["undo", "no-select"]) assert.ok(owned in CLI_PARSE_OPTIONS);
  for (const global of ["all", "out"]) assert.ok(global in CLI_PARSE_OPTIONS);
});

test("inspect tells the three unknowns apart", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-inspect-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  try {
    const dir = join(root, "unfinished");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        sessionId: "unfinished",
        task: "add the continuity splash",
        model: "gpt56_sol",
        brain: "cloud",
        cwd: workspace,
        started: "2026-08-22T08:40:02.000Z",
        ended: null,
        finalStatus: "running",
      }),
    );
    let out = "";
    const sink = { write: (chunk: string) => ((out += chunk), true) } as unknown as NodeJS.WritableStream;
    const ctx = {
      cfg: {},
      api: {},
      tokens: {},
      flags: { json: false, audit: false, yes: false, cwd: workspace },
      confirm: async () => false,
    } as unknown as Parameters<typeof cmdSessions>[0];
    const code = await cmdSessions(ctx, ["inspect", "unfinished"], {
      root,
      tty: false,
      out: sink,
      err: sink,
      run: () => ({ status: 1, stdout: "", stderr: "" }),
    });
    assert.equal(code, 0);
    // 1. never finished — and not called running-therefore-fine.
    assert.match(out, /ended\s+never — this run may still be live, or may have been interrupted/);
    assert.match(out, /status\s+running \(never verified — the run did not finish\)/);
    // 2. never recorded — a count, a command and a branch nobody wrote down.
    assert.match(out, /written\s+unknown/);
    assert.match(out, /verify\s+unknown/);
    assert.match(out, /branch\s+unknown/);
    // 3. never knowable from this build — which is not the same as "no PR".
    assert.match(out, /pr\s+unknown — this build does not record pull requests/);
    assert.ok(!/written\s+0/.test(out), "an unmeasured file count is never rendered as zero");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("upserting a row does not erase the sessions the index had not seen", () => {
  withRoot((root, workspace) => {
    seed(root, "old", workspace, "2026-08-01T10:00:00.000Z");
    upsertSessionIndex(
      {
        sessionId: "new",
        workspace,
        workspaceFingerprint: "f",
        task: "t",
        model: "m",
        brain: "local",
        started: "2026-08-02T10:00:00.000Z",
        ended: null,
        finalStatus: "running",
      },
      root,
    );
    assert.deepEqual(
      syncSessionIndex(root).entries.map((e) => e.sessionId).sort(),
      ["new", "old"],
    );
  });
});
