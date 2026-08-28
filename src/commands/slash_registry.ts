// Compatibility projection for slash help/completion. Public command metadata
// is owned by the versioned manifest; the dispatcher in slash.ts owns behavior.
import {
  commandNames,
  completeCommand,
  findRegisteredCommand,
  suggestRegisteredCommand,
  validateCommandRegistry,
} from "../core/command_registry.js";
import { COMMAND_MANIFEST_SOURCE } from "./command_manifest_data.js";

export interface SlashCommand {
  name: string;
  args?: string;
  summary: string;
  section: string;
  aliases?: string[];
  hidden?: boolean;
}

const slashManifest = COMMAND_MANIFEST_SOURCE.filter((entry) => entry.surface === "slash");
export const SLASH_SECTIONS = [...new Set(slashManifest.map((entry) => entry.section))];
export const SLASH_COMMANDS: SlashCommand[] = slashManifest.map((entry) => ({
  name: entry.name,
  ...(entry.args === undefined ? {} : { args: entry.args }),
  summary: entry.summary,
  section: entry.section,
  ...(entry.aliases.length ? { aliases: [...entry.aliases] } : {}),
  ...(entry.hidden ? { hidden: true } : {}),
}));

const registryErrors = validateCommandRegistry(SLASH_COMMANDS, SLASH_SECTIONS);
if (registryErrors.length) throw new Error(`Invalid slash manifest projection: ${registryErrors.join("; ")}`);

export function allCommandNames(): string[] {
  return commandNames(SLASH_COMMANDS);
}

export function findCommand(name: string): SlashCommand | undefined {
  return findRegisteredCommand(SLASH_COMMANDS, name);
}

export function completeSlash(input: string): { completed: string | null; matches: string[] } {
  if (!input.startsWith("/") || /\\s/.test(input)) return { completed: null, matches: [] };
  const partial = input.slice(1).toLowerCase();
  const result = completeCommand(partial, allCommandNames());
  return { completed: result.completed ? "/" + result.completed : null, matches: result.matches };
}

export function suggestCommand(name: string): string | null {
  return suggestRegisteredCommand(name, allCommandNames());
}
