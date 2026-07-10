import type { Writable } from "node:stream";
import { renderRegistryHelp } from "../core/command_registry.js";
import { SLASH_COMMANDS, SLASH_SECTIONS } from "./slash_registry.js";

export function printSlashHelp(out: Writable, target = ""): void {
  out.write(renderRegistryHelp({
    title: "Aether Agent slash commands",
    intro: "Commands are grouped by terminal workflow.",
    prefix: "/",
    commands: SLASH_COMMANDS,
    sections: SLASH_SECTIONS,
    target: target.trim().replace(/^\//, ""),
    footer: [
      "/help <command> for detail ? Tab completes slash commands.",
      "/model or /agent with no argument opens the picker.",
    ],
  }));
}
