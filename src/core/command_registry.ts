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

export function renderRegistryHelp(options: HelpOptions): string {
  const target = options.target?.trim();
  if (target) {
    const command = findRegisteredCommand(options.commands, target);
    if (!command) {
      const suggestion = suggestRegisteredCommand(target, commandNames(options.commands));
      return `Unknown command: ${options.prefix}${target}${suggestion ? `\nDid you mean ${options.prefix}${suggestion}?` : ""}\n`;
    }
    const aliases = command.aliases?.length ? `\nAliases: ${command.aliases.map((alias) => options.prefix + alias).join(", ")}` : "";
    return `Usage: ${options.prefix}${command.name}${command.args ? " " + command.args : ""}\n${command.summary}\nSection: ${command.section}${aliases}\n`;
  }
  const lines = [options.title];
  if (options.intro) lines.push("", options.intro);
  if (options.usage?.length) lines.push("", "Usage:", ...options.usage.map((line) => "  " + line));
  for (const section of options.sections) {
    const commands = options.commands.filter((command) => command.section === section && !command.hidden);
    if (!commands.length) continue;
    lines.push("", section + ":");
    const usages = commands.map((command) => {
      const aliases = command.aliases?.length ? ` (${command.aliases.map((alias) => options.prefix + alias).join(", ")})` : "";
      return `${options.prefix}${command.name}${command.args ? " " + command.args : ""}${aliases}`;
    });
    const width = Math.min(42, Math.max(...usages.map((usage) => usage.length)) + 2);
    commands.forEach((command, index) => lines.push(`  ${usages[index]!.padEnd(width)}${command.summary}`));
  }
  if (options.footer?.length) lines.push("", ...options.footer);
  return lines.join("\n") + "\n";
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
