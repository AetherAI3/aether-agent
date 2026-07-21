// Seamless embedded auth: a user signed into AetherCloud who opens a terminal
// inside the app must NOT be asked to re-authenticate. The desktop spawns the
// CLI with AETHER_TOKEN (their existing session) in the env; the CLI entry must
// honor it instead of reading the on-disk file token. A standalone CLI user (no
// AETHER_TOKEN) must keep the normal `aether auth login` / file-store flow.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenStoreFromEnv,
  tokenStoreForInjected,
  EnvOverrideTokenStore,
  StaticTokenStore,
  FileTokenStore,
} from "../src/core/auth.js";

test("AETHER_TOKEN (desktop embed) wins over the file store — no re-auth", async () => {
  const store = tokenStoreFromEnv({ AETHER_TOKEN: "sess-desktop-123" } as NodeJS.ProcessEnv);
  // EnvOverrideTokenStore (not StaticTokenStore): reads still prefer the
  // injected session, but an explicit login now persists (PR #47 fix).
  assert.ok(store instanceof EnvOverrideTokenStore, "embedded session token is used, not the on-disk file");
  assert.equal(await store.get(), "sess-desktop-123", "the injected session is the active token");
});

test("no AETHER_TOKEN (standalone CLI) falls back to the on-disk file store", () => {
  const store = tokenStoreFromEnv({} as NodeJS.ProcessEnv);
  assert.ok(store instanceof FileTokenStore, "external CLI users keep the normal aether auth login flow");
});

test("an empty or whitespace AETHER_TOKEN is treated as unset (file store)", () => {
  assert.ok(tokenStoreFromEnv({ AETHER_TOKEN: "" } as NodeJS.ProcessEnv) instanceof FileTokenStore);
  assert.ok(tokenStoreFromEnv({ AETHER_TOKEN: "   " } as NodeJS.ProcessEnv) instanceof FileTokenStore);
});

test("the injected token is trimmed before use", async () => {
  const store = tokenStoreFromEnv({ AETHER_TOKEN: "  sess-trim  " } as NodeJS.ProcessEnv);
  assert.equal(await store.get(), "sess-trim");
});

// ── tokenStoreForInjected (LOOP-01 round 1): the one shared decision behind
// both tokenStoreFromEnv (CLI entry) and AetherClient's constructor (library
// embed) — pinned directly so the two call sites can't silently diverge again.

test("tokenStoreForInjected: persistOnLogin=true (CLI-entry semantics) selects EnvOverrideTokenStore", async () => {
  const store = tokenStoreForInjected("sess-x", { persistOnLogin: true });
  assert.ok(store instanceof EnvOverrideTokenStore);
  assert.equal(await store.get(), "sess-x");
});

test("tokenStoreForInjected: persistOnLogin=false (AetherClient library-embed semantics) selects StaticTokenStore", async () => {
  const store = tokenStoreForInjected("sess-x", { persistOnLogin: false });
  assert.ok(store instanceof StaticTokenStore);
  assert.equal(await store.get(), "sess-x");
});

test("tokenStoreForInjected: no token (either persistOnLogin setting) falls back to the file store", () => {
  assert.ok(tokenStoreForInjected(undefined, { persistOnLogin: true }) instanceof FileTokenStore);
  assert.ok(tokenStoreForInjected("", { persistOnLogin: false }) instanceof FileTokenStore);
  assert.ok(tokenStoreForInjected("   ", { persistOnLogin: false }) instanceof FileTokenStore);
});

test("tokenStoreForInjected: trims the token before use, same as tokenStoreFromEnv", async () => {
  const store = tokenStoreForInjected("  sess-trim  ", { persistOnLogin: false });
  assert.equal(await store.get(), "sess-trim");
});

test("tokenStoreFromEnv delegates to tokenStoreForInjected with persistOnLogin: true", async () => {
  const viaEnv = tokenStoreFromEnv({ AETHER_TOKEN: "sess-parity" } as NodeJS.ProcessEnv);
  const viaHelper = tokenStoreForInjected("sess-parity", { persistOnLogin: true });
  assert.equal(viaEnv.constructor, viaHelper.constructor);
  assert.equal(await viaEnv.get(), await viaHelper.get());
});
