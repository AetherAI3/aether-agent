import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commandFlags,
  findDispatchedCommand,
  mergeFlagTables,
  validateDispatchTable,
  type DispatchedCommand,
  type FlagTable,
} from "../src/core/command_dispatch.js";

const noop = async () => async () => 0;

function entry(over: Partial<DispatchedCommand> = {}): DispatchedCommand {
  return { name: "demo", summary: "demo command", section: "System", load: noop, ...over };
}

const GLOBALS: FlagTable = { json: { type: "boolean", default: false }, yes: { type: "boolean", short: "y", default: false } };

test("a clean table validates", () => {
  const table = [entry({ flags: { deep: { type: "boolean", default: false } } })];
  assert.deepEqual(validateDispatchTable(table, GLOBALS, ["System"]), []);
});

test("a command may not shadow a global flag", () => {
  const errors = validateDispatchTable([entry({ flags: { json: { type: "string" } } })], GLOBALS);
  assert.deepEqual(errors, ["demo: --json shadows a global flag"]);
});

test("two commands disagreeing about one flag is a load-time error", () => {
  const table = [
    entry({ name: "one", flags: { force: { type: "boolean", default: false } } }),
    entry({ name: "two", flags: { force: { type: "string" } } }),
  ];
  assert.deepEqual(validateDispatchTable(table, GLOBALS), ["two: --force conflicts with one's --force"]);
});

test("two commands agreeing about one flag is fine — parseArgs holds one entry", () => {
  const spec = { type: "boolean", default: false } as const;
  const table = [entry({ name: "one", flags: { force: spec } }), entry({ name: "two", flags: { force: spec } })];
  assert.deepEqual(validateDispatchTable(table, GLOBALS), []);
  assert.deepEqual(mergeFlagTables(GLOBALS, table)["force"], spec);
});

test("short letters collide independently of long names", () => {
  const table = [
    entry({ name: "one", flags: { force: { type: "boolean", short: "f", default: false } } }),
    entry({ name: "two", flags: { file: { type: "string", short: "f" } } }),
  ];
  assert.deepEqual(validateDispatchTable(table, GLOBALS), ["two: -f on --file conflicts with one's --force"]);
});

test("one command may not spend the same short letter twice", () => {
  // A short belongs to a flag name, not to a command. Keyed on the owning
  // command, this slipped through and parseArgs then silently resolved -x to
  // whichever flag was declared first, leaving the other's short dead.
  const table = [
    entry({
      flags: {
        alpha: { type: "boolean", short: "x", default: false },
        beta: { type: "boolean", short: "x", default: false },
      },
    }),
  ];
  assert.deepEqual(validateDispatchTable(table, GLOBALS), ["demo: -x on --beta conflicts with demo's --alpha"]);
});

test("a command may not spend a short letter a global already holds", () => {
  const table = [entry({ flags: { force: { type: "boolean", short: "y", default: false } } })];
  assert.deepEqual(validateDispatchTable(table, GLOBALS), ["demo: -y on --force conflicts with (global)'s --yes"]);
});

test("malformed entries are rejected, not tolerated", () => {
  const table = [
    entry({ name: "one", flags: { "Bad Name": { type: "string" } } }),
    entry({ name: "two", flags: { ok: { type: "boolean", multiple: true, default: false } } }),
    { name: "three", summary: "s", section: "System" } as unknown as DispatchedCommand,
  ];
  const errors = validateDispatchTable(table, GLOBALS);
  assert.ok(errors.includes("one: invalid flag name --Bad Name"), errors.join("; "));
  assert.ok(errors.includes("two: --ok cannot be both boolean and repeatable"), errors.join("; "));
  assert.ok(errors.includes("three: missing load()"), errors.join("; "));
});

test("globals win the merge; a command cannot redefine one", () => {
  const merged = mergeFlagTables(GLOBALS, [entry({ flags: { json: { type: "string" } } })]);
  assert.deepEqual(merged["json"], GLOBALS["json"]);
});

test("a command reads only the flags it declared", () => {
  const command = entry({ flags: { deep: { type: "boolean", default: false }, repo: { type: "string" } } });
  const flags = commandFlags(command, { deep: true, repo: "acme/thing", json: true });
  assert.equal(flags.bool("deep"), true);
  assert.equal(flags.str("repo"), "acme/thing");
  // Undeclared reads throw rather than returning undefined: undefined is
  // exactly what a legitimately-absent flag looks like, so returning it would
  // hide the wiring bug behind a plausible value.
  assert.throws(() => flags.bool("json"), /did not declare flag --json/);
  assert.throws(() => flags.str("nope"), /did not declare flag --nope/);
});

test("flag reads are type-checked, both directions", () => {
  const command = entry({
    flags: { deep: { type: "boolean", default: false }, repo: { type: "string" }, only: { type: "string", multiple: true } },
  });
  const flags = commandFlags(command, { deep: true, repo: "x", only: ["a", "b"] });
  assert.throws(() => flags.str("deep"), /boolean flag; read it with bool/);
  assert.throws(() => flags.bool("repo"), /string flag; read it with str/);
  assert.throws(() => flags.str("only"), /repeatable; read it with list/);
  assert.throws(() => flags.list("repo"), /not repeatable; read it with str/);
  assert.deepEqual(flags.list("only"), ["a", "b"]);
});

test("an absent value is absent, never a coerced stand-in", () => {
  const command = entry({ flags: { deep: { type: "boolean", default: false }, repo: { type: "string" }, only: { type: "string", multiple: true } } });
  const flags = commandFlags(command, {});
  assert.equal(flags.bool("deep"), false);
  assert.equal(flags.str("repo"), undefined);
  assert.deepEqual(flags.list("only"), []);
  // A string value on a boolean flag is not truthiness — parseArgs never
  // produces it, and treating it as `true` would invent authority.
  assert.equal(commandFlags(command, { deep: "false" }).bool("deep"), false);
});

test("lookup is exact — aliases yes, near misses and case variants never", () => {
  const table = [entry({ name: "sessions", aliases: ["session"] })];
  assert.equal(findDispatchedCommand(table, "sessions")?.name, "sessions");
  assert.equal(findDispatchedCommand(table, "session")?.name, "sessions");
  assert.equal(findDispatchedCommand(table, "sesions"), undefined);
  assert.equal(findDispatchedCommand(table, ""), undefined);
  // Case-sensitive on purpose: main.ts's switch is, so lowercasing here would
  // make a migrated command answer to SESSIONS while every command still in
  // the switch does not — and a wrong-case token for those does not even reach
  // the typo guard, it becomes a billed chat turn.
  assert.equal(findDispatchedCommand(table, "SESSIONS"), undefined);
  assert.equal(findDispatchedCommand(table, "Sessions"), undefined);
});
