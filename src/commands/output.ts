// `aether output`              — show recent 10 generations
// `aether output open <n>`     — open generation #n
// `aether output clean`         — clear log (preserves files)

import type { AppContext } from "../core/context.js";
import { listOutput, findOutput, openOutput, clearOutput } from "../core/vision.js";
import { theme } from "../ui/theme.js";

export async function cmdOutput(ctx: AppContext, argv: string[]): Promise<number> {
  const sub = (argv[0] ?? "").toLowerCase();
  if (sub === "open" || sub === "o") return outputOpen(argv[1]);
  if (sub === "clean" || sub === "clear") return outputClean();
  return outputList();
}

async function outputList(): Promise<number> {
  const entries = listOutput(10);
  if (entries.length === 0) {
    process.stdout.write(theme.dim("  (no generations yet — run aether image/video first)\n\n"));
    return 0;
  }
  process.stdout.write(`\n${theme.iceBlue("📦")}  RECENT GENERATIONS\n\n`);
  for (const e of entries) {
    const icon = e.kind === "video" ? "🎬" : e.kind === "3d" ? "🧊" : "🖼";
    const size = (e.size_bytes / 1024 / 1024).toFixed(1);
    const sp = e.prompt.length > 50 ? e.prompt.slice(0, 47) + "..." : e.prompt;
    process.stdout.write(
      `  ${theme.iceBlue("#" + e.index)} ${icon}  ${e.filename}\n` +
      `     ${theme.dim(`${e.model}  ${size}MB  ${sp}`)}\n`
    );
  }
  process.stdout.write(theme.dim("\n  aether output open <n>  — open in default viewer\n\n"));
  return 0;
}

async function outputOpen(ref?: string): Promise<number> {
  if (!ref) { process.stderr.write("usage: aether output open <index|filename>\n"); return 2; }
  const entry = findOutput(ref);
  if (!entry) { process.stderr.write(`no output matching "${ref}"\n`); return 1; }
  try {
    openOutput(entry);
    process.stdout.write(theme.iceBlue("→") + ` opened ${entry.filename}\n`);
    return 0;
  } catch (err) { return fail(err); }
}

async function outputClean(): Promise<number> {
  const count = clearOutput();
  process.stdout.write(theme.dim(`  cleared ${count} generation log entries (files preserved)\n\n`));
  return 0;
}

function fail(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`✗ ${msg}\n`);
  return 1;
}
