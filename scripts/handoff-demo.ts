// scripts/handoff-demo.ts — the hero demo, end to end and reproducible.
//
//   npm run demo:handoff
//
// It proves one sentence: **start on one model, continue on another, on another
// machine, and let the tests decide when it is done.**
//
// What the demo does, what is real, what is stubbed, and how to record it are
// documented once in docs/demo/handoff.md — read that, not a second copy here.
// Two things about the CODE that the doc has no reason to mention:
//
//  - runCli MUST NOT use spawnSync. The scripted model is served by this same
//    process, so a synchronous spawn blocks the event loop and the agent's very
//    first request is never answered.
//  - the stub keys its script on the model NAME, which is how session B's
//    prompt gets captured and asserted separately from session A's.
//
// AETHER_DEMO_REAL=1 (optionally with AETHER_DEMO_MODEL_A / _B) runs the
// identical script against real Ollama models instead.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const cli = join(repoRoot, "dist", "src", "main.js");

const REAL = process.env["AETHER_DEMO_REAL"] === "1";
const MODEL_A = process.env["AETHER_DEMO_MODEL_A"] ?? (REAL ? "qwen2.5-coder:7b" : "aether-demo-a");
const MODEL_B = process.env["AETHER_DEMO_MODEL_B"] ?? (REAL ? "qwen3:4b" : "aether-demo-b");
const TEST_CMD = "node --test test/slug.test.js";

// ── the throwaway project ───────────────────────────────────────────────────
// Two assertions, both red at the start. The point of splitting them is that a
// session can legitimately land half-done — which is exactly the state a handoff
// has to carry.

const BROKEN_SOURCE = `export function slugify(input) {
  return input;
}
`;

const HALF_FIXED_SOURCE = `export function slugify(input) {
  return input.toLowerCase().replace(/\\s+/g, "-");
}
`;

const FIXED_SOURCE = `export function slugify(input) {
  return input.trim().toLowerCase().replace(/\\s+/g, "-");
}
`;

const TEST_SOURCE = `import test from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slug.js";

test("lowercases and hyphenates", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("trims surrounding whitespace", () => {
  assert.equal(slugify("  Release Notes  "), "release-notes");
});
`;

const TASK = "make the slugify tests pass";

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
}

/** A fresh checkout of the demo project, with both tests red. */
function makeProject(dir: string): void {
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "test"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "slugify-demo", type: "module", private: true }, null, 2) + "\n");
  writeFileSync(join(dir, "src", "slug.js"), BROKEN_SOURCE);
  writeFileSync(join(dir, "test", "slug.test.js"), TEST_SOURCE);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "demo@aethersystems.net"]);
  git(dir, ["config", "user.name", "Aether Demo"]);
  git(dir, ["remote", "add", "origin", "https://github.com/aether-demo/slugify.git"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "slugify: both cases red"]);
}

// ── the scripted model ──────────────────────────────────────────────────────

interface ScriptedTurn {
  /** Emit this tool call... */
  tool?: { name: string; args: Record<string, unknown> };
  /** ...or this final answer (no tool call ends the turn). */
  content?: string;
}

/** Both sessions run the same four beats — read, rewrite, test, report — so the
 *  script is one shape with two substitutions rather than two blocks to keep
 *  aligned. The determinism of the demo depends on them staying identical. */
const session = (source: string, report: string): ScriptedTurn[] => [
  { tool: { name: "read_file", args: { path: "src/slug.js" } } },
  { tool: { name: "write_file", args: { path: "src/slug.js", content: source } } },
  { tool: { name: "run_tests", args: { command: TEST_CMD } } },
  { content: report },
];

const SCRIPTS: Record<string, ScriptedTurn[]> = {
  [MODEL_A]: session(
    HALF_FIXED_SOURCE,
    "Lowercasing and hyphenation are in. The surrounding-whitespace case is still red.",
  ),
  [MODEL_B]: session(FIXED_SOURCE, "Trimmed the input before slugifying. Both cases pass."),
};

