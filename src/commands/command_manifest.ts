// JSON-safe product metadata over the existing command registries. Runtime
// loaders stay separate so consumers never receive executable functions.
import {
  commandNames,
  completeCommand,
  renderRegistryHelp,
  suggestRegisteredCommand,
  type CommandSpec,
} from "../core/command_registry.js";
import type { DispatchedCommand, FlagSpec, FlagTable } from "../core/command_dispatch.js";
import { ALL_CLI_COMMANDS, DISPATCH_COMMANDS, GLOBAL_FLAGS } from "./cli_registry.js";
import { SLASH_COMMANDS } from "./slash_registry.js";

export const COMMAND_SURFACES = ["shell", "slash", "headless"] as const;
export type CommandSurface = (typeof COMMAND_SURFACES)[number];
export type CommandManifestKey = `${CommandSurface}:${string}`;
export const PERMISSION_CLASSES = ["unknown", "read-only", "local-write", "network", "account", "destructive"] as const;
export type PermissionClass = (typeof PERMISSION_CLASSES)[number];
export const AVAILABILITY_STATES = ["runtime-dependent", "available", "unavailable"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];
export const DOCS_DISPOSITIONS = ["registry-only", "generated", "external", "omitted"] as const;
export type DocsDisposition = (typeof DOCS_DISPOSITIONS)[number];
export const RELEASE_DISPOSITIONS = ["existing", "new", "changed", "deprecated", "internal"] as const;
export type ReleaseDisposition = (typeof RELEASE_DISPOSITIONS)[number];

export interface CommandHandlerIdentity { id: string; kind: "host" | "lazy"; module: string; symbol: string }
export interface CommandDocsBinding {
  kind: "registry-help"; module: string; symbol: string; target: string; usage: string;
  visible: boolean; disposition: DocsDisposition;
}
export interface CommandReleaseBinding { disposition: ReleaseDisposition; note: string | null }
export interface DeprecatedCommandAlias { name: string; replacement: string; since: string | null }
export interface CommandAvailability { state: AvailabilityState; capabilityRequirements: readonly string[] }
export interface CommandManifestEntry {
  key: CommandManifestKey;
  surface: CommandSurface;
  name: string;
  aliases: readonly string[];
  compatibilityAliases: readonly string[];
  deprecatedAliases: readonly DeprecatedCommandAlias[];
  args?: string;
  summary: string;
  detailedHelp: string;
  section: string;
  hidden: boolean;
  permissionClass: PermissionClass;
  availability: CommandAvailability;
  telemetryName: string;
  acceptedGlobalFlags: readonly string[];
  ownedFlags: FlagTable;
  handler: CommandHandlerIdentity;
  docs: CommandDocsBinding;
  release: CommandReleaseBinding | null;
}
export interface CommandRegistrySources {
  shell: readonly CommandSpec[]; slash: readonly CommandSpec[]; lazyShell?: readonly DispatchedCommand[];
  globalShellFlags?: FlagTable;
}
export interface ManifestValidationOptions { reservedShellFlags?: FlagTable }

// Release history is deliberately independent of the runtime registries. A
// registry addition must land here (with an intentional disposition) or its
// manifest row remains unclassified and the release gate fails closed.
const EXISTING_COMMAND_KEYS = [
  "shell:help", "shell:agent", "shell:chat", "shell:resume", "shell:run", "shell:models",
  "shell:agents", "shell:auth", "shell:login", "shell:logout", "shell:github", "shell:vault",
  "shell:workflow", "shell:memory", "shell:skills", "shell:capabilities", "shell:image", "shell:video",
  "shell:output", "shell:audit", "shell:receipt", "shell:support-bundle", "shell:mcp", "shell:config",
  "shell:doctor", "shell:sessions", "shell:review", "shell:ship",
  "slash:help", "slash:models", "slash:model", "slash:agent", "slash:agents", "slash:tier",
  "slash:effort", "slash:audit", "slash:doctor", "slash:clear", "slash:exit", "slash:mcp",
  "slash:autonomous-execution", "slash:subagent-driven-execution", "slash:self-review", "slash:recon",
  "slash:plan", "slash:research", "slash:project-review", "slash:code-review", "slash:writing-skills",
  "slash:writing-plans", "slash:queue", "slash:steer", "slash:btw", "slash:pin", "slash:drop",
  "slash:snapshot", "slash:limit", "slash:token-budget", "slash:audit-receipt", "slash:rollback",
  "slash:logs-view", "slash:goal", "slash:goals", "slash:memory", "slash:workflow",
  "slash:workflow-templates", "slash:workflow-template", "slash:vault", "slash:vault-context",
  "slash:vault-search", "slash:vault-recent", "slash:vault-project", "slash:vault-tag", "slash:vault-tree",
  "slash:delegate", "slash:tree", "slash:broadcast", "slash:gather", "slash:scaffold", "slash:port",
  "slash:test-drive", "slash:bench", "slash:purge", "slash:stage-diff", "slash:review", "slash:ship",
  "slash:revert", "slash:photogen", "slash:frame", "slash:re-frame", "slash:videogen", "slash:sequence",
  "slash:animate", "slash:re-cut", "slash:output", "slash:storyboard", "slash:add", "slash:hud",
] as const satisfies readonly CommandManifestKey[];

