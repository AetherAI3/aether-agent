import { commandNames, findRegisteredCommand, renderRegistryHelp, suggestRegisteredCommand, validateCommandRegistry, type CommandSpec } from "../core/command_registry.js";
import {
  findDispatchedCommand,
  mergeFlagTables,
  validateDispatchTable,
  type DispatchedCommand,
  type FlagTable,
} from "../core/command_dispatch.js";

export const CLI_SECTIONS = ["Start", "Account", "Knowledge", "Media", "System"] as const;
export const CLI_COMMANDS: CommandSpec[] = [
  { name: "help", args: "[command]", summary: "show grouped help or command detail", section: "Start" },
  { name: "agent", aliases: ["code"], args: "[task]", summary: "run the coding agent or open its REPL", section: "Start" },
  { name: "chat", args: "[prompt]", summary: "start chat or send one prompt", section: "Start" },
  { name: "resume", args: "[session-id|export [id] --out <file>]", summary: "replay a local session, or export it as a portable handoff", section: "Start" },
  // Lane AA-CONT-04. cli_registry.ts is shared and additive-only: this is the
  // one line this lane adds. The spec is mirrored by SESSIONS_CLI_COMMAND in
  // commands/sessions.ts and pinned equal by test/sessions_cmd.test.ts, so the
  // help text and the implementation cannot drift. Not imported from there on
  // purpose — this module is loaded on every cold start, and the sessions
  // command is loaded lazily.
  { name: "sessions", args: "[inspect|continue|export|archive|clean] [id]", summary: "browse, inspect and continue past project sessions", section: "Start" },
  { name: "run", args: "<neo|kronus> <task>", summary: "stream an orchestrator run", section: "Start" },
  { name: "models", args: "[use <id>]", summary: "list models or set the default", section: "Start" },
  { name: "agents", summary: "list available orchestrators", section: "Start" },
  { name: "auth", args: "<login|status|token|refresh|logout>", summary: "manage authentication", section: "Account" },
  { name: "login", summary: "sign in (legacy shortcut)", section: "Account", hidden: true },
  { name: "logout", summary: "sign out (legacy shortcut)", section: "Account", hidden: true },
  { name: "github", args: "<connect|status|disconnect>", summary: "manage the GitHub connection", section: "Account" },
  { name: "vault", args: "<command>", summary: "search and manage semantic memory", section: "Knowledge" },
  { name: "workflow", args: "<command>", summary: "create and manage workflows", section: "Knowledge" },
  { name: "memory", args: "[status|inspect|forget|prune]", summary: "inspect and manage scoped memory", section: "Knowledge" },
  { name: "skills", args: "<subcommand>", summary: "inspect, trust, and manage agent skills", section: "Knowledge" },
  { name: "capabilities", args: "[--available]", summary: "show the capability contract and runtime availability", section: "Knowledge" },
  { name: "image", aliases: ["img"], args: "<prompt>", summary: "generate an image", section: "Media" },
  { name: "video", aliases: ["vid"], args: "<prompt>", summary: "generate a video", section: "Media" },
  { name: "output", aliases: ["out"], args: "[open <n>]", summary: "manage generated media", section: "Media" },
  { name: "audit", args: "[limit]", summary: "show chain-of-custody events", section: "System" },
  { name: "receipt", args: "<order-id>", summary: "export an audit proof package", section: "System" },
  { name: "support-bundle", summary: "export a redacted diagnostic support bundle", section: "System" },
  { name: "mcp", args: "[list|doctor|repair]", summary: "manage and diagnose MCP servers", section: "System" },
  { name: "config", args: "[show|get|set]", summary: "inspect or change configuration", section: "System" },
];
/**
 * Global flags — owned by main.ts's argv parse, readable by every command.
 * Declared here so the dispatch table can be validated against them at load
 * time: a command that shadows a global is a startup error, not a surprise.
 */
export const GLOBAL_FLAGS: FlagTable = {
  model: { type: "string" },
  agent: { type: "string" },
  cwd: { type: "string" },
  token: { type: "string" },
  username: { type: "string" },
  password: { type: "string" },
  "license-key": { type: "string" },
  "with-token": { type: "boolean", default: false },
  "no-browser": { type: "boolean", default: false },
  json: { type: "boolean", default: false },
  audit: { type: "boolean", default: false },
  yes: { type: "boolean", short: "y", default: false },
  apply: { type: "boolean", default: false },
  // `aether sessions` flags. Declared here for the reason this table exists:
  // main.ts parses with strict:false, so an UNdeclared `--undo` was captured
  // into `values` and stripped from the positionals sessions.ts re-parses —
  // `aether sessions archive <id> --undo` un-archived nothing and said so, and
  // `--no-select` (the documented escape hatch out of the picker) never
  // reached the command at all. Neither flag was ever declared, on this lane
  // or before it; the #98 declared-flag assertion is what surfaced them.
  undo: { type: "boolean", default: false },
  "no-select": { type: "boolean", default: false },
  // `aether skills` / `aether capabilities` flags:
  scope: { type: "string" },
  all: { type: "boolean", default: false },
  ci: { type: "boolean", default: false },
  available: { type: "boolean", default: false },
  junit: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false },
  // `aether agent` flags:
  local: { type: "boolean", default: false },
  pool: { type: "string" },
  effort: { type: "string" },
  "test-cmd": { type: "string" },
  quiet: { type: "boolean", default: false },
  interactive: { type: "boolean", default: false },
  "no-log": { type: "boolean", default: false },
  worktree: { type: "boolean", default: false },
  repo: { type: "string" },
  swarm: { type: "string" },
  resume: { type: "string" },
  out: { type: "string" },
};

