import type { Writable } from "node:stream";
import { renderManifestHelp } from "./command_manifest.js";

export function printSlashHelp(out: Writable, target = ""): void {
  out.write(renderManifestHelp("slash", target));
}
