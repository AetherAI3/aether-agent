import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSessions, continueCommand, SESSIONS_CLI_COMMAND } from "../src/commands/sessions.js";
import { readSessionIndex } from "../src/core/session_index.js";
import { classifySession, renderCount, stateLabel, UNKNOWN } from "../src/ui/continuity.js";
import type { AppContext } from "../src/core/context.js";
import type { RunResult } from "../src/core/worktree.js";

// The command layer is driven for real against a seeded log root: these tests
// assert what lands on stdout/stderr and what changes on disk, not what a
// renderer would have said.

interface Captured {
  out: string;
  err: string;
  stream: { out: NodeJS.WritableStream; err: NodeJS.WritableStream };
}

function capture(): Captured {
  const cap: Captured = {
    out: "",
    err: "",
    stream: {
      out: { write: (chunk: string) => ((cap.out += chunk), true) } as unknown as NodeJS.WritableStream,
      err: { write: (chunk: string) => ((cap.err += chunk), true) } as unknown as NodeJS.WritableStream,
    },
  };
  return cap;
}

function ctxFor(cwd: string, over: Partial<AppContext["flags"]> = {}, confirmWith = true): AppContext {
  return {
    cfg: {} as AppContext["cfg"],
    api: {} as AppContext["api"],
    tokens: {} as AppContext["tokens"],
    flags: { json: false, audit: false, yes: false, cwd, ...over },
    confirm: async () => confirmWith,
  };
}

/** A git runner that answers for exactly one checkout, and fails elsewhere. */
function runnerFor(remote: string, branch: string) {
  return (_cmd: string, args: readonly string[]): RunResult => {
    const joined = args.join(" ");
    if (joined.includes("remote get-url")) return { status: 0, stdout: remote, stderr: "" };
    if (joined.includes("--abbrev-ref")) return { status: 0, stdout: branch, stderr: "" };
    return { status: 0, stdout: "abc1234", stderr: "" };
  };
}

function seed(root: string, id: string, extra: Record<string, unknown>): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      sessionId: id,
      task: "make the parser accept trailing commas",
      model: "qwen3:4b",
      brain: "local",
      started: "2026-08-19T10:00:00.000Z",
      ended: "2026-08-19T10:04:00.000Z",
      finalStatus: "incomplete",
      testCmd: "npm test",
      ...extra,
    }),
  );
  writeFileSync(
    join(dir, "events.jsonl"),
    JSON.stringify({ ts: "t", type: "monologue", text: "the tokenizer rejects it", depth: 0 }) +
      "\n" +
      JSON.stringify({ ts: "t", type: "tool_call", id: "1", name: "write_file", args: { path: "src/parse.ts" } }) +
      "\n",
  );
}

function withRoot(fn: (root: string, workspace: string) => void | Promise<void>): Promise<void> | void {
  const root = mkdtempSync(join(tmpdir(), "aether-sessions-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  const done = () => rmSync(root, { recursive: true, force: true });
  try {
    const result = fn(root, workspace);
    if (result instanceof Promise) return result.finally(done);
    done();
    return;
  } catch (err) {
    done();
    throw err;
  }
}

test("the registry spec this command wires up is complete", () => {
  assert.equal(SESSIONS_CLI_COMMAND.name, "sessions");
  assert.ok(SESSIONS_CLI_COMMAND.summary.length > 10);
  assert.equal(SESSIONS_CLI_COMMAND.section, "Start");
});

test("the piped listing is tab separated with a stable field order", () =>
  withRoot(async (root, workspace) => {
    seed(root, "s1", { cwd: workspace });
    const cap = capture();
    const code = await cmdSessions(ctxFor(workspace), [], {
      root,
      tty: false,
      out: cap.stream.out,
      err: cap.stream.err,
      run: runnerFor("git@github.com:a/b.git", "main"),
    });
    assert.equal(code, 0);
    const [header, row] = cap.out.trim().split("\n");
    assert.equal(header, "SESSION\tSTARTED\tSTATUS\tSTATE\tBRAIN\tMODEL\tFILES_WRITTEN\tBRANCH\tTASK");
    const fields = row!.split("\t");
    assert.equal(fields[0], "s1");
    assert.equal(fields[2], "incomplete");
    assert.equal(fields[6], UNKNOWN, "a file count nobody recorded is not 0");
  }));

test("a session from another workspace is not listed here, and cannot be continued here", () =>
  withRoot(async (root, workspace) => {
    const elsewhere = join(root, "other-project");
    mkdirSync(elsewhere, { recursive: true });
    seed(root, "s-here", { cwd: workspace });
    seed(root, "s-there", { cwd: elsewhere });

    const list = capture();
    await cmdSessions(ctxFor(workspace), [], { root, tty: false, out: list.stream.out, err: list.stream.err });
    assert.ok(list.out.includes("s-here"));
    assert.ok(!list.out.includes("s-there"), "another project's session stays out of this listing");

    const cont = capture();
    const code = await cmdSessions(ctxFor(workspace), ["continue", "s-there"], {
      root,
      tty: false,
      out: cont.stream.out,
      err: cont.stream.err,
    });
    assert.equal(code, 1);
    assert.match(cont.err, /cannot continue from here/);
    assert.ok(cont.err.includes(elsewhere), "it says where the session actually lives");
  }));

test("--all crosses workspaces; every row still names its own state", () =>
  withRoot(async (root, workspace) => {
    const elsewhere = join(root, "other-project");
    mkdirSync(elsewhere, { recursive: true });
    seed(root, "s-here", { cwd: workspace });
    seed(root, "s-there", { cwd: elsewhere });
    const cap = capture();
    await cmdSessions(ctxFor(workspace), ["--all"], {
      root,
      tty: false,
      out: cap.stream.out,
      err: cap.stream.err,
    });
    const rows = cap.out.trim().split("\n").slice(1);
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.includes("s-here") && r.includes("\tready\t")));
    assert.ok(rows.some((r) => r.includes("s-there") && r.includes("\telsewhere\t")));
  }));

