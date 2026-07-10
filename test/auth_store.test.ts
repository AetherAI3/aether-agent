import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// First-run regression: the token store must create the config dir itself —
// `aether auth login` is the documented first command on a fresh machine and
// nothing earlier on that path writes the directory.
test("token store set() works when the config dir does not exist yet", async () => {
  const dir = join(tmpdir(), `aether-fresh-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const prev = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = dir;
  try {
    assert.equal(existsSync(dir), false, "precondition: dir must not exist");
    const { FileTokenStore } = await import("../src/core/auth.js");
    const store = new FileTokenStore();
    await store.set("aek_fresh_machine");
    assert.equal(await store.get(), "aek_fresh_machine");
    await store.clear();
    assert.equal(await store.get(), null);
  } finally {
    if (prev === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
