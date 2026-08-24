// Command dispatch table — the registration seam.
//
// `CLI_COMMANDS` (cli_registry.ts) has always described the CLI: names,
// aliases, help text, typo-guard vocabulary. It never *ran* anything. The
// running happened in a hand-written `switch` in main.ts, and a regex test
// over main.ts's source was the only thing holding the two together.
//
// That is fine for one author and hostile to several: every new command is a
// simultaneous edit to the registry, the switch, and main.ts's `parseArgs`
// option table — three conflict surfaces for what is conceptually one entry.
// Worse, drift is silent in the direction that costs money: a registered name
// with no switch case falls through to `cmdChat`, so a mistyped wiring turns
// `aether sessions` into a billed chat turn about the word "sessions".
//
// A `DispatchedCommand` closes that by carrying its own dispatch and its own
// flags alongside its help metadata. One entry, one file, one conflict
// surface, and reachability is structural rather than asserted by regex.
//
// Flags stay in a single `parseArgs` call — the merged table is validated so a
// collision between two commands (or with a global) is a load-time error, not
// last-writer-wins. Handlers read flags through an accessor bound to what they
// declared, so a command cannot silently read a flag it does not own.

import type { AppContext } from "./context.js";
import { validateCommandRegistry, type CommandSpec } from "./command_registry.js";

/** A flag's parsed shape. Mirrors the subset of `parseArgs` options we allow. */
export interface FlagSpec {
  type: "boolean" | "string";
  /** Single-character alias (`-y`). Checked for collisions like long names. */
  short?: string;
  /** Boolean flags default to false; string flags have no default. */
  default?: boolean;
  /** Repeatable string flag (`--only a --only b`). String flags only. */
  multiple?: boolean;
}

export type FlagTable = Readonly<Record<string, FlagSpec>>;

/** Typed, ownership-checked view of the parsed flags for one command. */
export interface CommandFlags {
  bool(name: string): boolean;
  str(name: string): string | undefined;
  /** Every occurrence of a repeatable string flag, in argv order. */
  list(name: string): string[];
}

export type CommandHandler = (ctx: AppContext, argv: string[], flags: CommandFlags) => Promise<number>;

/** A registry entry that can actually run. */
export interface DispatchedCommand extends CommandSpec {
  /** Flags this command owns, merged into the one global `parseArgs` table. */
  flags?: FlagTable;
  /** Lazy loader — the module is imported only when the command is invoked. */
  load: () => Promise<CommandHandler>;
}

const FLAG_NAME = /^[a-z][a-z0-9-]*$/;

function sameSpec(a: FlagSpec, b: FlagSpec): boolean {
  return a.type === b.type && a.short === b.short && a.default === b.default && !!a.multiple === !!b.multiple;
}

/**
 * Every way the table can be wrong, as a list of messages. Callers throw on a
 * non-empty result at module load — a broken table must never reach argv.
 *
 * `reserved` is the global flag table: a command may not shadow a global,
 * because the merged `parseArgs` namespace is flat and the shadow would
 * silently change what `--json` (or any other global) means for that command.
 */
