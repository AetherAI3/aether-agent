// aether vault <list|browse|view|delete|search|tags|tag|type|backlinks|outlinks|tree|context|usage|status|help>
// Same pattern as aether github — subcommand dispatch with typed API calls.
// Upload/download deferred (multipart + raw-binary plumbing needed).

import type { AppContext } from "../core/context.js";
import {
  getVaultList, browseVault,
  getSpacesUsage, getSpacesContent, deleteSpacesFile,
  searchNotes, notesByTag, notesByType,
  getBacklinks, getOutlinks, getNotesTree,
  getVaultSnapshot,
  type VaultListResponse, type VaultBrowseResponse,
  type VaultSearchResponse,
} from "../core/vault.js";

export async function cmdVault(ctx: AppContext, argv: string[]): Promise<number> {
  const sub = (argv[0] ?? "status").toLowerCase();
  switch (sub) {
    case "list":       return vaultList(ctx);
    case "browse":     return vaultBrowse(ctx, argv[1]);
    case "upload":     return notYet("vault upload");
    case "download":   return notYet("vault download");
    case "view":       return vaultView(ctx, argv[1]);
    case "delete":     return vaultDelete(ctx, argv[1]);
    case "search":     return vaultSearch(ctx, argv.slice(1).join(" "));
    case "tags":       return vaultTags(ctx);
    case "tag":        return vaultTag(ctx, argv[1]);
    case "type":       return vaultType(ctx, argv[1]);
    case "backlinks":  return vaultBacklinks(ctx, argv[1]);
    case "outlinks":   return vaultOutlinks(ctx, argv[1]);
    case "tree":       return vaultTree(ctx);
    case "context":    return vaultContext(ctx);
    case "usage":      return vaultUsage(ctx);
    case "status":     return vaultStatus(ctx);
    case "help":
    case "":           printVaultHelp(); return 0;
    default:
      process.stderr.write(`unknown: aether vault ${sub}\n`);
      printVaultHelp();
      return 2;
  }
}

function notYet(feature: string): Promise<number> {
  process.stderr.write(`${feature} — coming soon (multipart + raw-binary plumbing needed).\n`);
  return Promise.resolve(1);
}

function printVaultHelp(): void {
  process.stdout.write([
    "aether vault list              List vault files/folders",
    "aether vault browse [path]     Browse a directory",
    "aether vault upload <file>     Upload file to cloud vault (coming soon)",
    "aether vault download <name>   Download file from cloud vault (coming soon)",
    "aether vault view <name>       View text content of vault file",
    "aether vault delete <name>     Delete a vault file",
    "aether vault search <query>    Full-text search vault notes",
    "aether vault tags              List all distinct tags",
    "aether vault tag <tag>         List notes by tag",
    "aether vault type <type>       List notes by type",
    "aether vault backlinks <path>  Show backlinks for a note",
    "aether vault outlinks <path>   Show outlinks for a note",
    "aether vault tree              Folder hierarchy with note counts",
    "aether vault context           Vault snapshot for agent consumption",
    "aether vault usage             Storage usage vs tier cap",
    "aether vault status            Vault health check",
    "",
  ].join("\n"));
}

// ── Handlers ─────────────────────────────────────

