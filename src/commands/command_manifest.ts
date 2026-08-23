// Typed, additive view over the two command registries.
//
// The CLI and slash registries remain the runtime authorities today. This
// module gives callers one normalized shape without changing either dispatch
// path, and records enough ownership metadata for commands to migrate one at a
// time instead of forcing a flag-day rewrite of main.ts or slash.ts.

import type { CommandSpec } from "../core/command_registry.js";
import type { DispatchedCommand } from "../core/command_dispatch.js";
import { ALL_CLI_COMMANDS, DISPATCH_COMMANDS } from "./cli_registry.js";
import { SLASH_COMMANDS } from "./slash_registry.js";

export const COMMAND_SURFACES = ["shell", "slash"] as const;
export type CommandSurface = (typeof COMMAND_SURFACES)[number];
export type CommandManifestKey = `${CommandSurface}:${string}`;

export interface HostHandlerBinding {
  kind: "host";
  /** Repo-relative module which owns dispatch for this command. */
  module: string;
  /** Function or table in that module which owns dispatch. */
  symbol: string;
}

export interface LazyHandlerBinding {
  kind: "lazy";
  /** Repo-relative module which owns the lazy registration. */
  module: string;
  /** Registration table in that module. */
  symbol: string;
  /** Existing loader, retained by reference so the adapter can be load-bearing. */
  load: DispatchedCommand["load"];
}

export type CommandHandlerBinding = HostHandlerBinding | LazyHandlerBinding;

export interface CommandDocsBinding {
  kind: "registry-help";
  /** Registry which owns the help metadata. */
  module: string;
  /** Canonical lookup target accepted by the registry's help renderer. */
  target: string;
  /** Fully rendered, unstyled invocation for generated docs and tests. */
  usage: string;
  /** False means detail help exists but grouped help omits the command. */
  visible: boolean;
}

export interface CommandManifestEntry {
  key: CommandManifestKey;
  surface: CommandSurface;
  name: string;
  aliases: readonly string[];
  args?: string;
  summary: string;
  section: string;
  hidden: boolean;
  handler: CommandHandlerBinding;
  docs: CommandDocsBinding;
}

export interface CommandRegistrySources {
  shell: readonly CommandSpec[];
  slash: readonly CommandSpec[];
  lazyShell?: readonly DispatchedCommand[];
}

