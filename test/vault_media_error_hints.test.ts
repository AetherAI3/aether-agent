// Regression tests for LOOP-01 round 2 (media.ts:233-235 / media.ts:208-209 /
// vault.ts:276 / slash_media.ts's 9 catch blocks).
//
// core/vault.ts and core/vision.ts already throw a properly-classified
// HttpError for every non-2xx response (see test/vault_vision_401.test.ts and
// test/auth_401.test.ts) — but the *command layer* never routed that
// classification through errorHint()/hintFor(). vault.ts's fail() and
// media.ts's fail() printed the SAME hardcoded "are you logged in?" hint
// regardless of the actual status; media.ts's mediaGenerate() and every catch
// block in slash_media.ts printed only the raw err.message with no hint at
// all. These tests confirm a 401/402/403/5xx each now render the distinct,
// already-implemented hint from core/error_hints.ts's hintFor(), matching the
// fix already applied to workflow.ts's `workflowNew` (see auth_401.test.ts /
// error_hints.test.ts for the underlying hintFor contract).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { ApiClient, MODELS_PATH } from "../src/core/transport.js";
import { StaticTokenStore } from "../src/core/auth.js";
import type { AppContext } from "../src/core/context.js";
import { cmdVault } from "../src/commands/vault.js";
import { cmdImage } from "../src/commands/media.js";
import { photogenSlash } from "../src/commands/slash_media.js";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(handler: (url: string) => Response): void {
  globalThis.fetch = (async (url: unknown) => handler(String(url))) as typeof globalThis.fetch;
}

function fakeCtx(api: ApiClient): AppContext {
  return {
    cfg: { baseUrl: "https://api.example" },
    api,
    tokens: new StaticTokenStore("aek_test"),
    flags: { cwd: process.cwd(), json: false, audit: false, yes: false },
    confirm: async () => true,
  } as unknown as AppContext;
}

function captureWrite(stream: NodeJS.WriteStream): { get: () => string; restore: () => void } {
  const orig = stream.write.bind(stream);
  let buf = "";
  stream.write = ((chunk: unknown): boolean => {
    buf += String(chunk);
    return true;
  }) as typeof stream.write;
  return { get: () => buf, restore: () => { stream.write = orig; } };
}

// mediaGenerate/photogenSlash both call ensureOutputDir() unconditionally
// before dispatching, which mkdir's "./aether-output" relative to cwd as a
// side effect of the code under test (not something these tests add) — clean
// it up afterward so the test run doesn't leave it behind in the repo root.
function cleanupOutputDir(): void {
  rmSync(join(process.cwd(), "aether-output"), { recursive: true, force: true });
}

// ── vault.ts's fail() ───────────────────────────────────────────────────

test("cmdVault: a 402 (out of UVT balance) shows the balance hint, not 'are you logged in?'", async () => {
  const real = globalThis.fetch;
  stubFetch(() => jsonRes(402, { detail: "insufficient balance" }));
  const cap = captureWrite(process.stderr);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    const code = await cmdVault(fakeCtx(api), ["list"]);
    assert.equal(code, 1);
    assert.match(cap.get(), /UVT|balance/i);
    assert.doesNotMatch(cap.get(), /are you logged in/);
  } finally {
    cap.restore();
    globalThis.fetch = real;
  }
});

test("cmdVault: a 403 (plan/tier) shows the plan/tier hint, not 'are you logged in?'", async () => {
  const real = globalThis.fetch;
  stubFetch(() => jsonRes(403, { detail: "forbidden" }));
  const cap = captureWrite(process.stderr);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    const code = await cmdVault(fakeCtx(api), ["list"]);
    assert.equal(code, 1);
    assert.match(cap.get(), /plan|tier/i);
    assert.doesNotMatch(cap.get(), /are you logged in/);
  } finally {
    cap.restore();
    globalThis.fetch = real;
  }
});

test("cmdVault: a 401 still shows the auth-login hint (unchanged for this status)", async () => {
  const real = globalThis.fetch;
  stubFetch(() => jsonRes(401, { detail: "expired" }));
  const cap = captureWrite(process.stderr);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    await cmdVault(fakeCtx(api), ["list"]);
    assert.match(cap.get(), /aether auth login/);
  } finally {
    cap.restore();
    globalThis.fetch = real;
  }
});

test("cmdVault: a 5xx shows a retry/connectivity hint, not the auth-login hint", async () => {
  const real = globalThis.fetch;
  stubFetch(() => jsonRes(500, { detail: "server error" }));
  const cap = captureWrite(process.stderr);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    await cmdVault(fakeCtx(api), ["list"]);
    assert.match(cap.get(), /retry|doctor/i);
    assert.doesNotMatch(cap.get(), /are you logged in/);
  } finally {
    cap.restore();
    globalThis.fetch = real;
  }
});

// ── media.ts's fail() (mediaModelsList) ──────────────────────────────────

test("cmdImage models: a 402 shows the balance hint via fail(), not 'are you logged in?'", async () => {
  const real = globalThis.fetch;
  stubFetch((url) => (url.endsWith(MODELS_PATH) ? jsonRes(402, { detail: "insufficient balance" }) : jsonRes(404, {})));
  const cap = captureWrite(process.stderr);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    const code = await cmdImage(fakeCtx(api), ["models"]);
    assert.equal(code, 1);
    assert.match(cap.get(), /UVT|balance/i);
    assert.doesNotMatch(cap.get(), /are you logged in/);
  } finally {
    cap.restore();
    globalThis.fetch = real;
  }
});

// ── media.ts's mediaGenerate inline catch ────────────────────────────────

test("cmdImage generate: a 403 from dispatchGeneration prints the plan/tier hint to stdout", async () => {
  const real = globalThis.fetch;
  stubFetch(() => jsonRes(403, { detail: "forbidden" }));
  const cap = captureWrite(process.stdout);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    const code = await cmdImage(fakeCtx(api), ["a", "cat", "wearing", "a", "hat"]);
    assert.equal(code, 0); // mediaGenerate always returns 0 — per-item failures are printed inline
    assert.match(cap.get(), /plan|tier/i);
    assert.doesNotMatch(cap.get(), /are you logged in/);
  } finally {
    cap.restore();
    globalThis.fetch = real;
    cleanupOutputDir();
  }
});

// ── slash_media.ts's writeErr() ──────────────────────────────────────────

test("photogenSlash: a 402 from dispatchGeneration writes the balance hint to the slash output stream", async () => {
  const real = globalThis.fetch;
  stubFetch(() => jsonRes(402, { detail: "insufficient balance" }));
  let out = "";
  const writable = { write: (chunk: unknown) => { out += String(chunk); return true; } } as unknown as Writable;
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    await photogenSlash(fakeCtx(api), writable, "a cat wearing a hat", false);
    assert.match(out, /UVT|balance/i);
    assert.doesNotMatch(out, /are you logged in/);
  } finally {
    globalThis.fetch = real;
    cleanupOutputDir();
  }
});

test("photogenSlash: a 5xx writes a retry/connectivity hint, not a bare message", async () => {
  const real = globalThis.fetch;
  stubFetch(() => jsonRes(503, { detail: "unavailable" }));
  let out = "";
  const writable = { write: (chunk: unknown) => { out += String(chunk); return true; } } as unknown as Writable;
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    await photogenSlash(fakeCtx(api), writable, "a cat wearing a hat", false);
    assert.match(out, /retry|doctor/i);
  } finally {
    globalThis.fetch = real;
    cleanupOutputDir();
  }
});
