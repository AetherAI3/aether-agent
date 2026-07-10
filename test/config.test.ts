import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "aether-cfg-"));
  process.env["AETHER_CONFIG_DIR"] = dir;
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env["AETHER_CONFIG_DIR"];
});

test("loadConfig returns defaults when no file exists", async () => {
  const { loadConfig, DEFAULT_CONFIG } = await import("../src/core/config.js");
  const cfg = loadConfig();
  assert.equal(cfg.permissionMode, DEFAULT_CONFIG.permissionMode);
  assert.equal(cfg.autoApply, false);
});

test("saveConfig then loadConfig round-trips", async () => {
  const { loadConfig, saveConfig, DEFAULT_CONFIG } = await import("../src/core/config.js");
  saveConfig({ ...DEFAULT_CONFIG, defaultModel: "claude-opus-4-8", permissionMode: "skip" });
  const cfg = loadConfig();
  assert.equal(cfg.defaultModel, "claude-opus-4-8");
  assert.equal(cfg.permissionMode, "skip");
});

// The env override must never leak into the persisted file: load-with-env
// then save (what /effort and `models use` do) must keep the file's baseUrl.
test("saveConfig does not persist the AETHER_BASE_URL override", async () => {
  const { loadConfig, saveConfig, DEFAULT_CONFIG } = await import("../src/core/config.js");
  saveConfig({ ...DEFAULT_CONFIG, baseUrl: "https://real.example" });
  const prev = process.env["AETHER_BASE_URL"];
  process.env["AETHER_BASE_URL"] = "http://localhost:1234";
  try {
    const cfg = loadConfig(); // baseUrl = env override
    cfg.defaultEffort = "MAX"; // unrelated change, like /effort does
    saveConfig(cfg);
  } finally {
    if (prev === undefined) delete process.env["AETHER_BASE_URL"];
    else process.env["AETHER_BASE_URL"] = prev;
  }
  const after = loadConfig();
  assert.equal(after.baseUrl, "https://real.example", "env override leaked into config.json");
  assert.equal(after.defaultEffort, "MAX", "the real change must still persist");
});

// AETHER_BASE_URL is documented to override baseUrl — the CLI must actually
// honor it (it used to be SDK-only, silently no-oping for the CLI).
test("AETHER_BASE_URL overrides the config's baseUrl", async () => {
  const { loadConfig, saveConfig, DEFAULT_CONFIG } = await import("../src/core/config.js");
  saveConfig({ ...DEFAULT_CONFIG, baseUrl: "https://from-file.example" });
  const prev = process.env["AETHER_BASE_URL"];
  process.env["AETHER_BASE_URL"] = "http://127.0.0.1:9999";
  try {
    assert.equal(loadConfig().baseUrl, "http://127.0.0.1:9999");
  } finally {
    if (prev === undefined) delete process.env["AETHER_BASE_URL"];
    else process.env["AETHER_BASE_URL"] = prev;
  }
  assert.equal(loadConfig().baseUrl, "https://from-file.example");
});

test("saveConfig writes via rename (no leftover .tmp, no truncate-in-place)", async () => {
  const { loadConfig, saveConfig, DEFAULT_CONFIG } = await import("../src/core/config.js");
  saveConfig({ ...DEFAULT_CONFIG, defaultModel: "a" });
  saveConfig({ ...DEFAULT_CONFIG, defaultModel: "b" });
  saveConfig({ ...DEFAULT_CONFIG, defaultModel: "c" });
  assert.equal(loadConfig().defaultModel, "c");
  const leftovers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], `stray tmp files: ${leftovers.join(", ")}`);
});