const COMMAND_RELEASE_ENTRIES: ReadonlyArray<readonly [CommandManifestKey, CommandReleaseBinding]> = [
  ...EXISTING_COMMAND_KEYS.map((key): readonly [CommandManifestKey, CommandReleaseBinding] => [
    key, { disposition: "existing", note: null },
  ]),
  ["shell:exec", {
    disposition: "new",
    note: "Local child-process agent driver with aether.exec/1 JSONL events and explicit permission receipts.",
  }],
  ["shell:setup", { disposition: "new", note: "v0.3.0 adds bounded local setup diagnosis." }],
  ["shell:local", { disposition: "new", note: "v0.3.0 adds explicit Ollama diagnosis and management." }],
];
export const COMMAND_RELEASE_CONTRACT: ReadonlyMap<CommandManifestKey, CommandReleaseBinding> =
  new Map(COMMAND_RELEASE_ENTRIES);

const COMMAND_TOKEN = /^[a-z0-9][a-z0-9-]*$/;
const FLAG_NAME = /^[a-z][a-z0-9-]*$/;
const CAPABILITY_NAME = /^[a-z][a-z0-9._:-]*$/;
const KNOWN_HANDLER_OWNERS: Readonly<Record<CommandSurface, readonly string[]>> = {
  shell: ["host:src/main.ts#main", "lazy:src/commands/cli_registry.ts#DISPATCH_COMMANDS"],
  slash: ["host:src/commands/slash.ts#handleSlash"],
  headless: ["host:src/main.ts#main"],
};
const KNOWN_DOCS_OWNERS: Readonly<Record<CommandSurface, readonly string[]>> = {
  shell: ["src/commands/cli_registry.ts#ALL_CLI_COMMANDS"],
  slash: ["src/commands/slash_registry.ts#SLASH_COMMANDS"],
  headless: ["src/commands/cli_registry.ts#ALL_CLI_COMMANDS"],
};

const READ_ONLY_COMMANDS = new Set(["help", "models", "agents", "audit", "capabilities", "setup"]);
const ACCOUNT_COMMANDS = new Set(["auth", "login", "logout", "github"]);
const LOCAL_WRITE_COMMANDS = new Set(["resume", "sessions", "review", "skills", "memory", "output", "support-bundle", "config", "local"]);
const DESTRUCTIVE_COMMANDS = new Set(["ship"]);
const HOSTED_CAPABILITY_COMMANDS = new Set(["chat", "run", "models", "agents", "image", "video", "vault", "workflow", "receipt"]);

function permissionFor(surface: CommandSurface, name: string): PermissionClass {
  if (surface === "slash") return name === "rollback" || name === "revert" ? "destructive" : "unknown";
  if (READ_ONLY_COMMANDS.has(name)) return "read-only";
  if (ACCOUNT_COMMANDS.has(name)) return "account";
  if (DESTRUCTIVE_COMMANDS.has(name)) return "destructive";
  if (LOCAL_WRITE_COMMANDS.has(name) || name === "agent" || name === "exec") return "local-write";
  return "network";
}

