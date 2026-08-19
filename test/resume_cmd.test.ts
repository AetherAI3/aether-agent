import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdResume, cmdResumeExport, DEFAULT_HANDOFF_FILE, resumeHint } from "../src/commands/resume.js";
import type { AppContext } from "../src/core/context.js";

test("resumeHint quotes the exact re-entry command", () => {
  assert.equal(
    resumeHint("2026-06-08T12-00-00-000Z-cloud"),
    "session paused — resume with:  aether agent --resume 2026-06-08T12-00-00-000Z-cloud",
  );
});

// `aether resume export` is the machine-to-machine half of resume: it turns the
// local session log into one file you can carry. These tests drive the real
// commands against a seeded log root, capturing stdout/stderr.

function seedSession(root: string, id: string, cwd: string): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      sessionId: id,
      task: "make the parser accept trailing commas",
      model: "qwen3:4b",
      brain: "local",
      cwd,
      started: "2026-08-19T10:00:00.000Z",
      ended: "2026-08-19T10:04:00.000Z",
      finalStatus: "incomplete",
      remaining: 1,
      testCmd: "npm test",
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

function fakeContext(cwd: string): AppContext {
  return {
    cfg: {},
    api: {},
    tokens: {},
    flags: { json: false, audit: false, yes: true, cwd },
    confirm: async () => true,
  } as unknown as AppContext;
}

interface Fixture {
  /** Directory the session log root lives in (AETHER_LOG_DIR). */
  logs: string;
  /** The "workspace" the session belongs to, and the command's cwd. */
  work: string;
  /** Scratch root, for --out targets outside the workspace. */
  root: string;
  ctx: AppContext;
}

/** Run one case against an isolated log root, with stdout/stderr captured.
 *  Everything — temp dirs, the AETHER_LOG_DIR override, both streams — is
 *  restored on the way out, so a failing assertion cannot leak the log root
 *  into every later test in the process. */
function withLogRoot(
  body: (f: Fixture) => number,
  seed: (f: Fixture) => void = () => {},
): { code: number; out: string; err: string } {
  const root = mkdtempSync(join(tmpdir(), "aether-resume-"));
  const logs = join(root, "logs");
  const work = join(root, "work");
  mkdirSync(work, { recursive: true });
  mkdirSync(logs, { recursive: true });
  const previousLogDir = process.env["AETHER_LOG_DIR"];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  process.env["AETHER_LOG_DIR"] = logs;
  const fixture: Fixture = { logs, work, root, ctx: fakeContext(work) };
  try {
    seed(fixture);
    (process.stdout as { write: unknown }).write = (chunk: string): boolean => ((out += chunk), true);
    (process.stderr as { write: unknown }).write = (chunk: string): boolean => ((err += chunk), true);
    try {
      return { code: body(fixture), out, err };
    } finally {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
    }
  } finally {
    if (previousLogDir === undefined) delete process.env["AETHER_LOG_DIR"];
    else process.env["AETHER_LOG_DIR"] = previousLogDir;
    rmSync(root, { recursive: true, force: true });
  }
}

const seedOne = (f: Fixture): void => seedSession(f.logs, "s1", f.work);

test("`aether resume export` writes a handoff next to the work by default", () => {
  let written = "";
  const { code, out } = withLogRoot((f) => {
    written = join(f.work, DEFAULT_HANDOFF_FILE);
    const result = cmdResumeExport(f.ctx, "");
    // Read inside the fixture — the temp tree is removed on the way out.
    if (existsSync(written)) written = readFileSync(written, "utf8");
    return result;
  }, seedOne);
  assert.equal(code, 0);
  const handoff = JSON.parse(written);
  assert.equal(handoff.kind, "aether-agent-handoff");
  assert.equal(handoff.sessionId, "s1");
  assert.equal(handoff.model, "qwen3:4b");
  assert.equal(handoff.remaining, 1);
  assert.equal(handoff.testCmd, "npm test");
  assert.deepEqual(handoff.filesTouched, ["src/parse.ts"]);
  // The command has to tell the user how to spend what it just made.
  assert.match(out, /aether agent --resume/);
});

test("`aether resume export <id> --out <file>` honours the destination", () => {
  let written = "";
  const { code } = withLogRoot((f) => {
    const target = join(f.root, "carried.json");
    const result = cmdResumeExport(f.ctx, "s1", target);
    if (existsSync(target)) written = readFileSync(target, "utf8");
    return result;
  }, seedOne);
  assert.equal(code, 0);
  assert.equal(JSON.parse(written).sessionId, "s1");
});

test("`aether resume export --out` creates a missing parent directory", () => {
  // Atomic writes carry mkdir -p, so `--out reports/handoff.json` works from a
  // clean checkout instead of failing with ENOENT.
  let existed = false;
  const { code } = withLogRoot((f) => {
    const target = join(f.root, "reports", "nested", "carried.json");
    const result = cmdResumeExport(f.ctx, "s1", target);
    existed = existsSync(target);
    return result;
  }, seedOne);
  assert.equal(code, 0);
  assert.equal(existed, true);
});

test("`aether resume export` with no sessions fails loudly rather than writing an empty file", () => {
  let leftBehind = true;
  const { code, err } = withLogRoot((f) => {
    const result = cmdResumeExport(f.ctx, "");
    leftBehind = existsSync(join(f.work, DEFAULT_HANDOFF_FILE));
    return result;
  });
  assert.equal(code, 1);
  assert.match(err, /no sessions to resume/);
  assert.equal(leftBehind, false);
});

test("`aether resume` replay points at both re-entry routes", () => {
  const { code, out } = withLogRoot((f) => cmdResume(f.ctx, ""), seedOne);
  assert.equal(code, 0);
  assert.match(out, /the tokenizer rejects it/);
  assert.match(out, /aether agent --resume s1/);
  assert.match(out, /aether resume export s1/);
});

test("an unknown session id is reported, not swallowed", () => {
  const { code, err } = withLogRoot((f) => cmdResume(f.ctx, "no-such-session"), seedOne);
  assert.equal(code, 1);
  assert.match(err, /no such session/);
});
