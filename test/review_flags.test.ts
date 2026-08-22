// Every flag the review/ship layer reads must ARRIVE.
//
// main.ts parses with `parseArgs({ strict: false })`. An undeclared flag is not
// an error there and it is not passed through either: it is swallowed into
// `values` under whatever shape parseArgs guesses and stripped out of the
// positionals the command receives. So a command reading an undeclared
// `--files a,b` sees no flag AND no argument — it runs on an empty selection
// and reports success having done nothing. That is not hypothetical: the same
// mechanism is why `aether doctor --live` silently runs the fast report.
//
// These tests assert the PARSED ARGV — what parseArgs produces from the same
// options literal main.ts uses — not any rendered output. A test that checked
// printed text would pass against a command that received nothing and printed
// an optimistic line about it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(join(here, "..", "..", "src", "main.ts"), "utf8");

/** The options literal main.ts hands parseArgs, recovered from source. */
function declaredOptions(): Record<string, { type: "string" | "boolean"; short?: string }> {
  const start = mainSource.indexOf("options: {");
  assert.ok(start > 0, "main.ts no longer has an options literal");
  let depth = 0;
  let end = start;
  for (let index = mainSource.indexOf("{", start); index < mainSource.length; index += 1) {
    const ch = mainSource[index];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  const body = mainSource.slice(mainSource.indexOf("{", start), end);
  const options: Record<string, { type: "string" | "boolean"; short?: string }> = {};
  for (const match of body.matchAll(
    /(?:"([a-z-]+)"|([a-z-]+)):\s*\{\s*type:\s*"(string|boolean)"(?:,\s*short:\s*"([a-zA-Z])")?/g,
  )) {
    const name = match[1] ?? match[2]!;
    const spec: { type: "string" | "boolean"; short?: string } = { type: match[3] as "string" | "boolean" };
    if (match[4]) spec.short = match[4];
    options[name] = spec;
  }
  return options;
}

/** Every `values["x"]` main.ts actually reads. */
function readFlags(): string[] {
  return [...new Set([...mainSource.matchAll(/values\["([a-z-]+)"\]/g)].map((match) => match[1]!))].sort();
}

const REVIEW_SHIP_FLAGS = ["files", "hunks", "message", "approve", "title", "body", "base", "all", "yes", "json"];

test("every flag main.ts reads is a flag main.ts declares", () => {
  const declared = new Set(Object.keys(declaredOptions()));
  const undeclared = readFlags().filter((name) => !declared.has(name));
  assert.deepEqual(
    undeclared,
    [],
    `strict:false swallows these before the command sees them: ${undeclared.join(", ")}`,
  );
});

test("the review/ship flags are declared, not left to strict:false", () => {
  const declared = declaredOptions();
  for (const name of REVIEW_SHIP_FLAGS) {
    assert.ok(declared[name], `${name} is not declared in main.ts's parseArgs options`);
  }
});

test("each declared review flag survives parseArgs with its value intact", () => {
  const options = declaredOptions();
  const argv = [
    "review",
    "stage",
    "--files",
    "src/a.ts,src/b.ts",
    "--hunks",
    "1,3",
    "--message",
    "fix: a thing",
    "--approve",
    "destructive",
    "--base",
    "main",
    "--all",
    "--yes",
  ];
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: false, options });

  assert.equal(values["files"], "src/a.ts,src/b.ts");
  assert.equal(values["hunks"], "1,3");
  assert.equal(values["message"], "fix: a thing");
  assert.equal(values["approve"], "destructive");
  assert.equal(values["base"], "main");
  assert.equal(values["all"], true);
  assert.equal(values["yes"], true);
  // The subcommand must still be a positional. A flag that eats its value from
  // the positional stream is exactly how `review stage` becomes `review`.
  assert.deepEqual(positionals, ["review", "stage"]);
});