function capabilitiesFor(surface: CommandSurface, name: string): string[] {
  if (surface === "shell" && (name === "setup" || name === "local")) return ["ollama.local"];
  if (surface === "shell" && HOSTED_CAPABILITY_COMMANDS.has(name)) return ["aether.hosted"];
  if (surface === "shell" && name === "agent") return ["aether.hosted-or-local"];
  if (surface === "shell" && name === "exec") return ["aether.local-child", "aether.headless.v1"];
  if (surface === "slash" && ["models", "model", "agents", "agent", "tier"].includes(name)) return ["aether.catalogue"];
  return [];
}

function usageOf(surface: CommandSurface, command: Pick<CommandSpec, "name" | "args">): string {
  return `${surface === "shell" ? "aether " : "/"}${command.name}${command.args ? ` ${command.args}` : ""}`;
}
function copyFlags(flags?: FlagTable): FlagTable {
  return Object.fromEntries(Object.entries(flags ?? {}).map(([name, spec]) => [name, { ...spec }]));
}
function handlerOf(surface: CommandSurface, name: string, lazy?: DispatchedCommand): CommandHandlerIdentity {
  if (surface === "shell" && lazy) return {
    id: `handler:${surface}:${name}`, kind: "lazy", module: "src/commands/cli_registry.ts", symbol: "DISPATCH_COMMANDS",
  };
  return surface === "shell"
    ? { id: `handler:${surface}:${name}`, kind: "host", module: "src/main.ts", symbol: "main" }
    : { id: `handler:${surface}:${name}`, kind: "host", module: "src/commands/slash.ts", symbol: "handleSlash" };
}
function normalizeCommand(
  surface: CommandSurface,
  command: CommandSpec,
  lazy?: DispatchedCommand,
  globalFlags: FlagTable = {},
): CommandManifestEntry {
  const usage = usageOf(surface, command);
  const key: CommandManifestKey = `${surface}:${command.name}`;
  const registry = surface === "shell"
    ? { module: "src/commands/cli_registry.ts", symbol: "ALL_CLI_COMMANDS" }
    : { module: "src/commands/slash_registry.ts", symbol: "SLASH_COMMANDS" };
  return {
    key, surface, name: command.name,
    aliases: [...(command.aliases ?? [])], compatibilityAliases: [...(command.aliases ?? [])], deprecatedAliases: [],
    ...(command.args === undefined ? {} : { args: command.args }),
    summary: command.summary, detailedHelp: `${usage}\n${command.summary}`, section: command.section,
    hidden: command.hidden === true, permissionClass: permissionFor(surface, command.name),
    availability: { state: "runtime-dependent", capabilityRequirements: capabilitiesFor(surface, command.name) },
    telemetryName: `${surface}.${command.name}`,
    acceptedGlobalFlags: surface === "shell" ? Object.keys(globalFlags).sort() : [],
    ownedFlags: copyFlags(lazy?.flags),
    handler: handlerOf(surface, command.name, lazy),
    docs: { kind: "registry-help", ...registry, target: command.name, usage, visible: command.hidden !== true, disposition: "generated" },
    release: COMMAND_RELEASE_CONTRACT.get(key) ?? null,
  };
}
export function createCommandManifest(sources: CommandRegistrySources): readonly CommandManifestEntry[] {
  const lazy = new Map((sources.lazyShell ?? []).map((command) => [command.name, command]));
  return [
    ...sources.shell.map((command) => normalizeCommand("shell", command, lazy.get(command.name), sources.globalShellFlags)),
    ...sources.slash.map((command) => normalizeCommand("slash", command)),
  ];
}

