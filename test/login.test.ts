// LOOP-06 round 2: end-to-end regression for cmdLogin's headless
// `--username/--password` path. loginWithPassword's thrown Error is written
// straight to process.stderr with NO sanitization of its own (see
// commands/login.ts's `catch (err) { process.stderr.write(\`✗ ${err.message}\n\`) }`)
// — so a malicious/misconfigured server's `reason` field must already be
// sanitized and length-capped by the time it reaches loginWithPassword's
// thrown message (fixed in core/auth.ts via transport.ts's
// sanitizeServerText()). This test exercises the FULL path, not just the
// auth.ts unit, to confirm the raw control bytes never reach stderr.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cmdLogin } from "../src/commands/login.js";
import { StaticTokenStore } from "../src/core/auth.js";
import type { AppContext } from "../src/core/context.js";

function fakeCtx(): AppContext {
  return {
    cfg: { baseUrl: "https://api.example" },
    tokens: new StaticTokenStore(""),
    flags: { cwd: process.cwd(), json: false, audit: false, yes: false },
    confirm: async () => false,
  } as unknown as AppContext;
}

test("cmdLogin (--username/--password): a malicious server `plan` on a SUCCESSFUL login cannot survive into the process's stdout output", async () => {
  const realFetch = globalThis.fetch;
  const realWrite = process.stdout.write.bind(process.stdout);
  const evilPlan = "\x1b]52;c;ZXZpbA==\x07pro" + "E".repeat(300);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ authenticated: true, session_token: "sess_ok", plan: evilPlan }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  let captured = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: unknown): boolean => {
    captured += String(chunk);
    return true;
  };
  try {
    const code = await cmdLogin(fakeCtx(), { username: "u", password: "p" });
    assert.equal(code, 0, "a successful login must still report success");
    assert.ok(captured.includes("Logged in"), "the success message must still be reported");
    assert.ok(!captured.includes("\x1b"), "raw ESC byte must never reach stdout");
    assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(captured), "no other C0/C1 control bytes may reach stdout");
    assert.ok(captured.length < 260, `stdout output must be length-capped, got ${captured.length} chars`);
  } finally {
    globalThis.fetch = realFetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = realWrite;
  }
});

test("cmdLogin (--username/--password): a malicious server `reason` cannot survive into the process's stderr output", async () => {
  const realFetch = globalThis.fetch;
  const realWrite = process.stderr.write.bind(process.stderr);
  const evilReason = "\x1b]52;c;ZXZpbA==\x07" + "B".repeat(300);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ authenticated: false, reason: evilReason }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  let captured = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: unknown): boolean => {
    captured += String(chunk);
    return true;
  };
  try {
    const code = await cmdLogin(fakeCtx(), { username: "u", password: "p" });
    assert.equal(code, 1, "headless login must fail (exit 1) for a rejected login");
    assert.ok(captured.length > 0, "the failure message must still be reported");
    assert.ok(!captured.includes("\x1b"), "raw ESC byte must never reach stderr");
    assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(captured), "no other C0/C1 control bytes may reach stderr");
    assert.ok(captured.length < 260, `stderr output must be length-capped, got ${captured.length} chars`);
  } finally {
    globalThis.fetch = realFetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = realWrite;
  }
});