test("each declared ship flag survives parseArgs with its value intact", () => {
  const options = declaredOptions();
  const body = "line one\nline two";
  const { values, positionals } = parseArgs({
    args: ["ship", "--title", "feat: the rail", "--body", body, "--base", "main", "--approve", "publish"],
    allowPositionals: true,
    strict: false,
    options,
  });
  assert.equal(values["title"], "feat: the rail");
  assert.equal(values["body"], body, "a multi-line body arrives whole");
  assert.equal(values["base"], "main");
  assert.equal(values["approve"], "publish");
  assert.deepEqual(positionals, ["ship"]);
});

test("-m is the short form of --message and carries its value", () => {
  const options = declaredOptions();
  const { values } = parseArgs({
    args: ["review", "commit", "-m", "fix: short form"],
    allowPositionals: true,
    strict: false,
    options,
  });
  assert.equal(values["message"], "fix: short form");
});

test("the trap itself: an UNDECLARED flag loses its value and its position", () => {
  // The proof that the declarations above are load-bearing rather than
  // decorative. Remove `files` from the options and the same argv silently
  // stops carrying a selection.
  const options = declaredOptions();
  delete (options as Record<string, unknown>)["files"];
  const { values, positionals } = parseArgs({
    args: ["review", "stage", "--files", "src/a.ts"],
    allowPositionals: true,
    strict: false,
    options,
  });
  assert.notEqual(values["files"], "src/a.ts", "an undeclared string flag does not arrive as its value");
  assert.equal(
    positionals.includes("src/a.ts"),
    true,
    "its value falls into the positionals, where the subcommand parser will not look for it",
  );
});

test("review and ship dispatch from main.ts's switch, so the registry test can see them", () => {
  for (const name of ["review", "ship"]) {
    assert.match(mainSource, new RegExp(`^    case "${name}":`, "m"), `main.ts has no case for ${name}`);
  }
});

/** The body of one `case "<name>": { … }` in main.ts's dispatch switch. */
function caseBody(name: string): string {
  const start = mainSource.indexOf(`    case "${name}": {`);
  assert.ok(start > 0, `no case block for ${name}`);
  let depth = 0;
  for (let index = mainSource.indexOf("{", start); index < mainSource.length; index += 1) {
    const ch = mainSource[index];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return mainSource.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated case block for ${name}`);
}

test("dispatch stays case-sensitive — nothing lowercases the subcommand", () => {
  // `aether SHIP` must not be a command. A case-insensitive lookup is not a
  // kindness here: the typo guard only fires on `/^[a-z][a-z-]*$/`, so an
  // uppercase word that matched no case-folded command falls through to
  // cmdChat and BILLS A TURN. Half the uppercase spellings would run the
  // command and half would charge for a model call, which is worse than both.
  const switchStart = mainSource.indexOf("  switch (cmd) {");
  assert.ok(switchStart > 0);
  const before = mainSource.slice(0, switchStart);
  assert.equal(
    /\bcmd\s*=\s*[^;]*toLowerCase/.test(before),
    false,
    "the dispatched token must reach the switch exactly as the user typed it",
  );
  assert.equal(/switch \(cmd\.toLowerCase\(\)\)/.test(mainSource), false);
  for (const name of ["review", "ship"]) {
    assert.equal(
      mainSource.includes(`case "${name.toUpperCase()}"`),
      false,
      `${name} must not also be registered in another casing`,
    );
  }
});

test("flags reach the commands as a typed object, never re-rendered into an argv", () => {
  // A second parse is where a value like `--title=--fix` gets promoted into a
  // flag nobody typed. These case bodies read named values and pass named
  // properties; they never rebuild a command line.
  for (const name of ["review", "ship"]) {
    const body = caseBody(name);
    assert.match(body, /\{[\s\S]*\bjson: flags\.json,[\s\S]*\}/, `${name} passes an options object`);
    for (const forbidden of [".join(", "argv", "split("]) {
      assert.equal(body.includes(forbidden), false, `${name}'s case body must not rebuild a command line (${forbidden})`);
    }
  }
});