export type CommandRuntimeLoader = DispatchedCommand["load"];
export function createCommandRuntimeLoaders(commands: readonly DispatchedCommand[]): ReadonlyMap<CommandManifestKey, CommandRuntimeLoader> {
  return new Map(commands.map((command) => [`shell:${command.name}`, command.load]));
}
function sameFlagSpec(a: FlagSpec, b: FlagSpec): boolean {
  return a.type === b.type && a.short === b.short && a.default === b.default && !!a.multiple === !!b.multiple;
}
function validateBindings(label: string, entry: CommandManifestEntry, errors: string[]): void {
  if (entry.handler.id !== `handler:${entry.surface}:${entry.name}`) errors.push(`${label}: invalid handler id '${entry.handler.id}'`);
  const handlerOwner = `${entry.handler.kind}:${entry.handler.module}#${entry.handler.symbol}`;
  const handlerOwners = KNOWN_HANDLER_OWNERS[entry.surface];
  if (!handlerOwners || !handlerOwners.includes(handlerOwner)) errors.push(`${label}: unknown handler owner '${handlerOwner}'`);
  if (entry.docs.kind !== "registry-help") errors.push(`${label}: invalid docs kind`);
  const docsOwner = `${entry.docs.module}#${entry.docs.symbol}`;
  const docsOwners = KNOWN_DOCS_OWNERS[entry.surface];
  if (!docsOwners || !docsOwners.includes(docsOwner)) errors.push(`${label}: unknown docs owner '${docsOwner}'`);
  if (entry.docs.target !== entry.name) errors.push(`${label}: docs target '${entry.docs.target}' does not match command name`);
  const usage = usageOf(entry.surface, entry);
  if (entry.docs.usage !== usage) errors.push(`${label}: docs usage must be '${usage}'`);
  if (entry.docs.visible !== !entry.hidden) errors.push(`${label}: docs visibility disagrees with hidden metadata`);
  if (!(DOCS_DISPOSITIONS as readonly string[]).includes(entry.docs.disposition)) errors.push(`${label}: invalid docs disposition '${entry.docs.disposition}'`);
}
function validateProductMetadata(label: string, entry: CommandManifestEntry, errors: string[]): void {
  if (!entry.detailedHelp.trim()) errors.push(`${label}: missing detailed help`);
  if (!(PERMISSION_CLASSES as readonly string[]).includes(entry.permissionClass)) errors.push(`${label}: invalid permission class '${entry.permissionClass}'`);
  if (!(AVAILABILITY_STATES as readonly string[]).includes(entry.availability.state)) errors.push(`${label}: invalid availability state '${entry.availability.state}'`);
  const capabilities = new Set<string>();
  for (const capability of entry.availability.capabilityRequirements) {
    if (!CAPABILITY_NAME.test(capability)) errors.push(`${label}: invalid capability requirement '${capability}'`);
    if (capabilities.has(capability)) errors.push(`${label}: duplicate capability requirement '${capability}'`);
    capabilities.add(capability);
  }
  if (entry.telemetryName !== `${entry.surface}.${entry.name}`) errors.push(`${label}: telemetry name must be '${entry.surface}.${entry.name}'`);
  const globalFlags = new Set<string>();
  for (const flag of entry.acceptedGlobalFlags) {
    if (!FLAG_NAME.test(flag)) errors.push(`${label}: invalid accepted global flag --${flag}`);
    if (globalFlags.has(flag)) errors.push(`${label}: duplicate accepted global flag --${flag}`);
    globalFlags.add(flag);
  }
  if (!entry.release) errors.push(`${label}: missing release disposition contract`);
  else {
    if (!(RELEASE_DISPOSITIONS as readonly string[]).includes(entry.release.disposition)) errors.push(`${label}: invalid release disposition '${entry.release.disposition}'`);
    if (entry.release.note !== null && !entry.release.note.trim()) errors.push(`${label}: empty release note`);
  }
  const declared = new Set(entry.aliases);
  const classified = new Set<string>();
  for (const alias of entry.compatibilityAliases) {
    if (!declared.has(alias)) errors.push(`${label}: compatibility alias '${alias}' is not declared`);
    if (classified.has(alias)) errors.push(`${label}: alias '${alias}' is classified more than once`);
    classified.add(alias);
  }
  for (const alias of entry.deprecatedAliases) {
    if (!declared.has(alias.name)) errors.push(`${label}: deprecated alias '${alias.name}' is not declared`);
    if (classified.has(alias.name)) errors.push(`${label}: alias '${alias.name}' is classified more than once`);
    classified.add(alias.name);
    if (!COMMAND_TOKEN.test(alias.replacement)) errors.push(`${label}: invalid alias replacement '${alias.replacement}'`);
    if (alias.since !== null && !alias.since.trim()) errors.push(`${label}: empty alias deprecation version`);
  }
  for (const alias of declared) if (!classified.has(alias)) errors.push(`${label}: alias '${alias}' has no compatibility disposition`);
}
function validateOwnedFlags(
  label: string, entry: CommandManifestEntry, errors: string[],
  seen: Map<string, { spec: FlagSpec; owner: string; reserved: boolean }>,
  shorts: Map<string, { flag: string; owner: string }>,
): void {
  for (const [name, spec] of Object.entries(entry.ownedFlags)) {
    if (!FLAG_NAME.test(name)) errors.push(`${label}: invalid owned flag name --${name}`);
    if (spec.type !== "boolean" && spec.type !== "string") errors.push(`${label}: invalid type for --${name}`);
    if (spec.short && !/^[a-zA-Z]$/.test(spec.short)) errors.push(`${label}: invalid short flag -${spec.short}`);
    if (spec.multiple && spec.type !== "string") errors.push(`${label}: --${name} cannot be boolean and repeatable`);
    if (spec.default !== undefined && spec.type !== "boolean") errors.push(`${label}: string flag --${name} cannot have a default`);
    const key = `${entry.surface}:${name}`;
    const prior = seen.get(key);
    if (prior?.reserved) errors.push(`${label}: --${name} shadows a reserved flag`);
    else if (prior && !sameFlagSpec(prior.spec, spec)) errors.push(`${label}: --${name} conflicts with ${prior.owner}`);
    else if (!prior) seen.set(key, { spec, owner: label, reserved: false });
    if (spec.short) {
      const shortKey = `${entry.surface}:${spec.short}`;
      const old = shorts.get(shortKey);
      if (old && old.flag !== name) errors.push(`${label}: -${spec.short} on --${name} conflicts with ${old.owner}'s --${old.flag}`);
      else if (!old) shorts.set(shortKey, { flag: name, owner: label });
    }
  }
}
export function validateCommandManifest(entries: readonly CommandManifestEntry[], options: ManifestValidationOptions = {}): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  const tokens = new Map<string, string>();
  const flags = new Map<string, { spec: FlagSpec; owner: string; reserved: boolean }>();
  const shorts = new Map<string, { flag: string; owner: string }>();
  for (const [name, spec] of Object.entries(options.reservedShellFlags ?? {})) {
    flags.set(`shell:${name}`, { spec, owner: "(reserved)", reserved: true });
    if (spec.short) shorts.set(`shell:${spec.short}`, { flag: name, owner: "(reserved)" });
  }
  for (const entry of entries) {
    const label = `${entry.surface}:${entry.name}`;
    if (!(COMMAND_SURFACES as readonly string[]).includes(entry.surface)) errors.push(`${label}: invalid surface`);
    if (entry.key !== label) errors.push(`${label}: key must be '${label}'`);
    if (keys.has(entry.key)) errors.push(`${label}: duplicate surface/name key`);
    keys.add(entry.key);
    if (!COMMAND_TOKEN.test(entry.name)) errors.push(`${label}: invalid command name`);
    if (!entry.summary.trim()) errors.push(`${label}: missing summary`);
    if (!entry.section.trim()) errors.push(`${label}: missing section`);
    const aliases = new Set<string>();
    for (const alias of entry.aliases) {
      if (!COMMAND_TOKEN.test(alias)) errors.push(`${label}: invalid alias '${alias}'`);
      if (aliases.has(alias)) errors.push(`${label}: duplicate alias '${alias}'`);
      aliases.add(alias);
    }
    for (const token of [entry.name, ...entry.aliases]) {
      const key = `${entry.surface}:${token.toLowerCase()}`;
      const owner = tokens.get(key);
      if (owner) errors.push(`${label}: token '${token}' collides with ${owner}`);
      else tokens.set(key, label);
    }
    validateBindings(label, entry, errors);
    validateProductMetadata(label, entry, errors);
    validateOwnedFlags(label, entry, errors, flags, shorts);
  }
  return errors;
}