async function vaultList(ctx: AppContext): Promise<number> {
  try {
    const r = await getVaultList(ctx.api);
    renderVaultList(r);
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultBrowse(ctx: AppContext, path?: string): Promise<number> {
  try {
    const r = await browseVault(ctx.api, path);
    if (r.error) { process.stderr.write(`${r.error}\n`); return 1; }
    renderBrowse(r);
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultView(ctx: AppContext, name?: string): Promise<number> {
  if (!name) { process.stderr.write("usage: aether vault view <filename>\n"); return 1; }
  try {
    const r = await getSpacesContent(ctx.api, name);
    if (r.binary) { process.stdout.write(`[binary file: ${name}]\n`); return 0; }
    process.stdout.write((r.content ?? "(empty)") + "\n");
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultDelete(ctx: AppContext, name?: string): Promise<number> {
  if (!name) { process.stderr.write("usage: aether vault delete <filename>\n"); return 1; }
  try {
    const ok = await ctx.confirm(`Delete ${name} from vault? [y/N] `);
    if (!ok) { process.stdout.write("cancelled.\n"); return 0; }
    const r = await deleteSpacesFile(ctx.api, name);
    process.stdout.write(`deleted: ${r.deleted}\n`);
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultSearch(ctx: AppContext, query: string): Promise<number> {
  if (!query) { process.stderr.write("usage: aether vault search <query>\n"); return 1; }
  try {
    const r = await searchNotes(ctx.api, query);
    renderSearchResults(r, query);
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultTags(ctx: AppContext): Promise<number> {
  try {
    const r = await searchNotes(ctx.api, "", { limit: 200 });
    const tags = new Set<string>();
    for (const n of r.results) for (const t of n.tags) tags.add(t);
    if (tags.size === 0) { process.stdout.write("(no tags)\n"); return 0; }
    process.stdout.write([...tags].sort().join("\n") + "\n");
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultTag(ctx: AppContext, tag?: string): Promise<number> {
  if (!tag) { process.stderr.write("usage: aether vault tag <tag>\n"); return 1; }
  try {
    const r = await notesByTag(ctx.api, tag);
    if (r.results.length === 0) { process.stdout.write(`no notes with tag: ${tag}\n`); return 0; }
    for (const n of r.results) process.stdout.write(`  ${n.title || n.path}  (${n.path})\n`);
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultType(ctx: AppContext, noteType?: string): Promise<number> {
  if (!noteType) { process.stderr.write("usage: aether vault type <type>\n"); return 1; }
  try {
    const r = await notesByType(ctx.api, noteType);
    if (r.results.length === 0) { process.stdout.write(`no notes of type: ${noteType}\n`); return 0; }
    for (const n of r.results) process.stdout.write(`  ${n.title || n.path}  (${n.path})\n`);
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultBacklinks(ctx: AppContext, path?: string): Promise<number> {
  if (!path) { process.stderr.write("usage: aether vault backlinks <path>\n"); return 1; }
  try {
    const r = await getBacklinks(ctx.api, path);
    if (r.backlinks.length === 0) { process.stdout.write(`no backlinks for: ${path}\n`); return 0; }
    for (const b of r.backlinks) process.stdout.write(`  ← ${b.src_path}\n`);
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultOutlinks(ctx: AppContext, path?: string): Promise<number> {
  if (!path) { process.stderr.write("usage: aether vault outlinks <path>\n"); return 1; }
  try {
    const r = await getOutlinks(ctx.api, path);
    if (r.outlinks.length === 0) { process.stdout.write(`no outlinks for: ${path}\n`); return 0; }
    for (const o of r.outlinks) {
      const dst = o.dst_path || o.dst_unresolved || "?";
      process.stdout.write(`  → ${dst}\n`);
    }
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultTree(ctx: AppContext): Promise<number> {
  try {
    const r = await getNotesTree(ctx.api);
    if (r.tree.length === 0) { process.stdout.write("(empty vault)\n"); return 0; }
    for (const e of r.tree) process.stdout.write(`  ${e.folder || "/"}  (${e.count} notes)\n`);
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultContext(ctx: AppContext): Promise<number> {
  try {
    const r = await getVaultSnapshot(ctx.api, 2000);
    process.stdout.write(r.tree + "\n");
    if (r.summaries) process.stdout.write("\n" + r.summaries + "\n");
    process.stdout.write(`\n${r.note_count} notes · ~${r.total_tokens} tokens\n`);
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultUsage(ctx: AppContext): Promise<number> {
  try {
    const r = await getSpacesUsage(ctx.api);
    const usedMB = Math.round(r.used_bytes / (1024 * 1024));
    const capMB = Math.round(r.cap_bytes / (1024 * 1024));
    const pct = r.cap_bytes > 0 ? Math.round((r.used_bytes / r.cap_bytes) * 100) : 0;
    process.stdout.write(`tier: ${r.tier}  ·  ${usedMB} / ${capMB} MB  ·  ${pct}%  ·  ${r.file_count} files\n`);
    return 0;
  } catch (err) { return fail(err); }
}

async function vaultStatus(ctx: AppContext): Promise<number> {
  try {
    const usage = await getSpacesUsage(ctx.api);
    const tree = await getNotesTree(ctx.api);
    const totalNotes = tree.tree.reduce((s, e) => s + e.count, 0);
    const usedMB = Math.round(usage.used_bytes / (1024 * 1024));
    const capMB = Math.round(usage.cap_bytes / (1024 * 1024));
    process.stdout.write(
      `vault: ✓ reachable\n` +
      `  tier:    ${usage.tier}\n` +
      `  storage: ${usedMB} / ${capMB} MB  (${usage.file_count} files)\n` +
      `  notes:   ${totalNotes} indexed  (${tree.tree.length} folders)\n`,
    );
    return 0;
  } catch (err) { return fail(err); }
}

// ── Render helpers ───────────────────────────────

function renderVaultList(r: VaultListResponse): void {
  for (const folder of r.folders) {
    process.stdout.write(`\n${folder.icon} ${folder.name}/  (${folder.count} files)\n`);
    for (const f of folder.files) {
      process.stdout.write(`  ${f.icon} ${f.name}  ${f.size_display}  ${f.extension}  ${f.category}\n`);
    }
  }
  const s = r.stats;
  process.stdout.write(`\n${s.file_count} files · ${s.folder_count} folders\n`);
}

function renderBrowse(r: VaultBrowseResponse): void {
  if (r.folders.length > 0) {
    process.stdout.write("Folders:\n");
    for (const f of r.folders) process.stdout.write(`  ${f.name}/  (${f.file_count ?? 0} files)\n`);
  }
  if (r.files.length > 0) {
    process.stdout.write("Files:\n");
    for (const f of r.files) process.stdout.write(`  ${f.name}  ${f.size ?? "?"}  ${f.extension ?? ""}\n`);
  }
  if (r.folders.length === 0 && r.files.length === 0) process.stdout.write("(empty directory)\n");
  process.stdout.write(`\n${r.stats.total_files} files · ${r.stats.total_folders} folders\n`);
}

function renderSearchResults(r: VaultSearchResponse, query: string): void {
  if (r.results.length === 0) { process.stdout.write(`no results for: ${query}\n`); return; }
  process.stdout.write(`${r.results.length} results for "${query}":\n\n`);
  for (const n of r.results) {
    const tags = n.tags.length > 0 ? `  [${n.tags.join(", ")}]` : "";
    process.stdout.write(`  ${n.title || n.path}\n`);
    process.stdout.write(`  ${n.path}  ·  ${n.note_type || "-"}${tags}\n\n`);
  }
}

function fail(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`✗ ${msg}\n  (are you logged in? run: aether auth login)\n`);
  return 1;
}