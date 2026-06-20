// Seamless embedded auth: a user signed into AetherCloud who opens a terminal
// inside the app must NOT be asked to re-authenticate. The desktop spawns the
// CLI with AETHER_TOKEN (their existing session) in the env; the CLI entry must
// honor it instead of reading the on-disk file token. A standalone CLI user (no
// AETHER_TOKEN) must keep the normal `aether auth login` / file-store flow.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenStoreFromEnv,
  StaticTokenStore,
  FileTokenStore,
} from "../src/core/auth.js";

test("AETHER_TOKEN (desktop embed) wins over the file store — no re-auth", async () => {
  const store = tokenStoreFromEnv({ AETHER_TOKEN: "sess-desktop-123" } as NodeJS.ProcessEnv);
  assert.ok(store instanceof StaticTokenStore, "embedded session token is used, not the on-disk file");
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
