import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandNames } from "../src/core/command_registry.js";
import { CLI_COMMANDS, CLI_SECTIONS, findCliCommand, renderCliHelp } from "../src/commands/cli_registry.js";

const here = dirname(fileURLToPath(import.meta.url));

test("every CLI name and alias has detail help", () => {
  for (const name of commandNames(CLI_COMMANDS)) {
    assert.ok(findCliCommand(name), name);
    assert.match(renderCliHelp(name), /^Usage: aether /);
  }
});

test("CLI names are unique and sections are declared", () => {
  assert.equal(new Set(commandNames(CLI_COMMANDS)).size, commandNames(CLI_COMMANDS).length);
  for (const command of CLI_COMMANDS) assert.ok((CLI_SECTIONS as readonly string[]).includes(command.section));
});

test("CLI switch cases are represented by the registry", () => {
  const source = readFileSync(join(here, "..", "..", "src", "main.ts"), "utf8");
  const cases = [...source.matchAll(/^    case "([a-z0-9-]+)":/gm)].map((match) => match[1]!);
  const registered = new Set(commandNames(CLI_COMMANDS));
  assert.deepEqual(cases.filter((name) => !registered.has(name)), []);
});

test("grouped help includes every visible canonical command", () => {
  const help = renderCliHelp();
  assert.equal(help.includes("aether login"), false);
  assert.equal(help.includes("aether logout"), false);
  for (const command of CLI_COMMANDS.filter((entry) => !entry.hidden)) {
    assert.ok(help.includes(`aether ${command.name}`), command.name);
  }
});
