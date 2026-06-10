// Config load/save: ~/.config/aether/config.json
// Override the directory with AETHER_CONFIG_DIR (used by tests).

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AetherConfig } from "../types.js";

// The public API front door. The backend is served under the `/cloud` path; the
// apex returns an info blob, so the `/cloud` suffix is required for every API
// call (auth, chat, github connect). Override with AETHER_BASE_URL.
export const DEFAULT_CONFIG: AetherConfig = {
  baseUrl: "https://api.aethersystems.net/cloud",
  defaultModel: "",
  permissionMode: "ask",
  autoApply: false,
  telemetry: true,
};

export function configDir(): string {
  return process.env["AETHER_CONFIG_DIR"] ?? join(homedir(), ".config", "aether");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function loadConfig(): AetherConfig {
  const path = configPath();
  let cfg: AetherConfig;
  if (!existsSync(path)) {
    cfg = { ...DEFAULT_CONFIG };
  } else {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AetherConfig>;
      cfg = { ...DEFAULT_CONFIG, ...raw };
    } catch {
      // Corrupt config must never brick the CLI — fall back to defaults.
      cfg = { ...DEFAULT_CONFIG };
    }
  }
  // Env override wins (matches the upstream CLI), so a single env var can point
  // every API call at a staging/self-hosted backend without editing config.json.
  const envBase = process.env["AETHER_BASE_URL"];
  if (envBase) cfg = { ...cfg, baseUrl: envBase };
  return cfg;
}

export function saveConfig(cfg: AetherConfig): void {
  const dir = configDir();
  // 0700: this directory also holds the .token credential — keep it owner-only.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}
