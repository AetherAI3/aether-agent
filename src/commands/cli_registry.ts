import { commandNames, findRegisteredCommand, renderRegistryHelp, suggestRegisteredCommand, validateCommandRegistry, type CommandSpec } from "../core/command_registry.js";

export const CLI_SECTIONS = ["Start", "Account", "Knowledge", "Media", "System"] as const;
export const CLI_COMMANDS: CommandSpec[] = [
  { name: "help", args: "[command]", summary: "show grouped help or command detail", section: "Start" },
  { name: "agent", aliases: ["code"], args: "[task]", summary: "run the coding agent or open its REPL", section: "Start" },
  { name: "chat", args: "[prompt]", summary: "start chat or send one prompt", section: "Start" },
  { name: "resume", args: "[session-id]", summary: "resume a scoped local session", section: "Start" },
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
  { name: "image", aliases: ["img"], args: "<prompt>", summary: "generate an image", section: "Media" },
  { name: "video", aliases: ["vid"], args: "<prompt>", summary: "generate a video", section: "Media" },
  { name: "output", aliases: ["out"], args: "[open <n>]", summary: "manage generated media", section: "Media" },
  { name: "audit", args: "[limit]", summary: "show chain-of-custody events", section: "System" },
  { name: "receipt", args: "<order-id>", summary: "export an audit proof package", section: "System" },
  { name: "doctor", args: "[--deep]", summary: "run structured runtime diagnostics", section: "System" },
  { name: "mcp", args: "[list|doctor|repair]", summary: "manage and diagnose MCP servers", section: "System" },
  { name: "config", args: "[show|get|set]", summary: "inspect or change configuration", section: "System" },
];
const registryErrors = validateCommandRegistry(CLI_COMMANDS, CLI_SECTIONS);
if (registryErrors.length) throw new Error(`Invalid CLI registry: ${registryErrors.join("; ")}`);

export const findCliCommand = (name: string): CommandSpec | undefined => findRegisteredCommand(CLI_COMMANDS, name);
export const suggestCliCommand = (name: string): string | null => suggestRegisteredCommand(name, commandNames(CLI_COMMANDS));

export function renderCliHelp(target?: string): string {
  return renderRegistryHelp({
    title: "Aether Agent - local-first coding agent",
    intro: "Authenticated turns use the Aether cloud brain; signed-out turns use local Ollama.",
    usage: ["aether", 'aether "<prompt>"', "aether help [command]", "aether <command> --help"],
    prefix: "aether ",
    commands: CLI_COMMANDS,
    sections: CLI_SECTIONS,
    target,
    footer: [
      "Global flags: --model <id> --agent <id> --cwd <dir> --json --audit -y/--yes -h/--help -v/--version",
      "Unknown command text remains a bare prompt.",
    ],
  });
}
