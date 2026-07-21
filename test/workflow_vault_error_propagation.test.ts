// Regression tests for LOOP-01 round 3 (src/core/workflow.ts:322-351).
//
// listWorkflows/getWorkflow/deleteWorkflow used to wrap listSpaces/
// getSpacesContent/deleteSpacesFile (vault.ts) in a catch-all that turned
// EVERY failure -- an expired session (401), a network outage, or a 5xx --
// into an empty list / null / false. The command layer (cmdWorkflow) then
// reported that as a legitimate "no data" state: "No workflows found in
// vault.", "workflow not found: <name>", "delete failed -- workflow may not
// exist" -- with zero indication to run `aether auth login`.
//
// listSpaces/getSpacesContent/deleteSpacesFile never throw for a genuinely
// empty vault or a file with no content (they resolve with `files: []` /
// `content: null`) -- so a thrown error from them is always a REAL failure.
// The fix removes the swallowing catches so it propagates to cmdWorkflow's
// own try/catch (which already calls fail(err)).
//
// These tests assert:
//   1. A 401 from list/view/delete surfaces "aether auth login" via fail(),
//      not the old ambiguous "no data" messages.
//   2. A genuinely empty vault (200, `files: []`) still correctly prints
//      "No workflows found in vault." -- confirming the fix didn't turn the
//      legitimate empty case into a false failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiClient,
  VAULT_SPACES_LIST_PATH,
  VAULT_SPACES_CONTENT_PATH,
  VAULT_SPACES_DELETE_PATH,
} from "../src/core/transport.js";
import { StaticTokenStore } from "../src/core/auth.js";
import type { AppContext } from "../src/core/context.js";
import { cmdWorkflow } from "../src/commands/workflow.js";

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

// ── listWorkflows / workflowList ─────────────────────────────────────────

test("cmdWorkflow list: a 401 from listSpaces surfaces 'aether auth login', not 'No workflows found'", async () => {
  const real = globalThis.fetch;
  stubFetch((url) => (url.includes(VAULT_SPACES_LIST_PATH) ? jsonRes(401, { detail: "expired" }) : jsonRes(404, {})));
  const cap = captureWrite(process.stderr);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    const code = await cmdWorkflow(fakeCtx(api), ["list"]);
    assert.equal(code, 1);
    assert.match(cap.get(), /aether auth login/);
    assert.doesNotMatch(cap.get(), /No workflows found/);
  } finally {
    cap.restore();
    globalThis.fetch = real;
  }
});

test("cmdWorkflow list: a genuinely empty vault (200, files: []) still prints 'No workflows found in vault.'", async () => {
  const real = globalThis.fetch;
  stubFetch((url) => (url.includes(VAULT_SPACES_LIST_PATH) ? jsonRes(200, { success: true, files: [], count: 0 }) : jsonRes(404, {})));
  const cap = captureWrite(process.stdout);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    const code = await cmdWorkflow(fakeCtx(api), ["list"]);
    assert.equal(code, 0);
    assert.match(cap.get(), /No workflows found in vault\./);
  } finally {
    cap.restore();
    globalThis.fetch = real;
  }
});

// ── getWorkflow / workflowView ───────────────────────────────────────────

test("cmdWorkflow view: a 401 from getSpacesContent surfaces 'aether auth login', not 'workflow not found'", async () => {
  const real = globalThis.fetch;
  stubFetch((url) => (url.includes(VAULT_SPACES_CONTENT_PATH) ? jsonRes(401, { detail: "expired" }) : jsonRes(404, {})));
  const cap = captureWrite(process.stderr);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    const code = await cmdWorkflow(fakeCtx(api), ["view", "my-flow"]);
    assert.equal(code, 1);
    assert.match(cap.get(), /aether auth login/);
    assert.doesNotMatch(cap.get(), /workflow not found/);
  } finally {
    cap.restore();
    globalThis.fetch = real;
  }
});

// ── deleteWorkflow / workflowDelete ──────────────────────────────────────

test("cmdWorkflow delete: a 401 from deleteSpacesFile surfaces 'aether auth login', not 'delete failed'", async () => {
  const real = globalThis.fetch;
  stubFetch((url) => (url.includes(VAULT_SPACES_DELETE_PATH) ? jsonRes(401, { detail: "expired" }) : jsonRes(404, {})));
  const cap = captureWrite(process.stderr);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    const code = await cmdWorkflow(fakeCtx(api), ["delete", "my-flow"]);
    assert.equal(code, 1);
    assert.match(cap.get(), /aether auth login/);
    assert.doesNotMatch(cap.get(), /delete failed/);
  } finally {
    cap.restore();
    globalThis.fetch = real;
  }
});

// ── getWorkflow / workflowSave ────────────────────────────────────────────
// workflowSave's `else if (name)` branch calls getWorkflow BEFORE its own
// try block starts (the try only wraps the later saveWorkflow call) — a real
// failure here must be caught locally or it escapes cmdWorkflow entirely and
// hits main.ts's bare top-level catch (no hint at all), a regression this
// asserts against directly.
test("cmdWorkflow save <existing-name>: a 401 from getSpacesContent surfaces 'aether auth login' via fail(), not a bare unhinted error", async () => {
  const real = globalThis.fetch;
  stubFetch((url) => (url.includes(VAULT_SPACES_CONTENT_PATH) ? jsonRes(401, { detail: "expired" }) : jsonRes(404, {})));
  const cap = captureWrite(process.stderr);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    const code = await cmdWorkflow(fakeCtx(api), ["save", "my-flow"]);
    assert.equal(code, 1);
    assert.match(cap.get(), /aether auth login/);
  } finally {
    cap.restore();
    globalThis.fetch = real;
  }
});

// ── 5xx / network outage also propagate instead of masquerading as "no data" ──

test("cmdWorkflow list: a 500 from listSpaces surfaces via fail(), not 'No workflows found'", async () => {
  const real = globalThis.fetch;
  stubFetch((url) => (url.includes(VAULT_SPACES_LIST_PATH) ? jsonRes(500, { detail: "server error" }) : jsonRes(404, {})));
  const cap = captureWrite(process.stderr);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    const code = await cmdWorkflow(fakeCtx(api), ["list"]);
    assert.equal(code, 1);
    assert.doesNotMatch(cap.get(), /No workflows found/);
  } finally {
    cap.restore();
    globalThis.fetch = real;
  }
});
