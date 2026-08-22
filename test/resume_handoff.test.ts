// Continuing a LOCAL session and importing a PORTABLE HANDOFF are different
// acts, and the charter requires them to be visibly different. A local session
// is keyed to one absolute directory and carries a transcript; a handoff is
// keyed to none and never carried one. These tests pin that the two screens
// cannot be mistaken for each other, and that a handoff is never described as
// belonging to a checkout it was never keyed to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdResume, cmdResumeHandoff } from "../src/commands/resume.js";
import { handoffEntry, HANDOFF_KIND, HANDOFF_SCHEMA_VERSION, type Handoff } from "../src/core/handoff.js";
import { continuityHeader, provenanceLine } from "../src/ui/continuity.js";
import { stripAnsi } from "../src/ui/theme.js";
import type { AppContext } from "../src/core/context.js";

function handoff(over: Partial<Handoff> = {}): Handoff {
  return {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    kind: HANDOFF_KIND,
    sessionId: "2026-08-19T10-00-00-000Z-local-1",
    task: "make the parser accept trailing commas",
    model: "qwen3:4b",
    brain: "local",
    started: "2026-08-19T10:00:00.000Z",
    ended: "2026-08-19T10:04:00.000Z",
    finalStatus: "incomplete",
    remaining: 1,
    repo: { remote: "git@github.com:AetherAI3/aether-agent.git", branch: "feature/parser" },
    highlights: ["stage: execute", "the tokenizer rejects it"],
    filesTouched: ["src/parse.ts", "test/parse.test.ts"],
    testCmd: "npm test",
    ...over,
  };
}

/** Capture process.stdout/stderr for one call. The commands write straight to
 *  the process streams, so this is what proving their output requires. */
function capture(body: () => number): { code: number; out: string; err: string } {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  (process.stdout as { write: unknown }).write = (chunk: string) => ((out += chunk), true);
  (process.stderr as { write: unknown }).write = (chunk: string) => ((err += chunk), true);
  try {
    return { code: body(), out, err };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
  }
}

function ctxFor(cwd: string): AppContext {
  return {
    cfg: {} as AppContext["cfg"],
    api: {} as AppContext["api"],
    tokens: {} as AppContext["tokens"],
    flags: { json: false, audit: false, yes: false, cwd },
    confirm: async () => true,
  };
}

function withRoot(body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "aether-handoff-"));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a handoff row carries no workspace, because a handoff is keyed to none", () => {
  const entry = handoffEntry(handoff());
  assert.equal(entry.workspace, "", "inventing a checkout here is exactly the bug");
  assert.equal(entry.workspaceFingerprint, "");
  assert.equal(entry.branch, "feature/parser");
  assert.equal(entry.repoRemote, "git@github.com:AetherAI3/aether-agent.git");
  assert.equal(entry.filesTouched, 2, "the handoff carries the paths, so the count is exact");
  assert.equal(entry.finalStatus, "incomplete", "the prior verdict is quoted, never upgraded");
});

test("the header says which of the two things you are holding", () => {
  const entry = handoffEntry(handoff());
  const imported = stripAnsi(
    continuityHeader({ kind: "handoff", entry, source: "./aether-handoff.json" }).join("\n"),
  );
  assert.match(imported, /imported handoff from \.\/aether-handoff\.json/);
  assert.match(imported, /not workspace-scoped/);
  assert.ok(!/local session/.test(imported));

  const local = stripAnsi(continuityHeader({ kind: "local", entry, state: "ready" }).join("\n"));
  assert.match(local, /local session · continues here/);
  assert.ok(!/imported handoff/.test(local), "the two provenances are never both claimed");
});

test("an imported handoff is never given a continuity state it cannot have", () => {
  // No `state` at all for the handoff kind: "ready" or "elsewhere" would be an
  // answer about a checkout the file was never keyed to.
  const line = provenanceLine({ kind: "handoff", entry: handoffEntry(handoff()), source: "h.json" });
  assert.ok(!/continues here|another project|not on this disk/.test(line));
});

test("`aether resume <file>` shows the handoff, its files and its steps", () =>
  withRoot((root) => {
    const file = join(root, "aether-handoff.json");
    writeFileSync(file, JSON.stringify(handoff()));
    const { code, out } = capture(() => cmdResume(ctxFor(root), file));
    assert.equal(code, 0);
    const plain = stripAnsi(out);
    assert.match(plain, /imported handoff from/);
    assert.match(plain, /src\/parse\.ts/);
    assert.match(plain, /the tokenizer rejects it/);
    assert.match(plain, /1 test\(s\) still failing/);
    assert.ok(plain.includes(`aether agent --resume ${file}`));
  }));

test("a bare session id still takes the local path, not the file path", () =>
  withRoot((root) => {
    // There is no such session, so this must fail as a SESSION lookup — proof
    // the two branches partition on the loader's own rule rather than guessing.
    const { code, err } = capture(() => cmdResume(ctxFor(root), "2026-08-19T10-00-00-000Z-local-1"));
    assert.equal(code, 1);
    assert.ok(!/handoff/.test(err), `a missing session is not reported as a missing file: ${err}`);
  }));

test("a handoff file that is not one is refused with a remediation", () =>
  withRoot((root) => {
    const file = join(root, "nope.json");
    writeFileSync(file, JSON.stringify({ hello: "world" }));
    const { code, err } = capture(() => cmdResumeHandoff(file));
    assert.equal(code, 1);
    assert.match(err, /not an Aether Agent handoff file/);

    const missing = capture(() => cmdResumeHandoff(join(root, "absent.json")));
    assert.equal(missing.code, 1);
    assert.match(missing.err, /aether resume export/, "it names the command that writes one");
  }));

test("a handoff from a newer schema is refused rather than half-read", () =>
  withRoot((root) => {
    const file = join(root, "future.json");
    writeFileSync(file, JSON.stringify({ ...handoff(), schemaVersion: HANDOFF_SCHEMA_VERSION + 1 }));
    const { code, err } = capture(() => cmdResumeHandoff(file));
    assert.equal(code, 1);
    assert.match(err, /newer Aether Agent/);
  }));

test("terminal escapes inside a handoff never reach the screen", () =>
  withRoot((root) => {
    const file = join(root, "hostile.json");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        handoff({
          task: "fix \u001b[31mthe parser\u001b]0;pwned\u0007",
          highlights: ["\u001b[2Jcleared your screen"],
        }),
      ),
    );
    const { code, out } = capture(() => cmdResumeHandoff(file));
    assert.equal(code, 0);
    // theme colours are stripped first; anything left would be the file's own.
    assert.ok(!stripAnsi(out).includes("\u001b"));
    assert.match(stripAnsi(out), /fix the parser/);
  }));

test("a file count that hit the handoff's bound is not reported as the total", () => {
  // summarizeEvents stops adding at MAX_FILES and parseHandoff slices to it
  // again, so a run that wrote far more arrives carrying exactly the bound.
  // Printing that number would be a confident wrong answer.
  const capped = handoffEntry(handoff({ filesTouched: Array.from({ length: 60 }, (_, i) => `src/f${i}.ts`) }));
  assert.equal(capped.filesTouched, undefined, "at the bound the count is unknown, not 60");
  assert.match(stripAnsi(continuityHeader({ kind: "handoff", entry: capped }).join("\n")), /written {3}unknown/);

  const exact = handoffEntry(handoff({ filesTouched: ["a.ts", "b.ts", "c.ts"] }));
  assert.equal(exact.filesTouched, 3, "below the bound the count is real and is shown");
});