test("a stale branch is reported, not silently continued", () =>
  withRoot(async (root, workspace) => {
    seed(root, "s1", { cwd: workspace, branch: "feature/parser", repoRemote: "git@github.com:a/b.git" });
    const cap = capture();
    const code = await cmdSessions(ctxFor(workspace), ["continue", "s1"], {
      root,
      tty: false,
      out: cap.stream.out,
      err: cap.stream.err,
      run: runnerFor("git@github.com:a/b.git", "main"),
    });
    assert.equal(code, 0, "a stale branch is continuable — just not where you think");
    assert.match(cap.out, /another branch now/);
    assert.match(cap.out, /git switch feature\/parser/);
    assert.ok(cap.out.includes(continueCommand({ sessionId: "s1" } as never)));
  }));

test("archive hides a row and deletes nothing; --undo brings it back", () =>
  withRoot(async (root, workspace) => {
    seed(root, "s1", { cwd: workspace });
    const cap = capture();
    assert.equal(
      await cmdSessions(ctxFor(workspace), ["archive", "s1"], {
        root,
        tty: false,
        out: cap.stream.out,
        err: cap.stream.err,
      }),
      0,
    );
    assert.ok(existsSync(join(root, "s1", "manifest.json")), "the session log survives archiving");
    const listed = capture();
    await cmdSessions(ctxFor(workspace), [], { root, tty: false, out: listed.stream.out, err: listed.stream.err });
    assert.ok(!listed.out.includes("s1"));

    const undone = capture();
    await cmdSessions(ctxFor(workspace), ["archive", "s1", "--undo"], {
      root,
      tty: false,
      out: undone.stream.out,
      err: undone.stream.err,
    });
    const back = capture();
    await cmdSessions(ctxFor(workspace), [], { root, tty: false, out: back.stream.out, err: back.stream.err });
    assert.ok(back.out.includes("s1"));
  }));

test("a declined confirmation changes nothing", () =>
  withRoot(async (root, workspace) => {
    seed(root, "s1", { cwd: workspace });
    const cap = capture();
    const code = await cmdSessions(ctxFor(workspace, {}, false), ["archive", "s1"], {
      root,
      tty: false,
      out: cap.stream.out,
      err: cap.stream.err,
    });
    assert.equal(code, 1);
    assert.match(cap.err, /cancelled/);
    assert.equal(readSessionIndex(root).entries[0]?.archived, undefined);
  }));

test("clean removes index rows only — never a session directory", () =>
  withRoot(async (root, workspace) => {
    seed(root, "s-live", { cwd: workspace });
    seed(root, "s-dead", { cwd: workspace });
    // Materialise the index while both exist, then remove one behind its back.
    for (const entry of readSessionIndex(root).entries) {
      const { upsertSessionIndex } = await import("../src/core/session_index.js");
      upsertSessionIndex(entry, root);
    }
    rmSync(join(root, "s-dead"), { recursive: true, force: true });

    const cap = capture();
    const code = await cmdSessions(ctxFor(workspace), ["clean"], {
      root,
      tty: false,
      out: cap.stream.out,
      err: cap.stream.err,
    });
    assert.equal(code, 0);
    assert.match(cap.out, /removed 1 index row/);
    assert.ok(existsSync(join(root, "s-live", "manifest.json")), "the live session is untouched");
  }));

