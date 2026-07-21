// Regression tests for LOOP-01 round 3 (workflow.ts:389-391).
//
// workflow.ts's own local fail() helper hardcoded "are you logged in? run:
// aether auth login" as the hint for EVERY error type across all 11 of its
// call sites (workflowList/View/Delete/Save/Export/Import/Assess/Brainstorm/
// Plan/Finalize/Status) — the exact anti-pattern already eliminated from
// vault.ts's and media.ts's fail() helpers in LOOP-01 round 2 (see
// vault_media_error_hints.test.ts). A 402 (out-of-balance), 403
// (tier-locked), or 5xx from any of those subcommands showed the misleading
// "are you logged in?" hint even though the user IS logged in fine.
//
// These tests confirm cmdWorkflow's list/view/delete/save subcommands now
// route through hintFor() (matching workflowNew's stream-turn catch, which
// was already correct — see workflow.ts:107) and render the distinct,
// already-implemented hint from core/error_hints.ts for each status.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../src/core/transport.js";
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

async function runWithStatus(argv: string[], status: number, body: unknown): Promise<{ code: number; err: string }> {
  const real = globalThis.fetch;
  stubFetch(() => jsonRes(status, body));
  const cap = captureWrite(process.stderr);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
    const code = await cmdWorkflow(fakeCtx(api), argv);
    return { code, err: cap.get() };
  } finally {
    cap.restore();
    globalThis.fetch = real;
  }
}

const SUBCOMMANDS: Array<{ label: string; argv: string[] }> = [
  { label: "list", argv: ["list"] },
  { label: "view", argv: ["view", "my-workflow"] },
  { label: "delete", argv: ["delete", "my-workflow"] },
  { label: "save", argv: ["save", "my-workflow"] },
];

for (const { label, argv } of SUBCOMMANDS) {
  test(`cmdWorkflow ${label}: a 402 (out of UVT balance) shows the balance hint, not 'are you logged in?'`, async () => {
    const { code, err } = await runWithStatus(argv, 402, { detail: "insufficient balance" });
    assert.equal(code, 1);
    assert.match(err, /UVT|balance/i);
    assert.doesNotMatch(err, /are you logged in/);
  });

  test(`cmdWorkflow ${label}: a 403 (plan/tier) shows the plan/tier hint, not 'are you logged in?'`, async () => {
    const { code, err } = await runWithStatus(argv, 403, { detail: "forbidden" });
    assert.equal(code, 1);
    assert.match(err, /plan|tier/i);
    assert.doesNotMatch(err, /are you logged in/);
  });

  test(`cmdWorkflow ${label}: a 5xx shows a retry/connectivity hint, not the auth-login hint`, async () => {
    const { code, err } = await runWithStatus(argv, 500, { detail: "server error" });
    assert.equal(code, 1);
    assert.match(err, /retry|doctor/i);
    assert.doesNotMatch(err, /are you logged in/);
  });

  test(`cmdWorkflow ${label}: a 401 still shows the auth-login hint (unchanged for this status)`, async () => {
    const { code, err } = await runWithStatus(argv, 401, { detail: "expired" });
    assert.equal(code, 1);
    assert.match(err, /aether auth login/);
  });
}
