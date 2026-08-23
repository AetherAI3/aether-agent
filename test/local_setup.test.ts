import { test } from "node:test";
import assert from "node:assert/strict";
import type { AppContext } from "../src/core/context.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import {
  LOCAL_EXIT,
  cmdLocal,
  cmdSetup,
  type LocalProcessResult,
  type LocalRuntimeDeps,
} from "../src/commands/local.js";
import { localModelId, normalizeOllamaTag, ollamaTagFromId, resolveLocalModel } from "../src/core/local_ollama.js";

function context(overrides: Partial<AppContext["flags"]> = {}, token: string | null = null): AppContext {
  return {
    cfg: { ...DEFAULT_CONFIG },
    api: {} as AppContext["api"],
    tokens: { get: async () => token, set: async () => {}, clear: async () => {} },
    flags: { json: false, audit: false, yes: false, cwd: process.cwd(), ...overrides },
    confirm: async () => false,
  };
}

function okRun(stdout = "ollama version 1.0.0\n"): LocalProcessResult {
  return { status: 0, stdout, stderr: "" };
}

function deps(overrides: Partial<LocalRuntimeDeps> = {}): LocalRuntimeDeps {
  return {
    run: () => okRun(),
    requestTags: async () => ({ models: [{ name: "qwen2.5-coder:7b" }, { name: "gemma3:4b" }] }),
    save: () => {},
    ...overrides,
  };
}