/**
 * Self-dispatching commands. Each entry carries its own help metadata, its own
 * flags, and its own loader, so adding a command is one entry in one file — no
 * `switch` case in main.ts and no edit to the global flag table.
 *
 * `doctor` lives here rather than in the switch because the seam has to be
 * load-bearing in production to be trustworthy: an empty table would make the
 * reachability tests vacuously true.
 */
export const DISPATCH_COMMANDS: DispatchedCommand[] = [
  {
    name: "doctor",
    args: "[--live|--fix] [--deep] [--only <id>]",
    summary: "run structured runtime diagnostics",
    section: "System",
    // doctor parses its own argv (parseDoctorArgs). It never saw these flags:
    // main.ts's parse is strict:false, so an undeclared `--live` was captured
    // into `values` and stripped from the positionals doctor was handed — the
    // live end-to-end proof silently ran as the fast configured-only report,
    // and `--only <id>` arrived as a bare positional and failed as unknown.
    // Declaring them here is what makes them reach the command at all.
    flags: {
      deep: { type: "boolean", default: false },
      live: { type: "boolean", default: false },
      fix: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "no-ui": { type: "boolean", default: false },
      only: { type: "string", multiple: true },
    },
    load: async () => {
      const { cmdDoctor } = await import("./doctor.js");
      // Parsed values are handed over as data. Nothing is re-rendered into an
      // argv string for doctor to re-parse, so a `--only` value that looks
      // like an option ("--fix") stays a value: there is no second parse for
      // it to be promoted by, and no shell anywhere on the path.
      return (ctx, argv, flags) =>
        cmdDoctor(ctx, argv, {
          flags: {
            deep: flags.bool("deep"),
            live: flags.bool("live"),
            fix: flags.bool("fix"),
            dryRun: flags.bool("dry-run"),
            noUi: flags.bool("no-ui"),
            // --yes is global, so doctor's own parse never saw it either:
            // `--fix --yes` printed "re-run with --yes" to a user who had
            // just passed it.
            yes: ctx.flags.yes,
            only: flags.list("only"),
          },
        });
    },
  },
];

/** Everything the CLI answers to, however it is dispatched. */
export const ALL_CLI_COMMANDS: readonly CommandSpec[] = [...CLI_COMMANDS, ...DISPATCH_COMMANDS];

const registryErrors = [
  ...validateCommandRegistry(ALL_CLI_COMMANDS, CLI_SECTIONS),
  ...validateDispatchTable(DISPATCH_COMMANDS, GLOBAL_FLAGS, CLI_SECTIONS),
];
if (registryErrors.length) throw new Error(`Invalid CLI registry: ${registryErrors.join("; ")}`);

/** The single `parseArgs` options object: globals plus every command's flags. */
export const CLI_PARSE_OPTIONS = mergeFlagTables(GLOBAL_FLAGS, DISPATCH_COMMANDS);

export const findDispatchedCliCommand = (name: string): DispatchedCommand | undefined =>
  findDispatchedCommand(DISPATCH_COMMANDS, name);

export const findCliCommand = (name: string): CommandSpec | undefined => findRegisteredCommand(ALL_CLI_COMMANDS, name);
export const suggestCliCommand = (name: string): string | null => suggestRegisteredCommand(name, commandNames(ALL_CLI_COMMANDS));

export function renderCliHelp(target?: string): string {
  return renderRegistryHelp({
    title: "Aether Agent - local-first coding agent",
    intro: "Authenticated turns use the Aether cloud brain; signed-out turns use local Ollama.",
    usage: ["aether", 'aether "<prompt>"', "aether help [command]", "aether <command> --help"],
    prefix: "aether ",
    commands: ALL_CLI_COMMANDS,
    sections: CLI_SECTIONS,
    target,
    footer: [
      "Global flags: --model <id> --agent <id> --cwd <dir> --json --audit -y/--yes -h/--help -v/--version",
      "Unknown command text remains a bare prompt.",
    ],
  });
}