export const COMMAND_MANIFEST = createCommandManifest({
  shell: ALL_CLI_COMMANDS,
  slash: SLASH_COMMANDS,
  lazyShell: DISPATCH_COMMANDS,
  globalShellFlags: GLOBAL_FLAGS,
});
export const COMMAND_RUNTIME_LOADERS = createCommandRuntimeLoaders(DISPATCH_COMMANDS);
const manifestErrors = validateCommandManifest(COMMAND_MANIFEST, { reservedShellFlags: GLOBAL_FLAGS });
if (manifestErrors.length) throw new Error(`Invalid command manifest: ${manifestErrors.join("; ")}`);

export function findManifestCommand(
  surface: CommandSurface, name: string, entries: readonly CommandManifestEntry[] = COMMAND_MANIFEST,
): CommandManifestEntry | undefined {
  const normalized = surface === "slash" ? name.trim().toLowerCase().replace(/^\//, "") : name;
  return entries.find((entry) => entry.surface === surface && (entry.name === normalized || entry.aliases.includes(normalized)));
}
export function manifestCommandNames(surface: CommandSurface, entries: readonly CommandManifestEntry[] = COMMAND_MANIFEST): string[] {
  return entries.filter((entry) => entry.surface === surface).flatMap((entry) => [entry.name, ...entry.aliases]);
}
export function projectLegacyCommandSpecs(
  surface: CommandSurface, entries: readonly CommandManifestEntry[] = COMMAND_MANIFEST,
): CommandSpec[] {
  return entries.filter((entry) => entry.surface === surface).map((entry) => ({
    name: entry.name,
    ...(entry.aliases.length ? { aliases: [...entry.aliases] } : {}),
    ...(entry.args === undefined ? {} : { args: entry.args }),
    summary: entry.summary, section: entry.section, ...(entry.hidden ? { hidden: true } : {}),
  }));
}

/** The exact parseArgs table consumed by the executable: manifest globals plus command-owned flags. */
export function manifestParseOptions(
  entries: readonly CommandManifestEntry[] = COMMAND_MANIFEST,
  globalFlags: FlagTable = GLOBAL_FLAGS,
): Record<string, FlagSpec> {
  const merged: Record<string, FlagSpec> = { ...globalFlags };
  for (const entry of entries) {
    if (entry.surface !== "shell") continue;
    for (const [name, spec] of Object.entries(entry.ownedFlags)) merged[name] ??= spec;
  }
  return merged;
}

export const COMMAND_PARSE_OPTIONS = manifestParseOptions();

export function renderManifestHelp(surface: "shell" | "slash", target = ""): string {
  const commands = projectLegacyCommandSpecs(surface);
  if (surface === "shell") {
    return renderRegistryHelp({
      title: "Aether Agent - local-first coding agent",
      intro: "Authenticated turns use the Aether cloud brain; signed-out turns use local Ollama.",
      usage: ["aether", 'aether "<prompt>"', "aether help [command]", "aether <command> --help"],
      prefix: "aether ",
      commands,
      sections: [...new Set(commands.map((command) => command.section))],
      target,
      footer: [
        "Global flags: --model <id> --agent <id> --cwd <dir> --json --audit -y/--yes -h/--help -v/--version",
        "Unknown command text remains a bare prompt.",
      ],
    });
  }
  return renderRegistryHelp({
    title: "Aether Agent slash commands",
    intro: "Commands are grouped by terminal workflow.",
    prefix: "/",
    commands,
    sections: [...new Set(commands.map((command) => command.section))],
    target: target.trim().replace(/^\//, ""),
    footer: [
      "/help <command> for detail · /help <word> searches · Tab completes slash commands.",
      "/model or /agent with no argument opens the picker.",
    ],
  });
}

export function completeManifestSlash(input: string): { completed: string | null; matches: string[] } {
  if (!input.startsWith("/") || /\s/.test(input)) return { completed: null, matches: [] };
  const result = completeCommand(input.slice(1).toLowerCase(), manifestCommandNames("slash"));
  return { completed: result.completed ? `/${result.completed}` : null, matches: result.matches };
}

export function suggestManifestCommand(surface: "shell" | "slash", name: string, maxDistance = 2): string | null {
  return suggestRegisteredCommand(name, commandNames(projectLegacyCommandSpecs(surface)), maxDistance);
}