export function validateDispatchTable(
  commands: readonly DispatchedCommand[],
  reserved: FlagTable = {},
  sections?: readonly string[],
): string[] {
  const errors = validateCommandRegistry(commands, sections);
  const seenFlags = new Map<string, { spec: FlagSpec; owner: string }>();
  const seenShorts = new Map<string, { flag: string; owner: string }>();
  for (const [name, spec] of Object.entries(reserved)) {
    seenFlags.set(name, { spec, owner: "(global)" });
    if (spec.short) seenShorts.set(spec.short, { flag: name, owner: "(global)" });
  }
  for (const command of commands) {
    if (typeof command.load !== "function") errors.push(`${command.name}: missing load()`);
    for (const [name, spec] of Object.entries(command.flags ?? {})) {
      if (!FLAG_NAME.test(name)) errors.push(`${command.name}: invalid flag name --${name}`);
      if (spec.short && !/^[a-zA-Z]$/.test(spec.short)) errors.push(`${command.name}: invalid short flag -${spec.short}`);
      if (spec.multiple && spec.type !== "string") errors.push(`${command.name}: --${name} cannot be both boolean and repeatable`);
      const prior = seenFlags.get(name);
      if (prior && prior.owner === "(global)") {
        errors.push(`${command.name}: --${name} shadows a global flag`);
      } else if (prior && !sameSpec(prior.spec, spec)) {
        errors.push(`${command.name}: --${name} conflicts with ${prior.owner}'s --${name}`);
      } else if (!prior) {
        seenFlags.set(name, { spec, owner: command.name });
      }
      if (spec.short) {
        // A short letter belongs to a flag NAME, not to a command. Keying this
        // on the owning command let one command declare two different flags on
        // the same letter: parseArgs then silently resolves -x to whichever was
        // declared first and the other short is dead. Two commands sharing one
        // identical flag is still fine — that is a single parseArgs entry.
        const priorShort = seenShorts.get(spec.short);
        if (priorShort && priorShort.flag !== name) {
          errors.push(`${command.name}: -${spec.short} on --${name} conflicts with ${priorShort.owner}'s --${priorShort.flag}`);
        } else if (!priorShort) {
          seenShorts.set(spec.short, { flag: name, owner: command.name });
        }
      }
    }
  }
  return errors;
}

/** Global flags + every command's flags, as one `parseArgs` options object. */
export function mergeFlagTables(reserved: FlagTable, commands: readonly DispatchedCommand[]): Record<string, FlagSpec> {
  const merged: Record<string, FlagSpec> = { ...reserved };
  for (const command of commands) for (const [name, spec] of Object.entries(command.flags ?? {})) merged[name] ??= spec;
  return merged;
}

/**
 * Bind parsed values to one command's declared flags.
 *
 * Reading an undeclared flag throws rather than returning `undefined`: an
 * undeclared read is a wiring bug, and `undefined` is exactly the shape a
 * legitimately-absent flag has, so returning it would hide the bug behind a
 * plausible value — the same failure mode as rendering unknown as zero.
 */
export function commandFlags(command: DispatchedCommand, values: Record<string, unknown>): CommandFlags {
  const declared = command.flags ?? {};
  const spec = (name: string): FlagSpec => {
    const found = declared[name];
    if (!found) throw new Error(`command '${command.name}' did not declare flag --${name}`);
    return found;
  };
  return {
    bool(name: string): boolean {
      const found = spec(name);
      if (found.type !== "boolean") throw new Error(`--${name} is a string flag; read it with str()`);
      return values[name] === true;
    },
    str(name: string): string | undefined {
      const found = spec(name);
      if (found.type !== "string") throw new Error(`--${name} is a boolean flag; read it with bool()`);
      if (found.multiple) throw new Error(`--${name} is repeatable; read it with list()`);
      return typeof values[name] === "string" ? (values[name] as string) : undefined;
    },
    list(name: string): string[] {
      const found = spec(name);
      if (!found.multiple) throw new Error(`--${name} is not repeatable; read it with str()`);
      const value = values[name];
      return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    },
  };
}

/**
 * Exact name-or-alias lookup. Never fuzzy — suggestions are the typo guard's
 * job — and deliberately case-SENSITIVE, because the `switch` in main.ts is.
 *
 * Lowercasing here would make migrated commands answer to `DOCTOR` while every
 * command still in the switch does not. Wrong-case tokens stay non-commands and
 * the top-level guard reports the canonical spelling before chat can bill a
 * turn. One casing rule for the whole CLI is worth more than leniency for the
 * commands that happen to have moved.
 */
export function findDispatchedCommand(
  commands: readonly DispatchedCommand[],
  name: string,
): DispatchedCommand | undefined {
  return commands.find((command) => command.name === name || command.aliases?.includes(name));
}
