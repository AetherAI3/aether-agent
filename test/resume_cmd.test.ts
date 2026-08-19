import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdResume, DEFAULT_HANDOFF_FILE, resumeHint } from "../src/commands/resume.js";
import type { AppContext } from "../src/core/context.js";

test("resumeHint quotes the exact re-entry command", () => {
  assert.equal(
    resumeHint("2026-06-08T12-00-00-000Z-cloud"),
    "session paused — resume with:  aether agent --resume 2026-06-08T12-00-00-000Z-cloud",
  );
});

// `aether resume export` is the machine-to-machine half of resume: it turns the
// local session log into one file you can carry. These tests drive the real
// command against a seeded log root, capturing stdout/stderr.

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

/** Run one command with stdout/stderr captured. */
async function capture(run: () => Promise<number>): Promise<{ code: number; out: string; err: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: string): boolean => ((out += chunk), true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: string): boolean => ((err += chunk), true);
  try {
    const code = await run();
    return { code, out, err };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

test("`aether resume export` writes a handoff next to the work by default", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-resume-"));
  const logs = join(root, "logs");
  const work = join(root, "work");
  mkdirSync(work, { recursive: true });
  const previous = process.env["AETHER_LOG_DIR"];
  process.env["AETHER_LOG_DIR"] = logs;
  try {
    seedSession(logs, "s1", work);
    const { code, out } = await capture(() => cmdResume(fakeContext(work), "export"));
    assert.equal(code, 0);
    const written = join(work, DEFAULT_HANDOFF_FILE);
    assert.ok(existsSync(written), "handoff file was written");
    const handoff = JSON.parse(readFileSync(written, "utf8"));
    assert.equal(handoff.kind, "aether-agent-handoff");
    assert.equal(handoff.sessionId, "s1");
    assert.equal(handoff.model, "qwen3:4b");
    assert.equal(handoff.remaining, 1);
    assert.equal(handoff.testCmd, "npm test");
    assert.deepEqual(handoff.filesTouched, ["src/parse.ts"]);
    // The command has to tell the user how to spend what it just made.
    assert.match(out, /aether agent --resume/);
  } finally {
    if (previous === undefined) delete process.env["AETHER_LOG_DIR"];
    else process.env["AETHER_LOG_DIR"] = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("`aether resume export <id> --out <file>` honours the destination", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-resume-"));
  const logs = join(root, "logs");
  const work = join(root, "work");
  mkdirSync(work, { recursive: true });
  const previous = process.env["AETHER_LOG_DIR"];
  process.env["AETHER_LOG_DIR"] = logs;
  try {
    seedSession(logs, "s1", work);
    const target = join(root, "carried.json");
    const { code } = await capture(() => cmdResume(fakeContext(work), "export s1", target));
    assert.equal(code, 0);
    assert.equal(JSON.parse(readFileSync(target, "utf8")).sessionId, "s1");
  } finally {
    if (previous === undefined) delete process.env["AETHER_LOG_DIR"];
    else process.env["AETHER_LOG_DIR"] = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("`aether resume export` with no sessions fails loudly rather than writing an empty file", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-resume-"));
  const logs = join(root, "logs");
  const work = join(root, "work");
  mkdirSync(work, { recursive: true });
  mkdirSync(logs, { recursive: true });
  const previous = process.env["AETHER_LOG_DIR"];
  process.env["AETHER_LOG_DIR"] = logs;
  try {
    const { code, err } = await capture(() => cmdResume(fakeContext(work), "export"));
    assert.equal(code, 1);
    assert.match(err, /no sessions to resume/);
    assert.equal(existsSync(join(work, DEFAULT_HANDOFF_FILE)), false);
  } finally {
    if (previous === undefined) delete process.env["AETHER_LOG_DIR"];
    else process.env["AETHER_LOG_DIR"] = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("`aether resume` replay points at both re-entry routes", async () => {
  const root = mkdtempSync(join(tmpdir(), "aether-resume-"));
  const logs = join(root, "logs");
  const work = join(root, "work");
  mkdirSync(work, { recursive: true });
  const previous = process.env["AETHER_LOG_DIR"];
  process.env["AETHER_LOG_DIR"] = logs;
  try {
    seedSession(logs, "s1", work);
    const { code, out } = await capture(() => cmdResume(fakeContext(work), ""));
    assert.equal(code, 0);
    assert.match(out, /the tokenizer rejects it/);
    assert.match(out, /aether agent --resume s1/);
    assert.match(out, /aether resume export s1/);
  } finally {
    if (previous === undefined) delete process.env["AETHER_LOG_DIR"];
    else process.env["AETHER_LOG_DIR"] = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
