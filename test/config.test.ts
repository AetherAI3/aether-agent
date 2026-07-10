import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
