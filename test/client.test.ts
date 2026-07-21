import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient, AetherClient } from "../src/index.js";
import { FileTokenStore } from "../src/core/auth.js";

test("createClient honors explicit baseUrl + token", () => {
  const c = createClient({ baseUrl: "https://api.example", token: "tok" });
  assert.ok(c instanceof AetherClient);
  assert.equal(c.baseUrl, "https://api.example");
});

test("baseUrl falls back to AETHER_BASE_URL env", () => {
  const prev = process.env["AETHER_BASE_URL"];
  process.env["AETHER_BASE_URL"] = "https://env.example";
  try {
    assert.equal(createClient({ token: "t" }).baseUrl, "https://env.example");
  } finally {
    if (prev === undefined) delete process.env["AETHER_BASE_URL"];
    else process.env["AETHER_BASE_URL"] = prev;
  }
});

test("exposes raw http on the same route", () => {
  const c = createClient({ baseUrl: "https://x", token: "t" });
  assert.ok(c.http);
});

// ── LOOP-01 round 1: AetherClient's injected-token TokenStore selection must
// share tokenStoreFromEnv's decision (via tokenStoreForInjected) for READS,
// but deliberately keep WRITES in-process — an embedded library client's
// login() must not clobber the standalone CLI's on-disk session. This is the
// mirror of auth_401.test.ts's "tokenStoreFromEnv: set() persists a fresh
// login to disk" test: same shape, opposite (in-process-only) expectation.
function withTempConfigDir<T>(fn: () => Promise<T>): Promise<T> {
  const dir = join(tmpdir(), `aether-client-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const prev = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = dir;
  return fn().finally(() => {
    if (prev === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prev;
    rmSync(dir, { recursive: true, force: true });
  });
}

test("createClient({token}).login() persists the fresh token in-process only — does NOT clobber the CLI's on-disk session", () =>
  withTempConfigDir(async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/auth/login")) {
        return new Response(JSON.stringify({ authenticated: true, session_token: "sess_fresh_embed" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.endsWith("/models")) {
        const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"] ?? "";
        return new Response(JSON.stringify({ authHeader: auth }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;
    try {
      const c = createClient({ baseUrl: "https://api.example", token: "stale_embedded_tok" });
      await c.login("user", "pass");
      // The fresh token IS active for the next authed call on this same client…
      const out = await c.http.getJson<{ authHeader: string }>("/models");
      assert.equal(out.authHeader, "Bearer sess_fresh_embed");
      // …but it must never have reached the CLI's on-disk token store.
      assert.equal(
        await new FileTokenStore().get(),
        null,
        "an embedded AetherClient login must not clobber the standalone CLI's on-disk session",
      );
    } finally {
      globalThis.fetch = real;
    }
  }));