interface StubState {
  /** Turns served, per model. */
  turns: Map<string, number>;
  /** The first user message each model was given — the continuity evidence. */
  firstPrompt: Map<string, string>;
  failures: string[];
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => res(body));
    req.on("error", rej);
  });
}

/** A minimal Ollama-compatible endpoint that replays SCRIPTS. */
function startStub(state: StubState): Promise<{ server: Server; host: string }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        model?: string;
        messages?: Array<{ role: string; content: string }>;
      };
      const model = body.model ?? "";
      const script = SCRIPTS[model];
      if (!script) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no script for model ${model}` }));
        return;
      }
      if (!state.firstPrompt.has(model)) {
        const user = (body.messages ?? []).find((m) => m.role === "user");
        state.firstPrompt.set(model, user?.content ?? "");
      }
      const n = state.turns.get(model) ?? 0;
      state.turns.set(model, n + 1);
      const turn = script[Math.min(n, script.length - 1)]!;
      const message = turn.tool
        ? {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: `call-${model}-${n}`,
                type: "function",
                function: { name: turn.tool.name, arguments: JSON.stringify(turn.tool.args) },
              },
            ],
          }
        : { role: "assistant", content: turn.content ?? "done" };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message }] }));
    })().catch((err: unknown) => {
      state.failures.push(String(err));
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((res) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      res({ server, host: `http://127.0.0.1:${port}` });
    });
  });
}

// ── running the real CLI ────────────────────────────────────────────────────

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI ASYNCHRONOUSLY. This must not be spawnSync: the scripted model
 *  is served by this same process, and a synchronous spawn blocks the event
 *  loop, so the agent's very first request would never be answered. */
function runCli(args: string[], cwd: string, env: Record<string, string>): Promise<RunResult> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => (stdout += c));
    child.stderr.on("data", (c: string) => (stderr += c));
    child.on("error", rej);
    child.on("close", (status) => res({ status: status ?? 1, stdout, stderr }));
  });
}

function testsPass(cwd: string): boolean {
  return spawnSync(process.execPath, ["--test", "test/slug.test.js"], { cwd, encoding: "utf8" }).status === 0;
}

const banner = (text: string): void => {
  process.stdout.write(`\n\x1b[36m── ${text} ${"─".repeat(Math.max(0, 66 - text.length))}\x1b[0m\n`);
};
const say = (text: string): void => {
  process.stdout.write(`   ${text}\n`);
};

