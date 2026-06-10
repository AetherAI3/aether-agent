import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SLASH_COMMANDS,
  SLASH_SECTIONS,
  allCommandNames,
  findCommand,
  completeSlash,
  suggestCommand,
} from "../src/commands/slash_registry.js";

const here = dirname(fileURLToPath(import.meta.url));

/** The case labels of the handleSlash switch, parsed from source. */
function switchCases(): string[] {
  // Compiled tests run from dist/test/ — the .ts source lives two levels up.
  const src = readFileSync(join(here, "..", "..", "src", "commands", "slash.ts"), "utf8");
  const start = src.indexOf("export async function handleSlash");
  const end = src.indexOf("\n}", start);
  const body = src.slice(start, end);
  const out: string[] = [];
  for (const m of body.matchAll(/^\s{4}case "([a-z0-9-]*)":/gm)) out.push(m[1]!);
  return out;
}

test("registry ↔ handleSlash switch stay in sync (no /help drift, ever again)", () => {
  const cases = new Set(switchCases().filter((c) => c !== "")); // "" = bare-slash help alias
  const registered = new Set(allCommandNames());
  const missingFromRegistry = [...cases].filter((c) => !registered.has(c));
  const missingFromSwitch = [...registered].filter((c) => !cases.has(c));
  assert.deepEqual(missingFromRegistry, [], `cases not in registry: ${missingFromRegistry.join(", ")}`);
  assert.deepEqual(missingFromSwitch, [], `registry entries with no case: ${missingFromSwitch.join(", ")}`);
});

test("every command has a summary and a known section", () => {
  for (const c of SLASH_COMMANDS) {
    assert.ok(c.summary.length > 0, `/${c.name} missing summary`);
    assert.ok((SLASH_SECTIONS as readonly string[]).includes(c.section), `/${c.name} bad section ${c.section}`);
  }
});

test("findCommand resolves names and aliases, with or without slash", () => {
  assert.equal(findCommand("model")!.name, "model");
  assert.equal(findCommand("/quit")!.name, "exit");
  assert.equal(findCommand("QUIT")!.name, "exit");
  assert.equal(findCommand("nope"), undefined);
});

test("completeSlash: unique → full completion with trailing space", () => {
  const r = completeSlash("/doct");
  assert.equal(r.completed, "/doctor ");
  assert.deepEqual(r.matches, ["doctor"]);
});

test("completeSlash: ambiguous → longest common prefix, then candidates", () => {
  const r = completeSlash("/wo");
  assert.equal(r.completed, "/workflow"); // workflow, workflow-templates, workflow-template
  const r2 = completeSlash("/workflow");
  assert.equal(r2.completed, null); // no progress possible
  assert.ok(r2.matches.length >= 3);
});

test("completeSlash ignores non-slash input and lines with args", () => {
  assert.equal(completeSlash("model").completed, null);
  assert.equal(completeSlash("/model x").completed, null);
});

test("suggestCommand catches close typos, rejects garbage", () => {
  // "modle" is distance 2 from both model and models — either is a good save.
  assert.ok(["model", "models"].includes(suggestCommand("modle")!));
  assert.equal(suggestCommand("vautl"), "vault");
  assert.equal(suggestCommand("zzzzzzzzz"), null);
});
