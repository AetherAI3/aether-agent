# CLI command registration seam

Status: landed. Audience: anyone adding a top-level `aether <command>`.

## Why this exists

`CLI_COMMANDS` in `src/commands/cli_registry.ts` described the CLI — names,
aliases, help text, the typo guard's vocabulary. It never ran anything. Running
happened in a hand-written `switch` in `src/main.ts`, and a regex over
`main.ts`'s source text was the only thing holding the two together.

Adding one command therefore meant three simultaneous edits:

1. an entry in `CLI_COMMANDS`,
2. a `case` in `main.ts`,
3. any new flags appended to `main.ts`'s single `parseArgs` option literal.

Three conflict surfaces for one conceptual entry. With several lanes adding
commands at once, every one of them collides in the same three places.

Drift between (1) and (2) is silent in the direction that costs money: an
unmatched name falls through to `cmdChat`, so a registered-but-unwired
`aether sessions` becomes a billed chat turn about the word "sessions".

Drift in (3) is worse, because it is invisible. `main.ts` parses non-strictly,
so an undeclared `--live` is captured into `values` and stripped from the
positionals the command is handed. `aether doctor --live` ran the fast,
configured-only report and exited 0 — the live end-to-end proof reported as
done without being performed.

## The seam

`src/core/command_dispatch.ts` defines `DispatchedCommand`: the help metadata a
`CommandSpec` already carried, plus the two things it was missing.

```ts
{
  name: "sessions",
  args: "[inspect|continue|export] [id]",
  summary: "browse and continue project sessions",
  section: "Start",
  flags: { archived: { type: "boolean", default: false }, label: { type: "string" } },
  load: async () => {
    const { cmdSessions } = await import("./sessions.js");
    return (ctx, argv, flags) => cmdSessions(ctx, argv, { archived: flags.bool("archived") });
  },
}
```

Append that to `DISPATCH_COMMANDS` in `cli_registry.ts`. That is the whole
change: no `case` in `main.ts`, no edit to the global flag table, no third
place to keep in step. Help, `aether help <name>`, the typo guard, and
`COMMANDS.md` parity all read the union (`ALL_CLI_COMMANDS`) already.

`load()` is lazy — the command's module is imported only when the command runs,
so a new command costs nothing at startup.

## What the seam guarantees

**Reachability is structural.** A table entry is reachable because it *is* the
dispatch, not because a `switch` case elsewhere happens to repeat the same
string. `test/cli_registry.test.ts` asserts the union is total (every
registered name is reachable by exactly one mechanism) and non-vacuous (the
table is not empty).

**Flag collisions are load-time errors.** All flags — globals and every
command's — merge into one flat `parseArgs` namespace, so collisions are real.
`validateDispatchTable` rejects, at module load, a command that shadows a
global, two commands that disagree about one flag name, an invalid name, a
short letter already meaning something else, and a missing `load()`. Two
commands declaring an *identical* flag is fine: that is one `parseArgs` entry.

**A command reads only what it declared.** `commandFlags` binds parsed values
to the declaring command. Reading an undeclared flag throws rather than
returning `undefined` — `undefined` is exactly what a legitimately absent flag
looks like, so returning it would hide a wiring bug behind a plausible value.
`bool()`, `str()`, and `list()` (repeatable string flags) each refuse the wrong
type rather than coercing.

**Globals win.** A command cannot redefine `--json`, `--yes`, `--cwd`, or any
other global; `GLOBAL_FLAGS` in `cli_registry.ts` is the reserved list, and
shadowing it fails validation.

## Why `doctor` is in the table

The table had to carry real production traffic on the commit that introduced
it. An empty table would make every reachability assertion above vacuously
true — the guard would pass because there was nothing to guard.

Moving `doctor` also fixed what the seam exists to prevent: `--live`, `--fix`,
`--dry-run`, `--no-ui` and `--only` had never reached the command, and `--yes`
(a global) was invisible to doctor's own argv parse, so `--fix --yes` answered
"re-run with `--yes`" to a user who had just passed it.

## Migration

The `switch` in `main.ts` is unchanged and still authoritative for everything
still in it; the table is consulted first, and a name wired both ways is a test
failure rather than a silent precedence question. Existing commands can move
into the table one at a time, each move deleting its `case` and its entries
from the global flag table in the same commit.

## Two rules a registering lane must not break

**Casing.** Lookup is exactly as case-sensitive as `main.ts`'s `switch`. Do not
lowercase in the table: a migrated command answering to `DOCTOR` while every
command still in the switch does not is a divergence, and a wrong-case token
for those never reaches the typo guard — its pattern is lower-case only — so it
falls through to `cmdChat` and bills a turn.

**Hand over parsed values, not a rebuilt argv.** A loader that re-renders flags
into an argv string for its command to parse a second time reintroduces the
ambiguity the seam removes: a `--only` value of `--fix` re-enters as an option
rather than as data, and validating the value beforehand cannot fix an
ambiguity the rebuild itself creates. Pass a typed options object — `doctor`'s
entry is the worked example, and `DoctorFlagOverrides` is additive only, so a
forwarded flag can never switch off a mode the user typed.
