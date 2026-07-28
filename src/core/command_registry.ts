import { theme } from "../ui/theme.js";
import { visibleWidth } from "../ui/text.js";

export interface CommandSpec {
  name: string;
  args?: string;
  summary: string;
  section: string;
  aliases?: string[];
  hidden?: boolean;
}

export function commandNames(commands: readonly CommandSpec[]): string[] {
  return commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
}

export function validateCommandRegistry(commands: readonly CommandSpec[], sections?: readonly string[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const allowed = sections ? new Set(sections) : null;
  for (const command of commands) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(command.name)) errors.push(`invalid command name: ${command.name}`);
    if (!command.summary.trim()) errors.push(`${command.name}: missing summary`);
    if (allowed && !allowed.has(command.section)) errors.push(`${command.name}: unknown section ${command.section}`);
    for (const name of [command.name, ...(command.aliases ?? [])]) {
      const normalized = name.toLowerCase();
      if (seen.has(normalized)) errors.push(`duplicate command name: ${normalized}`);
      seen.add(normalized);
    }
  }
  return errors;
}

export function findRegisteredCommand<T extends CommandSpec>(commands: readonly T[], name: string): T | undefined {
  const normalized = name.trim().toLowerCase().replace(/^\//, "");
  return commands.find((command) => command.name === normalized || command.aliases?.includes(normalized));
}

export function completeCommand(partial: string, names: readonly string[]): { completed: string | null; matches: string[] } {
  const normalized = partial.toLowerCase();
  const matches = names.filter((name) => name.startsWith(normalized)).sort();
  if (matches.length === 0) return { completed: null, matches: [] };
  if (matches.length === 1) return { completed: matches[0]! + " ", matches };
  let prefix = matches[0]!;
  for (const match of matches) while (!match.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return { completed: prefix.length > normalized.length ? prefix : null, matches };
}

export function suggestRegisteredCommand(name: string, names: readonly string[], maxDistance = 2): string | null {
  let best: string | null = null;
  let bestDistance = maxDistance + 1;
  for (const candidate of names) {
    const distance = editDistance(name.toLowerCase(), candidate, bestDistance - 1);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= maxDistance ? best : null;
}

export interface HelpOptions {
  title: string;
  intro?: string;
  usage?: string[];
  prefix: string;
  commands: readonly CommandSpec[];
  sections: readonly string[];
  target?: string;
  footer?: string[];
}

/** Pad to `w` VISIBLE columns — styled text carries zero-width escapes. */
function padCol(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - visibleWidth(s)));
}

/** `<prefix><name> <args>` — the canonical way a command is written. */
function usageOf(command: CommandSpec, prefix: string): string {
  return `${prefix}${command.name}${command.args ? " " + command.args : ""}`;
}

export function renderRegistryHelp(options: HelpOptions): string {
  const target = options.target?.trim();
  if (target) return renderTargetHelp(options, target);

  const lines = [theme.bold(options.title)];
  if (options.intro) lines.push("", theme.dim(options.intro));
  if (options.usage?.length) {
    lines.push("", theme.dim("Usage:"), ...options.usage.map((line) => "  " + line));
  }
  for (const section of options.sections) {
    const commands = options.commands.filter((command) => command.section === section && !command.hidden);
    if (!commands.length) continue;
    lines.push("", theme.iceBlue(section + ":"));
    const usages = commands.map((command) => {
      const aliases = command.aliases?.length ? ` (${command.aliases.map((alias) => options.prefix + alias).join(", ")})` : "";
      return usageOf(command, options.prefix) + aliases;
    });
    // Was capped at 42 columns: any usage longer than that then butted straight
    // against its own summary with no separating space. Pad to the widest usage
    // actually present, so the summary column is straight and never collides.
    const width = Math.max(...usages.map((usage) => visibleWidth(usage))) + 2;
    commands.forEach((command, index) =>
      lines.push(`  ${padCol(theme.cyan(usages[index]!), width)}${theme.dim(command.summary)}`),
    );
  }
  if (options.footer?.length) lines.push("", ...options.footer.map((line) => theme.dim(line)));
  return lines.join("\n") + "\n";
}

/**
 * `help <target>`. Three outcomes, in order:
 *
 *  1. exact name or alias            -> full detail for that command
 *  2. substring of a name or summary -> the commands that matched
 *  3. nothing                        -> unknown, plus the closest did-you-mean
 *
 * Step 2 is the addition. Previously anything that was not an exact name was
 * "Unknown command", so `help vault` or `help git` — a user describing what they
 * want rather than naming it — hit a dead end standing next to a registry that
 * could have answered. Search runs AFTER exact match, so a real command name
 * always wins, and falls through to did-you-mean when it finds nothing.
 */
function renderTargetHelp(options: HelpOptions, target: string): string {
  const command = findRegisteredCommand(options.commands, target);
  if (command) {
    const aliases = command.aliases?.length
      ? `\nAliases: ${command.aliases.map((alias) => options.prefix + alias).join(", ")}`
      : "";
    // Neighbours in the same section: the answer to "what else is near this?",
    // which is usually the next question after reading one command's detail.
    const siblings = options.commands
      .filter((c) => c.section === command.section && c.name !== command.name && !c.hidden)
      .map((c) => options.prefix + c.name);
    const related = siblings.length ? `\n${theme.dim("Related: " + siblings.join("  "))}` : "";
    return (
      `Usage: ${theme.bold(usageOf(command, options.prefix))}\n` +
      `${command.summary}\n` +
      `Section: ${command.section}${aliases}${related}\n`
    );
  }

  const needle = target.toLowerCase();
  const matches = options.commands.filter(
    (c) =>
      !c.hidden &&
      (c.name.includes(needle) ||
        c.summary.toLowerCase().includes(needle) ||
        c.section.toLowerCase().includes(needle) ||
        c.aliases?.some((a) => a.includes(needle))),
  );
  if (matches.length) {
    const usages = matches.map((c) => usageOf(c, options.prefix));
    const width = Math.max(...usages.map((u) => visibleWidth(u))) + 2;
    const rows = matches.map(
      (c, i) => `  ${padCol(theme.cyan(usages[i]!), width)}${theme.dim(c.summary)}`,
    );
    const header = `No command named ${options.prefix}${target} — ${matches.length} match${matches.length === 1 ? "" : "es"}:`;
    return [header, "", ...rows, "", theme.dim(`${options.prefix}help <name> for detail.`)].join("\n") + "\n";
  }

  const suggestion = suggestRegisteredCommand(target, commandNames(options.commands));
  return `Unknown command: ${options.prefix}${target}${suggestion ? `\nDid you mean ${options.prefix}${suggestion}?` : ""}\n`;
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    let rowMin = row;
    for (let column = 1; column <= b.length; column++) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      const value = Math.min(previous[column]! + 1, current[column - 1]! + 1, previous[column - 1]! + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length]!;
}