async function capture(run: () => Promise<number>): Promise<{ code: number; stdout: string; stderr: string }> {
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: unknown) => ((stdout += String(chunk)), true)) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => ((stderr += String(chunk)), true)) as typeof process.stderr.write;
  try {
    return { code: await run(), stdout, stderr };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

test("local ids are namespaced and hosted defaults never become Ollama tags", () => {
  assert.equal(localModelId("qwen2.5-coder:7b"), "ollama:qwen2.5-coder:7b");
  assert.equal(ollamaTagFromId("ollama:gemma3:4b"), "gemma3:4b");
  assert.equal(ollamaTagFromId("gpt-5.6-sol"), null);
  assert.equal(resolveLocalModel(undefined, "gpt-5.6-sol"), "qwen2.5-coder:7b");
  assert.equal(resolveLocalModel(undefined, "ollama:gemma3:4b"), "gemma3:4b");
  assert.equal(resolveLocalModel("legacy-bare:7b", "gpt-5.6-sol"), "legacy-bare:7b");
  assert.throws(() => resolveLocalModel("ollama:", ""));
  assert.throws(() => normalizeOllamaTag("--bad"));
  assert.throws(() => normalizeOllamaTag("bad tag"));
});

test("signed-out doctor normalizes OLLAMA_HOST and never emits a credential", async () => {
  const previous = process.env["OLLAMA_HOST"];
  process.env["OLLAMA_HOST"] = "0.0.0.0:11434/";
  try {
    const result = await capture(() => cmdLocal(context({}, "top-secret-token"), ["doctor"], {}, deps()));
    assert.equal(result.code, LOCAL_EXIT.ok);
    assert.match(result.stdout, /http:\/\/127\.0\.0\.1:11434/);
    assert.match(result.stdout, /hosted auth\s+signed-in/);
    assert.doesNotMatch(result.stdout + result.stderr, /top-secret-token/);
  } finally {
    if (previous === undefined) delete process.env["OLLAMA_HOST"];
    else process.env["OLLAMA_HOST"] = previous;
  }
});

test("doctor and mutation plans strip terminal control bytes from saved labels", async () => {
  const ctx = context({ yes: true });
  ctx.cfg.backend = "cloud\u001b[31m" as typeof ctx.cfg.backend;
  ctx.cfg.defaultModel = "hosted\u001b[2J";
  const doctor = await capture(() => cmdLocal(ctx, ["doctor"], {}, deps()));
  assert.equal(doctor.code, LOCAL_EXIT.ok);
  assert.doesNotMatch(doctor.stdout + doctor.stderr, /\u001b/);
  const use = await capture(() => cmdLocal(ctx, ["use", "gemma3:4b"], {}, deps()));
  assert.equal(use.code, LOCAL_EXIT.ok);
  assert.doesNotMatch(use.stdout + use.stderr, /\u001b/);
});

test("doctor has stable exit codes for absent binary, down server, empty and missing selection", async () => {
  const absent = await capture(() => cmdLocal(context(), ["doctor"], {}, deps({
    run: () => ({ status: null, stdout: "", stderr: "", errorCode: "ENOENT" }),
  })));
  assert.equal(absent.code, LOCAL_EXIT.binaryAbsent);
  assert.match(absent.stderr, /Install Ollama/);

  const down = await capture(() => cmdLocal(context(), ["doctor"], {}, deps({
    requestTags: async () => { throw new Error("ECONNREFUSED"); },
  })));
  assert.equal(down.code, LOCAL_EXIT.serverDown);

  const empty = await capture(() => cmdLocal(context(), ["doctor"], {}, deps({
    requestTags: async () => ({ models: [] }),
  })));
  assert.equal(empty.code, LOCAL_EXIT.emptyModels);

  const missingCtx = context();
  missingCtx.cfg.localModel = "ollama:missing:7b";
  const missing = await capture(() => cmdLocal(missingCtx, ["doctor"], {}, deps()));
  assert.equal(missing.code, LOCAL_EXIT.selectedMissing);
  assert.match(missing.stderr, /local pull missing:7b/);
});

test("timeout, malformed response, and invalid host are distinct failures", async () => {
  const timeout = await capture(() => cmdLocal(context(), ["doctor"], {}, deps({
    requestTags: async () => { const error = new Error("request timed out"); error.name = "AbortError"; throw error; },
  })));
  assert.equal(timeout.code, LOCAL_EXIT.timeout);

  const binaryTimeout = await capture(() => cmdLocal(context(), ["doctor"], {}, deps({
    run: () => ({ status: null, stdout: "", stderr: "", timedOut: true, errorCode: "ETIMEDOUT" }),
  })));
  assert.equal(binaryTimeout.code, LOCAL_EXIT.timeout);
  assert.match(binaryTimeout.stderr, /binary check timed out/);

  const malformed = await capture(() => cmdLocal(context(), ["doctor"], {}, deps({
    requestTags: async () => ({ models: [{ nope: "name" }] }),
  })));
  assert.equal(malformed.code, LOCAL_EXIT.malformedResponse);

  const previous = process.env["OLLAMA_HOST"];
  process.env["OLLAMA_HOST"] = "file:///tmp/socket";
  try {
    const badHost = await capture(() => cmdLocal(context(), ["doctor"], {}, deps()));
    assert.equal(badHost.code, LOCAL_EXIT.malformedResponse);
    assert.match(badHost.stderr, /unsupported scheme/);
  } finally {
    if (previous === undefined) delete process.env["OLLAMA_HOST"];
    else process.env["OLLAMA_HOST"] = previous;
  }
});

test("models and use return actionable server and empty-model errors", async () => {
  const down = await capture(() => cmdLocal(context(), ["models"], {}, deps({
    requestTags: async () => { throw new Error("ECONNREFUSED"); },
  })));
  assert.equal(down.code, LOCAL_EXIT.serverDown);
  assert.match(down.stderr, /server is down/);

  const empty = await capture(() => cmdLocal(context({ yes: true }), ["use", "gemma3:4b"], {}, deps({
    requestTags: async () => ({ models: [] }),
  })));
  assert.equal(empty.code, LOCAL_EXIT.emptyModels);
  assert.match(empty.stderr, /No local models/);
});

test("local use shows a plan, requires approval, writes a namespaced id, and never switches backend", async () => {
  const ctx = context();
  ctx.cfg.backend = "cloud";
  ctx.cfg.defaultModel = "gpt-5.6-sol";
  let saves = 0;
  const declined = await capture(() => cmdLocal(ctx, ["use", "gemma3:4b"], {}, deps({ save: () => { saves += 1; } })));
  assert.equal(declined.code, LOCAL_EXIT.declined);
  assert.match(declined.stderr, /Plan/);
  assert.equal(saves, 0);
  assert.equal(ctx.cfg.localModel, "");

  ctx.flags.yes = true;
  const accepted = await capture(() => cmdLocal(ctx, ["use", "gemma3:4b"], {}, deps({ save: () => { saves += 1; } })));
  assert.equal(accepted.code, LOCAL_EXIT.ok);
  assert.equal(ctx.cfg.localModel, "ollama:gemma3:4b");
  assert.equal(ctx.cfg.defaultModel, "gpt-5.6-sol");
  assert.equal(ctx.cfg.backend, "cloud");
  assert.equal(saves, 1);
  assert.match(accepted.stdout, /Backend was not changed/);
});

test("local pull uses argv-only runner, displays plan, and does not download without approval", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const fake = deps({
    run: (command, args) => {
      calls.push({ command, args });
      return okRun();
    },
  });
  const ctx = context();
  const declined = await capture(() => cmdLocal(ctx, ["pull", "qwen2.5-coder:7b"], {}, fake));
  assert.equal(declined.code, LOCAL_EXIT.declined);
  assert.deepEqual(calls, []);
  assert.match(declined.stderr, /may download model data/);

  ctx.flags.yes = true;
  const accepted = await capture(() => cmdLocal(ctx, ["pull", "qwen2.5-coder:7b"], {}, fake));
  assert.equal(accepted.code, LOCAL_EXIT.ok);
  assert.deepEqual(calls, [
    { command: "ollama", args: ["--version"] },
    { command: "ollama", args: ["pull", "qwen2.5-coder:7b"] },
  ]);
  assert.match(accepted.stdout, /Selection and backend were not changed/);
});

test("setup is explicitly local and remains read-only", async () => {
  const noFlag = await capture(() => cmdSetup(context(), [], {}, deps()));
  assert.equal(noFlag.code, LOCAL_EXIT.usage);
  assert.match(noFlag.stderr, /setup --local/);

  let saves = 0;
  const ready = await capture(() => cmdSetup(context({ local: true }), [], {}, deps({ save: () => { saves += 1; } })));
  assert.equal(ready.code, LOCAL_EXIT.ok);
  assert.equal(saves, 0);
  assert.match(ready.stdout, /aether agent --local/);
});
