import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isApiToken } from "../src/commands/auth.js";
import { FileTokenStore } from "../src/core/auth.js";

test("isApiToken detects an aek_ API token vs a session token", () => {
  assert.equal(isApiToken("aek_abc123"), true);
  assert.equal(isApiToken("sess-xyz"), false);
  assert.equal(isApiToken(null), false);
  assert.equal(isApiToken(undefined), false);
  assert.equal(isApiToken(""), false);
});

test("FileTokenStore writes the token owner-only (0600) and round-trips", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-tok-"));
  const prev = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = dir;
  try {
    const store = new FileTokenStore();
    await store.set("aek_synthetic");
    const path = join(dir, ".token");
    assert.equal(existsSync(path), true);
    assert.equal(readFileSync(path, "utf8"), "aek_synthetic");
    assert.equal(await store.get(), "aek_synthetic");
    // POSIX permission bits are not meaningful on Windows filesystems.
    if (process.platform !== "win32") {
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
    await store.clear();
    assert.equal(existsSync(path), false);
  } finally {
    if (prev === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
