import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_COMMANDS } from "../src/commands/cli_registry.js";
import { SLASH_COMMANDS } from "../src/commands/slash_registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const docs = readFileSync(join(here, "..", "..", "COMMANDS.md"), "utf8");

function markerNames(start: string, end: string): string[] {
  const begin = docs.indexOf(start);
  const finish = docs.indexOf(end);
  assert.ok(begin >= 0 && finish > begin, `missing markers: ${start}`);
  return [...docs.slice(begin + start.length, finish).matchAll(/`([a-z0-9-]+)`/g)]
    .map((match) => match[1]!)
    .sort();
}

test("COMMANDS.md canonical indexes exactly match live registries", () => {
  const cli = CLI_COMMANDS.filter((command) => !command.hidden).map((command) => command.name).sort();
  const slash = SLASH_COMMANDS.filter((command) => !command.hidden).map((command) => command.name).sort();
  assert.deepEqual(markerNames("<!-- CLI-COMMANDS:START -->", "<!-- CLI-COMMANDS:END -->"), cli);
  assert.deepEqual(markerNames("<!-- SLASH-COMMANDS:START -->", "<!-- SLASH-COMMANDS:END -->"), slash);
});