const COMMAND_TOKEN = /^[a-z0-9][a-z0-9-]*$/;
const SYMBOL = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isModulePath(value: string): boolean {
  return (
    /^src\/[a-z0-9_./-]+\.ts$/.test(value) &&
    !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

function usageOf(surface: CommandSurface, command: Pick<CommandSpec, "name" | "args">): string {
  const prefix = surface === "shell" ? "aether " : "/";
  return `${prefix}${command.name}${command.args ? ` ${command.args}` : ""}`;
}

function normalizeCommand(
  surface: CommandSurface,
  command: CommandSpec,
  handler: CommandHandlerBinding,
  registryModule: string,
): CommandManifestEntry {
  return {
    key: `${surface}:${command.name}`,
    surface,
    name: command.name,
    aliases: [...(command.aliases ?? [])],
    ...(command.args === undefined ? {} : { args: command.args }),
    summary: command.summary,
    section: command.section,
    hidden: command.hidden === true,
    handler,
    docs: {
      kind: "registry-help",
      module: registryModule,
      target: command.name,
      usage: usageOf(surface, command),
      visible: command.hidden !== true,
    },
  };
}

/**
 * Normalize the existing registries without changing their order or aliases.
 * Supplying sources makes the adapter independently testable and gives future
 * registries a migration path; callers normally use COMMAND_MANIFEST below.
 */
export function createCommandManifest(sources: CommandRegistrySources): readonly CommandManifestEntry[] {
  const lazyByName = new Map((sources.lazyShell ?? []).map((command) => [command.name, command]));
  const shell = sources.shell.map((command) => {
    const lazy = lazyByName.get(command.name);
    const handler: CommandHandlerBinding = lazy
      ? {
          kind: "lazy",
          module: "src/commands/cli_registry.ts",
          symbol: "DISPATCH_COMMANDS",
          load: lazy.load,
        }
      : { kind: "host", module: "src/main.ts", symbol: "main" };
    return normalizeCommand("shell", command, handler, "src/commands/cli_registry.ts");
  });
  const slash = sources.slash.map((command) =>
    normalizeCommand(
      "slash",
      command,
      { kind: "host", module: "src/commands/slash.ts", symbol: "handleSlash" },
      "src/commands/slash_registry.ts",
    ),
  );
  return [...shell, ...slash];
}

function validateBinding(label: string, entry: CommandManifestEntry, errors: string[]): void {
  const handler = entry.handler;
  if (handler.kind !== "host" && handler.kind !== "lazy") {
    errors.push(`${label}: invalid handler kind`);
    return;
  }
  if (!isModulePath(handler.module)) errors.push(`${label}: invalid handler module '${handler.module}'`);
  if (!SYMBOL.test(handler.symbol)) errors.push(`${label}: invalid handler symbol '${handler.symbol}'`);
  if (handler.kind === "lazy") {
    if (entry.surface !== "shell") errors.push(`${label}: lazy handlers are only supported on the shell surface`);
    if (typeof handler.load !== "function") errors.push(`${label}: lazy handler is missing load()`);
  }

  const docs = entry.docs;
  if (docs.kind !== "registry-help") errors.push(`${label}: invalid docs kind`);
  if (!isModulePath(docs.module)) errors.push(`${label}: invalid docs module '${docs.module}'`);
  if (docs.target !== entry.name) errors.push(`${label}: docs target '${docs.target}' does not match command name`);
  const expectedUsage = usageOf(entry.surface, entry);
  if (docs.usage !== expectedUsage) errors.push(`${label}: docs usage must be '${expectedUsage}'`);
  if (docs.visible !== !entry.hidden) errors.push(`${label}: docs visibility disagrees with hidden metadata`);
}

/** Return every structural error; callers decide whether to throw. */
export function validateCommandManifest(entries: readonly CommandManifestEntry[]): string[] {
  const errors: string[] = [];
  const seenKeys = new Set<string>();
  const seenTokens = new Map<string, string>();

  for (const entry of entries) {
    const label = `${entry.surface}:${entry.name}`;
    if (!(COMMAND_SURFACES as readonly string[]).includes(entry.surface)) errors.push(`${label}: invalid surface`);
    if (entry.key !== label) errors.push(`${label}: key must be '${label}'`);
    if (seenKeys.has(entry.key)) errors.push(`${label}: duplicate surface/name key`);
    seenKeys.add(entry.key);
    if (!COMMAND_TOKEN.test(entry.name)) errors.push(`${label}: invalid command name`);
    if (!entry.summary.trim()) errors.push(`${label}: missing summary`);
    if (!entry.section.trim()) errors.push(`${label}: missing section`);

    const localAliases = new Set<string>();
    for (const alias of entry.aliases) {
      if (!COMMAND_TOKEN.test(alias)) errors.push(`${label}: invalid alias '${alias}'`);
      if (localAliases.has(alias)) errors.push(`${label}: duplicate alias '${alias}'`);
      localAliases.add(alias);
    }
    for (const token of [entry.name, ...entry.aliases]) {
      const tokenKey = `${entry.surface}:${token.toLowerCase()}`;
      const owner = seenTokens.get(tokenKey);
      if (owner) errors.push(`${label}: token '${token}' collides with ${owner}`);
      else seenTokens.set(tokenKey, label);
    }
    validateBinding(label, entry, errors);
  }
  return errors;
}

export const COMMAND_MANIFEST = createCommandManifest({
  shell: ALL_CLI_COMMANDS,
  slash: SLASH_COMMANDS,
  lazyShell: DISPATCH_COMMANDS,
});

const manifestErrors = validateCommandManifest(COMMAND_MANIFEST);
if (manifestErrors.length) throw new Error(`Invalid command manifest: ${manifestErrors.join("; ")}`);

/** Surface-aware lookup keeps legitimate `shell:help` / `slash:help` pairs distinct. */
export function findManifestCommand(
  surface: CommandSurface,
  name: string,
  entries: readonly CommandManifestEntry[] = COMMAND_MANIFEST,
): CommandManifestEntry | undefined {
  const normalized = name.trim().toLowerCase().replace(/^\//, "");
  return entries.find(
    (entry) => entry.surface === surface && (entry.name === normalized || entry.aliases.includes(normalized)),
  );
}

export function manifestCommandNames(
  surface: CommandSurface,
  entries: readonly CommandManifestEntry[] = COMMAND_MANIFEST,
): string[] {
  return entries
    .filter((entry) => entry.surface === surface)
    .flatMap((entry) => [entry.name, ...entry.aliases]);
}