test("archive and clean refuse to claim a change the index never took", () =>
  withRoot(async (root, workspace) => {
    seed(root, "s1", { cwd: workspace });
    // An index written by a newer build is never overwritten, so neither verb
    // can persist anything here. Saying "archived" would be a lie on disk.
    writeFileSync(
      join(root, "index.json"),
      JSON.stringify({ schemaVersion: 99, entries: [] }),
    );

    const archived = capture();
    const archiveCode = await cmdSessions(ctxFor(workspace), ["archive", "s1"], {
      root,
      tty: false,
      out: archived.stream.out,
      err: archived.stream.err,
    });
    assert.equal(archiveCode, 1);
    assert.match(archived.err, /not archived — the session index was written by a newer/);
    assert.ok(!archived.out.includes("archived s1"), "no success line is printed");

    // `clean` cannot wrongly claim removals in the same situation for a
    // different reason: its stale list is derived from the manifests on disk,
    // which a refused index never contributes rows to.
    rmSync(join(root, "s1"), { recursive: true, force: true });
    const cleaned = capture();
    const cleanCode = await cmdSessions(ctxFor(workspace), ["clean"], {
      root,
      tty: false,
      out: cleaned.stream.out,
      err: cleaned.stream.err,
    });
    assert.equal(cleanCode, 0);
    assert.match(cleaned.out, /already clean/);
    assert.ok(!/removed \d+ index row/.test(cleaned.out), "no removal is claimed");
  }));

test("an unknown session id is refused with the id, not a stack trace", () =>
  withRoot(async (root, workspace) => {
    const cap = capture();
    const code = await cmdSessions(ctxFor(workspace), ["inspect", "nope"], {
      root,
      tty: false,
      out: cap.stream.out,
      err: cap.stream.err,
    });
    assert.equal(code, 1);
    assert.match(cap.err, /no such session: nope/);
  }));

test("a traversal-shaped id is rejected before it becomes a path", () =>
  withRoot(async (root, workspace) => {
    const cap = capture();
    const code = await cmdSessions(ctxFor(workspace), ["inspect", "../../etc/passwd"], {
      root,
      tty: false,
      out: cap.stream.out,
      err: cap.stream.err,
    });
    assert.equal(code, 1);
    assert.match(cap.err, /invalid session id/);
  }));

test("--json emits the row plus its computed state", () =>
  withRoot(async (root, workspace) => {
    seed(root, "s1", { cwd: workspace });
    const cap = capture();
    await cmdSessions(ctxFor(workspace, { json: true }), [], {
      root,
      tty: false,
      out: cap.stream.out,
      err: cap.stream.err,
    });
    const parsed = JSON.parse(cap.out) as { sessions: Array<{ sessionId: string; state: string }> };
    assert.equal(parsed.sessions.length, 1);
    assert.equal(parsed.sessions[0]!.sessionId, "s1");
    assert.equal(parsed.sessions[0]!.state, "ready");
  }));

test("a corrupt index is reported on stderr while the listing still answers", () =>
  withRoot(async (root, workspace) => {
    seed(root, "s1", { cwd: workspace });
    writeFileSync(join(root, "index.json"), "{ truncated");
    const cap = capture();
    const code = await cmdSessions(ctxFor(workspace), [], {
      root,
      tty: false,
      out: cap.stream.out,
      err: cap.stream.err,
    });
    assert.equal(code, 0);
    assert.match(cap.err, /session index rebuilt from manifests/);
    assert.ok(cap.out.includes("s1"));
  }));

test("classification separates the five ways a session can be elsewhere", () => {
  const base = {
    sessionId: "s1",
    workspace: "/gone",
    workspaceFingerprint: "f",
    task: "t",
    model: "m",
    brain: "local" as const,
    started: "2026-08-19T10:00:00.000Z",
    ended: null,
    finalStatus: "ok",
  };
  const here = { cwd: "/here", sameWorkspace: true, workspaceExists: true };
  assert.equal(classifySession(base, here), "ready");
  assert.equal(classifySession({ ...base, branch: "x" }, { ...here, currentBranch: "y" }), "stale-branch");
  assert.equal(
    classifySession({ ...base, branch: "x" }, { ...here, currentBranch: undefined }),
    "ready",
    "an unknown current branch is not evidence the branch moved",
  );
  assert.equal(
    classifySession(base, { cwd: "/here", sameWorkspace: false, workspaceExists: false }),
    "missing-checkout",
  );
  assert.equal(
    classifySession(
      { ...base, repoRemote: "git@github.com:a/b.git" },
      { cwd: "/here", sameWorkspace: false, workspaceExists: false, currentRemote: "git@github.com:a/b.git" },
    ),
    "moved-checkout",
  );
  assert.equal(
    classifySession(base, { cwd: "/here", sameWorkspace: false, workspaceExists: true }),
    "other-workspace",
  );
  assert.equal(classifySession({ ...base, archived: true }, here), "archived");
  assert.equal(stateLabel("missing-checkout"), "missing");
  assert.equal(renderCount(undefined), UNKNOWN);
  assert.equal(renderCount(0), "0");
});
