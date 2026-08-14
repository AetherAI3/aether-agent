// `aether output`              — show recent 10 generations
// `aether output open <ref>`   — open by sequence, artifact ID, or ID prefix
// `aether output clean`         — clear log (preserves files)

import type { AppContext } from "../core/context.js";
import { listOutput, findOutput, openOutput, clearOutput, type OutputEntry } from "../core/vision.js";
import { shortId } from "../core/media_history_store.js";
import type { HistoryWarning } from "../core/media_history.js";
import { theme } from "../ui/theme.js";
import { fail } from "../core/errors.js";

export async function cmdOutput(_ctx: AppContext, argv: string[]): Promise<number> {
  const sub = (argv[0] ?? "").toLowerCase();
  if (sub === "open" || sub === "o") return outputOpen(argv.slice(1).join(" "));
  if (sub === "clean" || sub === "clear") return outputClean();
  return outputList();
}

/**
 * A recovered or degraded read is printed before the results, not swallowed.
 * The whole point of the v2 index is that a lost history looks different from
 * an empty one.
 */
function writeWarning(warning: HistoryWarning | undefined): void {
  if (!warning) return;
  process.stderr.write(`\n  ${theme.dim("⚠")}  ${warning.message}\n`);
  if (warning.preservedCorruptPath) {
    process.stderr.write(theme.dim(`     unreadable copy kept at ${warning.preservedCorruptPath}\n`));
  }
  process.stderr.write("\n");
}

function locationOf(entry: OutputEntry): string {
  if (entry.filepath) return entry.filepath;
  return entry.url ? "remote only" : "location unknown";
}

async function outputList(): Promise<number> {
  const { entries, warning } = listOutput(10);
  writeWarning(warning);
  if (entries.length === 0) {
    process.stdout.write(theme.dim("  (no generations yet — run aether image/video first)\n\n"));
    return 0;
  }
  process.stdout.write(`\n${theme.iceBlue("📦")}  RECENT GENERATIONS\n\n`);
  for (const e of entries) {
    const icon = e.kind === "video" ? "🎬" : e.kind === "3d" ? "🧊" : "🖼";
    const size = (e.size_bytes / 1024 / 1024).toFixed(1);
    const detail = e.source === "recovered"
      ? "recovered from disk — prompt and model unknown"
      : `${e.model}  ${size}MB  ${e.prompt.length > 50 ? e.prompt.slice(0, 47) + "..." : e.prompt}`;
    process.stdout.write(
      `  ${theme.iceBlue("#" + e.sequence)} ${icon}  ${e.filename}  ${theme.dim(shortId(e.artifactId))}\n` +
      `     ${theme.dim(detail)}\n` +
      `     ${theme.dim(locationOf(e))}\n`
    );
  }
  process.stdout.write(theme.dim("\n  aether output open <n>  — open in default viewer\n\n"));
  return 0;
}

async function outputOpen(ref: string): Promise<number> {
  if (!ref.trim()) {
    process.stderr.write("usage: aether output open <sequence|artifact-id|filename>\n");
    return 2;
  }
  const lookup = findOutput(ref);
  writeWarning(lookup.warning);

  if (lookup.status === "ambiguous") {
    process.stderr.write(`"${ref}" matches ${lookup.candidates.length} artifacts:\n`);
    for (const c of lookup.candidates) {
      process.stderr.write(`  #${c.sequence}  ${shortId(c.artifactId)}  ${c.filename}\n`);
    }
    process.stderr.write("re-run with a sequence number or a longer artifact ID\n");
    return 1;
  }
  if (lookup.status === "not-found") {
    process.stderr.write(`no output matching "${ref}"\n`);
    return 1;
  }

  try {
    const outcome = openOutput(lookup.entry);
    if (outcome.status === "spawned") {
      process.stdout.write(theme.iceBlue("→") + ` opened ${lookup.entry.filename}\n`);
      return 0;
    }
    process.stderr.write(`could not open ${lookup.entry.filename}: ${outcome.detail}\n`);
    if (lookup.entry.url) process.stderr.write(theme.dim(`  ${lookup.entry.url}\n`));
    return 1;
  } catch (err) { return fail(err); }
}

async function outputClean(): Promise<number> {
  try {
    const count = clearOutput();
    process.stdout.write(theme.dim(`  cleared ${count} generation log entries (files preserved)\n\n`));
    return 0;
  } catch (err) { return fail(err); }
}
