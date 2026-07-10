import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commandNames,
  completeCommand,
  findRegisteredCommand,
  renderRegistryHelp,
  suggestRegisteredCommand,
  validateCommandRegistry,
  type CommandSpec,
} from "../src/core/command_registry.js";

const commands: CommandSpec[] = [
  { name: "alpha", aliases: ["a"], args: "<x>", summary: "first", section: "One" },
  { name: "alpine", summary: "second", section: "One" },
  { name: "beta", summary: "third", section: "Two" },
];

test("generic registry resolves aliases, completion, and suggestions", () => {
  assert.deepEqual(commandNames(commands), ["alpha", "a", "alpine", "beta"]);
  assert.equal(findRegisteredCommand(commands, "/A")?.name, "alpha");
  assert.deepEqual(completeCommand("bet", commandNames(commands)), { completed: "beta ", matches: ["beta"] });
  assert.equal(completeCommand("BET", commandNames(commands)).completed, "beta ");
  assert.equal(completeCommand("al", commandNames(commands)).completed, "alp");
  assert.equal(suggestRegisteredCommand("btea", commandNames(commands)), "beta");
});

test("generic registry rejects duplicates and unknown sections", () => {
  assert.deepEqual(validateCommandRegistry(commands, ["One", "Two"]), []);
  assert.deepEqual(
    validateCommandRegistry([{ name: "_bad", summary: "", section: "One" }]),
    ["invalid command name: _bad", "_bad: missing summary"],
  );
  assert.deepEqual(
    validateCommandRegistry([...commands, { name: "a", summary: "duplicate", section: "Bad" }], ["One", "Two"]),
    ["a: unknown section Bad", "duplicate command name: a"],
  );
});

test("registry help derives grouping, detail, aliases, and suggestions", () => {
  const options = { title: "T", prefix: "/", commands, sections: ["One", "Two"] };
  const grouped = renderRegistryHelp(options);
  assert.match(grouped, /\/alpha <x>/);
  assert.match(grouped, /\/beta/);
  assert.match(renderRegistryHelp({ ...options, target: "a" }), /Usage: \/alpha <x>/);
  assert.match(renderRegistryHelp({ ...options, target: "btea" }), /Did you mean \/beta/);
});
