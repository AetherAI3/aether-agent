import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HANDOFF_KIND,
  HANDOFF_SCHEMA_VERSION,
  buildHandoff,
  continuationBrief,
  continuationTask,
  isHandoffPath,
  parseHandoff,
  readHandoff,
  readRepoIdentity,
  resolveHandoff,
  summarizeEvents,
  writeHandoff,
  type Handoff,
} from "../src/core/handoff.js";
import type { LoadedSession } from "../src/core/session_resume.js";

// A handoff is what makes `--resume` mean "the next brain knows what happened"
// rather than "the human sees the old transcript scroll past". These tests pin
// the three things that must hold for that: the distillation keeps decisions and
// drops noise, the file survives a trip between machines (validated on the way
// back in), and the brief the brain reads carries the prior verdict.

function session(events: Array<Record<string, unknown>>, manifest: Record<string, unknown> = {}): LoadedSession {
  return {
    dir: "/logs/s1",
    manifest: {
      sessionId: "s1",
      task: "make the parser accept trailing commas",
      model: "qwen3:4b",
      brain: "local",
      started: "2026-08-19T10:00:00.000Z",
      ended: "2026-08-19T10:04:00.000Z",
      finalStatus: "incomplete",
      ...manifest,
    } as LoadedSession["manifest"],
    events,
  };
}

test("summarizeEvents keeps the decisions and drops the tool noise", () => {
  const { highlights, filesTouched } = summarizeEvents([
    { type: "stage", name: "scan", face: "" },
    { type: "monologue", text: "the tokenizer rejects a comma before ]", depth: 0 },
    { type: "tool_call", id: "1", name: "read_file", args: { path: "src/parse.ts" } },
    { type: "tool_call", id: "2", name: "write_file", args: { path: "src/parse.ts" } },
    { type: "tool_call", id: "3", name: "write_file", args: { path: "src/parse.ts" } },
    { type: "tool_call", id: "4", name: "run_tests", args: { command: "npm test" } },
    { type: "done", ok: false, result: "one case still red", remaining: 1, reason: "" },
  ]);
  // read_file is not a change, and the same file written twice is one file.
  assert.deepEqual(filesTouched, ["src/parse.ts"]);
  assert.ok(highlights.some((h) => h.includes("stage: scan")));
  assert.ok(highlights.some((h) => h.includes("tokenizer rejects")));
  assert.ok(highlights.some((h) => h.startsWith("stopped: one case still red")));
  assert.ok(!highlights.some((h) => h.includes("read_file")));
});

test("summarizeEvents keeps the TAIL when a run is long", () => {
  const events = Array.from({ length: 200 }, (_, i) => ({
    type: "monologue",
    text: `step ${i}`,
    depth: 0,
  }));
  const { highlights } = summarizeEvents(events);
  assert.ok(highlights.length <= 40);
  // The end of a run is what the next one builds on, so the tail survives.
  assert.equal(highlights[highlights.length - 1], "step 199");
});

test("buildHandoff carries the prior verdict, model and failing count", () => {
  const h = buildHandoff(
    session([{ type: "done", ok: false, result: "1 failing", remaining: 1, reason: "" }], {
      remaining: 1,
      testCmd: "npm test",
    }),
    { repo: { remote: "https://github.com/acme/parser.git", branch: "main" } },
  );
  assert.equal(h.kind, HANDOFF_KIND);
  assert.equal(h.schemaVersion, HANDOFF_SCHEMA_VERSION);
  assert.equal(h.model, "qwen3:4b");
  assert.equal(h.finalStatus, "incomplete");
  assert.equal(h.remaining, 1);
  assert.equal(h.testCmd, "npm test");
  assert.equal(h.repo?.branch, "main");
});

test("buildHandoff omits `remaining` when the prior run was green", () => {
  const h = buildHandoff(session([], { finalStatus: "ok" }));
  assert.equal(h.finalStatus, "ok");
  assert.equal(h.remaining, undefined);
});

