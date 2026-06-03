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
};

export function configDir(): string {
  return process.env["AETHER_CONFIG_DIR"] ?? join(homedir(), ".config", "aether");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function loadConfig(): AetherConfig {
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
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}
