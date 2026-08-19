// aether capabilities — show the capability contract: static support (from
// the server manifest or the packaged fallback) separately from runtime
// availability (server overlay). Offline output says so; it never guesses.

import type { AppContext } from "../core/context.js";
import { fallbackCapabilities, renderCapabilities, resolveCapabilities } from "../core/capabilities.js";

export interface CapabilitiesCommandOptions {
  available?: boolean;
}

export async function cmdCapabilities(
  ctx: AppContext,
  argv: string[] = [],
  options: CapabilitiesCommandOptions = {},
): Promise<number> {
  const availableOnly = options.available === true || argv.includes("--available");
  const signedIn = Boolean(await ctx.tokens.get());
  const resolved = signedIn ? await resolveCapabilities(ctx.api) : fallbackCapabilities([
    "not signed in — showing the packaged snapshot; server availability unknown",
  ]);
  if (ctx.flags.json) {
    process.stdout.write(JSON.stringify({
      source: resolved.source,
      digest: resolved.digest,
      warnings: resolved.warnings,
      contract: resolved.contract,
      overlay: resolved.overlay,
    }) + "\n");
  } else {
    process.stdout.write(renderCapabilities(resolved, availableOnly));
  }
  return 0;
}