async function main(): Promise<number> {
  const root = mkdtempSync(join(tmpdir(), "aether-handoff-demo-"));
  const machineA = join(root, "machine-a", "slugify");
  const machineB = join(root, "machine-b", "slugify");
  const logs = join(root, "logs");
  const config = join(root, "config");
  mkdirSync(logs, { recursive: true });
  mkdirSync(config, { recursive: true });
  // permissionMode "skip" keeps the demo non-interactive without --yes, which
  // would also trigger the interactive repo gate. A private AETHER_CONFIG_DIR
  // means the demo never reads or writes the operator's real config or token.
  writeFileSync(join(config, "config.json"), JSON.stringify({ permissionMode: "skip", backend: "local" }, null, 2) + "\n");

  const state: StubState = { turns: new Map(), firstPrompt: new Map(), failures: [] };
  let server: Server | null = null;
  let ollamaHost = process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
  if (!REAL) {
    const stub = await startStub(state);
    server = stub.server;
    ollamaHost = stub.host;
  }

  // Nothing below varies per call — the CLI child env is fixed once the stub
  // (or the real Ollama host) is known.
  const env: Record<string, string> = {
    AETHER_CONFIG_DIR: config,
    AETHER_LOG_DIR: logs,
    AETHER_BACKEND: "local",
    AETHER_NO_ANIM: "1",
    AETHER_NO_HISTORY: "1",
    OLLAMA_HOST: ollamaHost,
  };

  const problems: string[] = [];
  try {
    banner(`Machine A — ${MODEL_A}${REAL ? "" : " (scripted)"}`);
    makeProject(machineA);
    say(`repo: ${machineA}`);
    say(`task: ${TASK}`);
    const a = await runCli(
      ["agent", "--local", "--model", MODEL_A, "--quiet", "--test-cmd", TEST_CMD, TASK],
      machineA,
      env,
    );
    process.stdout.write(a.stdout);
    process.stdout.write(a.stderr);
    if (!REAL && a.status === 0) problems.push("session A was expected to end RED (half the work done), but exited 0");

    banner("The handoff");
    const handoffFile = join(root, "handoff.json");
    const exported = await runCli(["resume", "export", "--out", handoffFile], machineA, env);
    process.stdout.write(exported.stdout);
    process.stdout.write(exported.stderr);
    if (exported.status !== 0) problems.push("`aether resume export` failed");
    const handoff = JSON.parse(readFileSync(handoffFile, "utf8")) as {
      model?: string;
      finalStatus?: string;
      filesTouched?: string[];
      repo?: { remote?: string };
    };
    say(`carried: model ${handoff.model}, status ${handoff.finalStatus}, ` +
      `files ${JSON.stringify(handoff.filesTouched)}, repo ${handoff.repo?.remote ?? "(none)"}`);

    banner("Moving machines");
    // A different absolute path, from the same origin — the shape a second
    // machine actually has. Machine A is then destroyed: nothing the second run
    // does can be reading its logs, because they are gone.
    mkdirSync(dirname(machineB), { recursive: true });
    cpSync(machineA, machineB, { recursive: true });
    rmSync(machineA, { recursive: true, force: true });
    rmSync(logs, { recursive: true, force: true });
    mkdirSync(logs, { recursive: true });
    say(`repo: ${machineB}`);
    say("machine A's checkout and session logs: deleted");

    banner(`Machine B — ${MODEL_B}${REAL ? "" : " (scripted)"}`);
    say("no task restated; the handoff file is the only context");
    const b = await runCli(
      ["agent", "--local", "--model", MODEL_B, "--quiet", "--test-cmd", TEST_CMD, "--resume", handoffFile],
      machineB,
      env,
    );
    process.stdout.write(b.stdout);
    process.stdout.write(b.stderr);

    banner("Proof");
    // 1. The context crossed — session B's prompt carried the brief.
    const bPrompt = REAL ? "" : (state.firstPrompt.get(MODEL_B) ?? "");
    if (!REAL) {
      for (const needle of ["Continuing a prior Aether Agent session", MODEL_A, "src/slug.js", TASK]) {
        if (!bPrompt.includes(needle)) problems.push(`session B's prompt never mentioned ${JSON.stringify(needle)}`);
      }
      say(`session B's prompt carried the brief (${bPrompt.length} chars), naming ${MODEL_A} and src/slug.js`);
    }
    // 2. The work is actually done — checked here, independently of the agent.
    const green = testsPass(machineB);
    say(`independent test run in ${machineB}: ${green ? "green" : "RED"}`);
    if (!green) problems.push("the demo project's tests are still failing after session B");
    // 3. The CLI's own verify gate agrees.
    if (b.status !== 0) problems.push(`session B exited ${b.status}; the verify gate did not call it done`);
    else say("the verify gate called it done (exit 0)");
    problems.push(...state.failures);
  } finally {
    server?.close();
    rmSync(root, { recursive: true, force: true });
  }

  banner(problems.length ? "FAILED" : "PASSED");
  for (const p of problems) process.stdout.write(`   ✗ ${p}\n`);
  if (!problems.length) {
    process.stdout.write("   One model started it. Another finished it, elsewhere, with no re-pasted context.\n");
    process.stdout.write("   The tests decided when it was done.\n");
  }
  return problems.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(String(err instanceof Error ? (err.stack ?? err.message) : err) + "\n");
    process.exit(1);
  },
);