test("a handoff round-trips through a file", () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-handoff-"));
  try {
    const path = join(dir, "aether-handoff.json");
    const original = buildHandoff(session([{ type: "monologue", text: "found it", depth: 0 }]));
    writeHandoff(path, original);
    assert.deepEqual(readHandoff(path), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseHandoff refuses anything that is not a handoff", () => {
  assert.throws(() => parseHandoff(null), /not a JSON object/);
  assert.throws(() => parseHandoff([1, 2]), /not a JSON object/);
  assert.throws(() => parseHandoff({ kind: "something-else" }), /not an Aether Agent handoff/);
  assert.throws(
    () => parseHandoff({ kind: HANDOFF_KIND, schemaVersion: "1" }),
    /no usable schemaVersion/,
  );
  assert.throws(
    () => parseHandoff({ kind: HANDOFF_KIND, schemaVersion: 1 }),
    /missing its session id or task/,
  );
});

test("a handoff from a NEWER Aether Agent says how to read it, rather than half-reading it", () => {
  assert.throws(
    () => parseHandoff({ kind: HANDOFF_KIND, schemaVersion: 99, sessionId: "s", task: "t" }),
    /npm i -g aether-agents/,
  );
});

test("parseHandoff drops junk inside the arrays instead of trusting them", () => {
  const h = parseHandoff({
    kind: HANDOFF_KIND,
    schemaVersion: 1,
    sessionId: "s1",
    task: "t",
    highlights: ["real", 7, null, { nope: true }],
    filesTouched: ["src/a.ts", 9],
    repo: "not-an-object",
  });
  assert.deepEqual(h.highlights, ["real"]);
  assert.deepEqual(h.filesTouched, ["src/a.ts"]);
  assert.equal(h.repo, undefined);
});

test("the brief names the prior model, the verdict and the files", () => {
  const brief = continuationBrief(
    buildHandoff(
      session([{ type: "tool_call", id: "1", name: "write_file", args: { path: "src/parse.ts" } }], {
        remaining: 2,
        testCmd: "npm test",
      }),
    ),
  );
  assert.match(brief, /Prior session: s1/);
  assert.match(brief, /qwen3:4b/);
  assert.match(brief, /incomplete — 2 tests still failing/);
  assert.match(brief, /Verification command: npm test/);
  assert.match(brief, /- src\/parse\.ts/);
});

test("continuationTask falls back to the ORIGINAL task when no new one is given", () => {
  const h = buildHandoff(session([]));
  const text = continuationTask(h, "   ");
  assert.match(text, /## Your task now/);
  assert.match(text, /make the parser accept trailing commas/);
});

test("continuationTask puts the new instruction after the brief", () => {
  const h = buildHandoff(session([]));
  const text = continuationTask(h, "now delete the dead branch");
  assert.ok(text.indexOf("Prior session") < text.indexOf("now delete the dead branch"));
});

test("isHandoffPath separates a file from an opaque session id", () => {
  assert.equal(isHandoffPath("./aether-handoff.json"), true);
  assert.equal(isHandoffPath("C:\\work\\handoff.json"), true);
  assert.equal(isHandoffPath("handoff.json"), true);
  assert.equal(isHandoffPath("2026-08-19T10-00-00-000Z-local-4242"), false);
});

test("resolveHandoff reads a FILE without any workspace check", () => {
  // The whole point of the file form: it lands in a checkout whose absolute
  // path does not match where the work started.
  const dir = mkdtempSync(join(tmpdir(), "aether-handoff-"));
  try {
    const path = join(dir, "handoff.json");
    writeHandoff(path, buildHandoff(session([])));
    const h: Handoff = resolveHandoff(path, "C:\\somewhere\\entirely\\else");
    assert.equal(h.sessionId, "s1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveHandoff explains an unreadable handoff file by name", () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-handoff-"));
  try {
    const path = join(dir, "broken.json");
    writeFileSync(path, "{ not json", "utf8");
    assert.throws(() => resolveHandoff(path, dir), /cannot read handoff/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveHandoff distils a local session id through the injected loader", () => {
  const loaded = session([{ type: "monologue", text: "did a thing", depth: 0 }]);
  const h = resolveHandoff("s1", "/work", (id, _root, scope) => {
    assert.equal(id, "s1");
    assert.equal(scope, "/work");
    return loaded;
  });
  assert.equal(h.sessionId, "s1");
  assert.ok(h.highlights.includes("did a thing"));
});

test("resolveHandoff rejects an empty reference", () => {
  assert.throws(() => resolveHandoff("  ", "/work"), /needs a session id or a handoff file/);
});

test("readRepoIdentity is best-effort: a non-repo yields nothing, not an error", () => {
  const identity = readRepoIdentity("/nowhere", () => ({ status: 128, stdout: "", stderr: "not a git repo" }));
  assert.equal(identity, undefined);
});

test("readRepoIdentity collects remote, branch and head", () => {
  const identity = readRepoIdentity("/work", (_cmd, args) => {
    const key = args.join(" ");
    if (key === "remote get-url origin") return { status: 0, stdout: "git@github.com:acme/parser.git\n", stderr: "" };
    if (key === "rev-parse --abbrev-ref HEAD") return { status: 0, stdout: "feat/commas\n", stderr: "" };
    return { status: 0, stdout: "abc123\n", stderr: "" };
  });
  assert.deepEqual(identity, {
    remote: "git@github.com:acme/parser.git",
    branch: "feat/commas",
    head: "abc123",
  });
});

test("readRepoIdentity survives a runner that throws", () => {
  assert.equal(
    readRepoIdentity("/work", () => {
      throw new Error("git is not installed");
    }),
    undefined,
  );
});

test("a missing handoff file says how to make one", () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-handoff-"));
  try {
    assert.throws(
      () => resolveHandoff(join(dir, "absent.json"), dir),
      /no handoff file at .*absent\.json — write one with: aether resume export/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
