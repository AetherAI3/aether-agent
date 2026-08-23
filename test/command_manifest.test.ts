import { test } from "node:test";
import assert from "node:assert/strict";
import { commandNames, type CommandSpec } from "../src/core/command_registry.js";
import { ALL_CLI_COMMANDS, DISPATCH_COMMANDS, findCliCommand } from "../src/commands/cli_registry.js";
import { SLASH_COMMANDS, findCommand as findSlashCommand } from "../src/commands/slash_registry.js";
import {
  COMMAND_MANIFEST,
  createCommandManifest,
  findManifestCommand,
  manifestCommandNames,
  validateCommandManifest,
  type CommandManifestEntry,
} from "../src/commands/command_manifest.js";

test("adapter preserves registry order, names, aliases, and help metadata", () => {
  const shell = COMMAND_MANIFEST.filter((entry) => entry.surface === "shell");
  const slash = COMMAND_MANIFEST.filter((entry) => entry.surface === "slash");
  assert.deepEqual(shell.map((entry) => entry.name), ALL_CLI_COMMANDS.map((entry) => entry.name));
  assert.deepEqual(slash.map((entry) => entry.name), SLASH_COMMANDS.map((entry) => entry.name));
  assert.deepEqual(manifestCommandNames("shell"), commandNames(ALL_CLI_COMMANDS));
  assert.deepEqual(manifestCommandNames("slash"), commandNames(SLASH_COMMANDS));

  for (const [surface, source] of [
    ["shell", ALL_CLI_COMMANDS],
    ["slash", SLASH_COMMANDS],
  ] as const) {
    for (const command of source) {
      const entry = findManifestCommand(surface, command.name)!;
      assert.deepEqual(entry.aliases, command.aliases ?? [], `${surface}:${command.name} aliases`);
      assert.equal(entry.args, command.args, `${surface}:${command.name} args`);
      assert.equal(entry.summary, command.summary, `${surface}:${command.name} summary`);
      assert.equal(entry.section, command.section, `${surface}:${command.name} section`);
      assert.equal(entry.hidden, command.hidden === true, `${surface}:${command.name} hidden`);
      assert.equal(entry.docs.target, command.name);
      assert.equal(entry.docs.visible, command.hidden !== true);
    }
  }
});

test("manifest lookup is surface-aware and alias compatible with both registries", () => {
  for (const name of commandNames(ALL_CLI_COMMANDS)) {
    assert.equal(findManifestCommand("shell", name)?.name, findCliCommand(name)?.name, name);
  }
  for (const name of commandNames(SLASH_COMMANDS)) {
    assert.equal(findManifestCommand("slash", `/${name}`)?.name, findSlashCommand(name)?.name, name);
  }
  assert.equal(findManifestCommand("shell", "help")?.key, "shell:help");
  assert.equal(findManifestCommand("slash", "help")?.key, "slash:help");
  assert.equal(findManifestCommand("slash", "QUIT")?.name, "exit");
});

test("lazy CLI registrations retain their existing loader by reference", () => {
  const lazyNames = new Set(DISPATCH_COMMANDS.map((command) => command.name));
  for (const entry of COMMAND_MANIFEST.filter((item) => item.surface === "shell")) {
    if (!lazyNames.has(entry.name)) {
      assert.equal(entry.handler.kind, "host", entry.name);
      continue;
    }
    assert.equal(entry.handler.kind, "lazy", entry.name);
    if (entry.handler.kind === "lazy") {
      assert.equal(entry.handler.load, DISPATCH_COMMANDS.find((command) => command.name === entry.name)?.load);
    }
  }
});

const shellFixture: CommandSpec[] = [
  { name: "alpha", aliases: ["a"], args: "<x>", summary: "first", section: "One" },
  { name: "beta", summary: "second", section: "One" },
];

function fixtureManifest(): readonly CommandManifestEntry[] {
  return createCommandManifest({ shell: shellFixture, slash: [] });
}

test("validator detects duplicate aliases and surface/name token collisions", () => {
  const base = fixtureManifest();
  const duplicateAlias: CommandManifestEntry = { ...base[0]!, aliases: ["a", "a"] };
  assert.deepEqual(validateCommandManifest([duplicateAlias]), ["shell:alpha: duplicate alias 'a'", "shell:alpha: token 'a' collides with shell:alpha"]);

  const aliasCollision: CommandManifestEntry = { ...base[1]!, aliases: ["a"] };
  assert.deepEqual(validateCommandManifest([base[0]!, aliasCollision]), ["shell:beta: token 'a' collides with shell:alpha"]);

  assert.deepEqual(validateCommandManifest([base[0]!, { ...base[0]! }]), [
    "shell:alpha: duplicate surface/name key",
    "shell:alpha: token 'alpha' collides with shell:alpha",
    "shell:alpha: token 'a' collides with shell:alpha",
  ]);
});

test("same command token on different surfaces is valid", () => {
  const entries = createCommandManifest({ shell: [shellFixture[0]!], slash: [shellFixture[0]!] });
  assert.deepEqual(validateCommandManifest(entries), []);
  assert.equal(entries[0]?.key, "shell:alpha");
  assert.equal(entries[1]?.key, "slash:alpha");
});

test("validator rejects invalid handler ownership metadata", () => {
  const base = fixtureManifest()[0]!;
  const badModule = { ...base, handler: { ...base.handler, module: "../main.js" } } as CommandManifestEntry;
  assert.deepEqual(validateCommandManifest([badModule]), ["shell:alpha: invalid handler module '../main.js'"]);

  const traversal = { ...base, handler: { ...base.handler, module: "src/commands/../../main.ts" } } as CommandManifestEntry;
  assert.deepEqual(validateCommandManifest([traversal]), ["shell:alpha: invalid handler module 'src/commands/../../main.ts'"]);

  const badSymbol = { ...base, handler: { ...base.handler, symbol: "not a symbol" } } as CommandManifestEntry;
  assert.deepEqual(validateCommandManifest([badSymbol]), ["shell:alpha: invalid handler symbol 'not a symbol'"]);

  const missingLoader = {
    ...base,
    handler: { kind: "lazy", module: "src/commands/example.ts", symbol: "COMMANDS" },
  } as unknown as CommandManifestEntry;
  assert.deepEqual(validateCommandManifest([missingLoader]), ["shell:alpha: lazy handler is missing load()"]);
});

test("validator rejects documentation metadata drift", () => {
  const base = fixtureManifest()[0]!;
  const badTarget = { ...base, docs: { ...base.docs, target: "beta" } };
  assert.deepEqual(validateCommandManifest([badTarget]), ["shell:alpha: docs target 'beta' does not match command name"]);

  const badUsage = { ...base, docs: { ...base.docs, usage: "aether alpha" } };
  assert.deepEqual(validateCommandManifest([badUsage]), ["shell:alpha: docs usage must be 'aether alpha <x>'"]);

  const badVisibility = { ...base, docs: { ...base.docs, visible: false } };
  assert.deepEqual(validateCommandManifest([badVisibility]), ["shell:alpha: docs visibility disagrees with hidden metadata"]);
});

test("the production manifest is structurally valid", () => {
  assert.ok(COMMAND_MANIFEST.length > 0);
  assert.deepEqual(validateCommandManifest(COMMAND_MANIFEST), []);
});
