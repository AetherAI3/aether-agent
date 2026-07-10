// Config load/save: ~/.config/aether/config.json
// Override the directory with AETHER_CONFIG_DIR (used by tests).

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AetherConfig } from "../types.js";

export const DEFAULT_CONFIG: AetherConfig = {
  baseUrl: "https://api.aethersystems.net",
  defaultModel: "",
  permissionMode: "ask",
  autoApply: false,
  telemetry: true,
  defaultEffort: "",
};

export function configDir(): string {
  return process.env["AETHER_CONFIG_DIR"] ?? join(homedir(), ".config", "aether");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function loadConfig(): AetherConfig {
  const cfg = loadConfigFile();
  // AETHER_BASE_URL is documented to override the config's baseUrl. It used
  // to be honored only by the SDK client — the CLI silently ignored it (and
  // kept talking to production). The env var now wins here too.
  const envBase = process.env["AETHER_BASE_URL"];
  if (envBase) cfg.baseUrl = envBase;
  return cfg;
}

function loadConfigFile(): AetherConfig {
  const path = configPath();
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AetherConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    // Corrupt config must never brick the CLI — fall back to defaults.
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: AetherConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  // Never persist the AETHER_BASE_URL env override: a one-off
  // `AETHER_BASE_URL=http://localhost aether models use x` must not rewrite
  // config.json's baseUrl and silently point every future run at localhost.
  const out = { ...cfg };
  const envBase = process.env["AETHER_BASE_URL"];
  if (envBase && out.baseUrl === envBase) {
    out.baseUrl = loadConfigFile().baseUrl;
  }
  writeFileSync(configPath(), JSON.stringify(out, null, 2) + "\n", "utf8");
}
