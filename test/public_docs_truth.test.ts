import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_CLI_COMMANDS } from "../src/commands/cli_registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const readme = readFileSync(join(root, "README.md"), "utf8");

function repositoryFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "dist", "node_modules"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...repositoryFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

test("retired product branding and URL stay out of the repository", () => {
  // Assemble retired identifiers so this guard does not contain the byte
  // sequence it rejects and can safely scan its own source.
  const retiredUrl = ["aethersystems.net", "terminal"].join("/");
  const retiredName = ["Aether", "Terminal"].join(" ");
  const retiredInitialism = new RegExp(`\\bA${"TS"}\\b`);

  for (const path of repositoryFiles(root)) {
    const text = readFileSync(path, "utf8");
    const name = relative(root, path).replaceAll("\\", "/");
    assert.equal(text.toLowerCase().includes(retiredUrl), false, `${name} contains the retired URL`);
    assert.equal(text.includes(retiredName), false, `${name} contains retired product branding`);
    assert.equal(retiredInitialism.test(text), false, `${name} contains the retired product initialism`);
  }
});

test("README has durable assets and canonical public repository URLs", () => {
  assert.doesNotMatch(readme, /github\.com\/user-attachments\/assets/i);
  assert.doesNotMatch(readme, /github\.com\/(?:DBarr3|Aether-AI-3)\/aether-agent/i);
  assert.doesNotMatch(readme, /github\.com\/AetherAI3\/aether-agent-cli/i);
  assert.match(readme, /git clone https:\/\/github\.com\/AetherAI3\/aether-agent\.git/);
  assert.match(readme, /https:\/\/www\.npmjs\.com\/package\/aether-agents/);

  for (const match of readme.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]!;
    if (/^(?:https?:)?\/\//.test(target) || target.startsWith("#")) continue;
    const localPath = target.split("#", 1)[0]!;
    assert.ok(existsSync(join(root, localPath)), `README local link does not exist: ${target}`);
  }
});

test("README shell examples name registered commands", () => {
  const registered = new Set<string>();
  for (const command of ALL_CLI_COMMANDS) {
    registered.add(command.name);
    for (const alias of command.aliases ?? []) registered.add(alias);
  }

  for (const match of readme.matchAll(/^\s*aether\s+([a-z][a-z-]*)\b/gm)) {
    assert.ok(registered.has(match[1]!), `README names an unregistered command: ${match[1]}`);
  }
});
