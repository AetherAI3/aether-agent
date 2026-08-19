// aether support-bundle — export a redacted, verified diagnostic archive.

import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import {
  createSupportBundle,
  SupportBundleError,
  type SupportBundleOptions,
} from "../core/support_bundle.js";

export interface SupportBundleCommandOptions extends SupportBundleOptions {
  out?: Writable;
}

export async function cmdSupportBundle(
  ctx: AppContext,
  argv: string[] = [],
  options: SupportBundleCommandOptions = {},
): Promise<number> {
  const out = options.out ?? process.stdout;
  if (argv.length) {
    out.write("usage: aether support-bundle [--json]\n");
    return 2;
  }
  try {
    const { out: _out, ...bundleOptions } = options;
    const result = await createSupportBundle(ctx, bundleOptions);
    if (ctx.flags.json) {
      out.write(JSON.stringify({ path: result.path, bytes: result.bytes, sha256: result.sha256 }) + "\n");
    } else {
      out.write(
        "support bundle written: " + result.path + "\n" +
        "  " + result.bytes + " bytes · sha256 " + result.sha256 + "\n",
      );
    }
    return 0;
  } catch (error) {
    const message = error instanceof SupportBundleError ? error.message : error instanceof Error ? error.message : String(error);
    out.write("support bundle failed: " + message + "\n");
    out.write("no bundle file was produced.\n");
    return 1;
  }
}
