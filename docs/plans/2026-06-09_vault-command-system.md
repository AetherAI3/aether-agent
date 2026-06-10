# Vault Command System — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a complete `/vault` command system to aether-agent, matching the pattern of `aether github` — a top-level CLI command (`aether vault <subcommand>`), in-REPL slash commands (`/vault-*`), and a transport layer talking to the existing AetherCloud backend vault API.

**Architecture:** Mirror the `github` command pattern exactly: `src/core/vault.ts` for API client functions, `src/commands/vault.ts` for CLI dispatch, wire into `src/main.ts` and `src/commands/slash.ts`. Add vault API route constants to `src/core/transport.ts`. No new backend endpoints needed — the AetherCloud API already exposes 18 vault endpoints (list, browse, upload, download, search, notes, staging, context, etc.). The CLI becomes a thin pass-through to the same backend the desktop and web apps already use.

**Tech Stack:** TypeScript, Node.js, no new dependencies. All vault communication goes through the existing `ApiClient` in `transport.ts`.

---

## Current State

| Layer | Status |
|---|---|
| Backend API (`api_server.py`) | 18 vault endpoints live and tested |
| Backend core (`agent/vault_*.py`) | VaultContextLoader, VaultSlash, VaultClient, SessionHook |
| Desktop/Web apps | Full vault UI integrated |
| CLI (`aether-agent`) | **ZERO vault integration** — no commands, no transport routes |

## Backend API Reference

All endpoints require Bearer auth (session token or aek_ API key). The CLI's `ApiClient` already handles this.

| Endpoint | Method | Purpose |
|---|---|---|
| `/vault/list` | GET | List files/folders with stats |
| `/vault/browse` | GET | Browse directory (path query param) |
| `/vault/spaces/list` | GET | Cloud vault file list |
| `/vault/spaces/usage` | GET | Storage usage vs tier cap |
| `/vault/spaces/upload` | POST | Upload file (multipart) |
| `/vault/spaces/download/{name}` | GET | Download file (binary stream) |
| `/vault/spaces/content/{name}` | GET | Get text content (for agents) |
| `/vault/spaces/delete/{name}` | DELETE | Delete file |
| `/vault/notes/search` | GET | FTS5 search (q, tags, type, project) |
| `/vault/notes/by-tag/{tag}` | GET | Notes by tag |
| `/vault/notes/by-type/{type}` | GET | Notes by type |
| `/vault/notes/backlinks/{path}` | GET | Incoming links |
| `/vault/notes/outlinks/{path}` | GET | Outgoing links |
| `/vault/notes/tree` | GET | Folder tree with note counts |
| `/agent/vault/snapshot` | GET | Tiered context block (budget param) |
| `/agent/vault/slash` | POST | Execute slash command (cmd + budget) |
| `/agent/vault/staging` | GET | List staged agent writes |
| `/agent/vault/staging/{id}/accept` | POST | Promote staged write |

---

## Design: Command Surface

### Top-Level: `aether vault <subcommand> [args]`

```
aether vault list              List vault files/folders (organized view)
aether vault browse [path]     Browse a specific directory
aether vault upload <file>     Upload a local file to cloud vault
aether vault download <name>   Download a file from cloud vault
aether vault view <name>       View text content in terminal (piped or paged)
aether vault delete <name>     Delete a file from cloud vault
aether vault search <query>    Full-text search vault notes (FTS5)
aether vault tags              List all distinct tags
aether vault tag <tag>         List notes with a given tag
aether vault type <type>       List notes of a given type
aether vault backlinks <path>  Show backlinks for a note
aether vault outlinks <path>   Show outlinks for a note
aether vault tree              Show folder hierarchy with note counts
aether vault context           Show vault snapshot (folder tree + recent notes)
aether vault usage             Show storage usage vs tier cap
aether vault status            Show vault health (backend reachable, indexed note count)
aether vault help              Show this help
```

### In-REPL Slash Commands: `/vault`, `/vault-*`

```
/vault                 Show vault status/snapshot
/vault-context         Inject vault context into current agent session
/vault-search <query>  Search vault notes
/vault-recent [n]      Show recent notes
/vault-project <name>  Load a project's notes
/vault-tag <tag>       Show notes by tag
/vault-tree            Show folder tree
/vault-upload <file>   Upload a file
```

## Design: File Structure

Following the `github` command pattern exactly:

```
src/core/vault.ts          NEW — API client functions (like github.ts)
src/commands/vault.ts      NEW — CLI command dispatch (like commands/github.ts)
src/core/transport.ts      MODIFY — add vault API route constants
src/main.ts                MODIFY — add "vault" case to switch, add vault to help
src/commands/slash.ts      MODIFY — add /vault slash commands
```

---

## Step-by-Step Tasks

### Task 1: Add vault API route constants to transport.ts

**Objective:** Define all vault API path constants in the transport module, following the existing pattern for GITHUB_CONNECT_PATH, etc.

**Files:**
- Modify: `src/core/transport.ts`

**Step 1: Add vault path constants**

Add these exports after the existing AGENTS_PATH export:

```typescript
// ── Vault (cloud file storage) ─────────────────────
export const VAULT_LIST_PATH = "/vault/list";
export const VAULT_BROWSE_PATH = "/vault/browse";
export const VAULT_SPACES_LIST_PATH = "/vault/spaces/list";
export const VAULT_SPACES_USAGE_PATH = "/vault/spaces/usage";
export const VAULT_SPACES_UPLOAD_PATH = "/vault/spaces/upload";
export const VAULT_SPACES_DOWNLOAD_PATH = "/vault/spaces/download";
export const VAULT_SPACES_CONTENT_PATH = "/vault/spaces/content";
export const VAULT_SPACES_DELETE_PATH = "/vault/spaces/delete";
export const VAULT_NOTES_SEARCH_PATH = "/vault/notes/search";
export const VAULT_NOTES_BY_TAG_PATH = "/vault/notes/by-tag";
export const VAULT_NOTES_BY_TYPE_PATH = "/vault/notes/by-type";
export const VAULT_NOTES_BACKLINKS_PATH = "/vault/notes/backlinks";
export const VAULT_NOTES_OUTLINKS_PATH = "/vault/notes/outlinks";
export const VAULT_NOTES_TREE_PATH = "/vault/notes/tree";
export const AGENT_VAULT_SNAPSHOT_PATH = "/agent/vault/snapshot";
export const AGENT_VAULT_SLASH_PATH = "/agent/vault/slash";
export const AGENT_VAULT_STAGING_PATH = "/agent/vault/staging";
```

**Verify:** No changes to behavior — just adding constants.

### Task 2: Create vault core API client module

**Objective:** Create `src/core/vault.ts` with typed API functions for all vault endpoints, following the exact pattern of `src/core/github.ts`.

**Files:**
- Create: `src/core/vault.ts`

**Step 1: Define TypeScript types**

```typescript
// src/core/vault.ts — vault API client, same pattern as github.ts

import { ApiClient } from "./transport.js";
import {
  VAULT_LIST_PATH, VAULT_BROWSE_PATH,
  VAULT_SPACES_LIST_PATH, VAULT_SPACES_USAGE_PATH,
  VAULT_SPACES_UPLOAD_PATH, VAULT_SPACES_DOWNLOAD_PATH,
  VAULT_SPACES_CONTENT_PATH, VAULT_SPACES_DELETE_PATH,
  VAULT_NOTES_SEARCH_PATH, VAULT_NOTES_BY_TAG_PATH,
  VAULT_NOTES_BY_TYPE_PATH, VAULT_NOTES_BACKLINKS_PATH,
  VAULT_NOTES_OUTLINKS_PATH, VAULT_NOTES_TREE_PATH,
  AGENT_VAULT_SNAPSHOT_PATH, AGENT_VAULT_SLASH_PATH,
} from "./transport.js";

// ── Response types ────────────────────────────────

export interface VaultFile {
  name: string; path: string; size: number; size_display: string;
  extension: string; category: string; icon: string;
  modified: string; content_hash: string;
}

export interface VaultFolder {
  id: string; name: string; icon: string; count: number; files: VaultFile[];
}

export interface VaultListResponse {
  folders: VaultFolder[]; stats: VaultStats;
}

export interface VaultStats {
  vault_root: string; file_count: number; folder_count: number;
  total_size_bytes?: number; total_size_mb?: number;
}

export interface VaultBrowseItem {
  name: string; path: string; icon: string;
  size?: string; size_bytes?: number; extension?: string;
  category?: string; modified: string; file_count?: number;
}

export interface VaultBrowseResponse {
  vault_root: string; folders: VaultBrowseItem[]; files: VaultBrowseItem[];
  stats: { total_files: number; total_folders: number };
  error?: string;
}

export interface VaultSpacesFile {
  key: string; filename: string; size: number; last_modified: string;
}

export interface VaultSpacesUsage {
  used_bytes: number; cap_bytes: number; tier: string; file_count: number;
}

export interface VaultNoteResult {
  path: string; title: string | null; note_type: string | null;
  status: string | null; project: string | null; tags: string[];
  body_chars: number; modified_at: number | null;
}

export interface VaultSearchResponse { results: VaultNoteResult[]; }

export interface VaultTagResponse { tag: string; results: VaultNoteResult[]; }

export interface VaultTypeResponse { note_type: string; results: VaultNoteResult[]; }

export interface VaultBacklinkRow { src_path: string; }

export interface VaultBacklinksResponse { path: string; backlinks: VaultBacklinkRow[]; }

export interface VaultOutlinkRow { dst_path: string | null; dst_unresolved: string | null; }

export interface VaultOutlinksResponse { path: string; outlinks: VaultOutlinkRow[]; }

export interface VaultTreeEntry { folder: string; count: number; }

export interface VaultTreeResponse { tree: VaultTreeEntry[]; }

export interface VaultSnapshotResponse {
  tree: string; summaries: string; total_tokens: number; note_count: number;
}

export interface VaultSlashResponse {
  command: string; content: string; note_count: number; ok: boolean; error?: string;
}
```

**Step 2: Implement API functions**

Each function wraps a single `ctx.api.getJson<T>()` or `ctx.api.postJson<T>()` call — exactly like `getGithubStatus()` in github.ts:

```typescript
// ── Vault list / browse ──────────────────────────

export async function getVaultList(api: ApiClient): Promise<VaultListResponse> {
  return api.getJson<VaultListResponse>(VAULT_LIST_PATH);
}

export async function browseVault(api: ApiClient, path?: string): Promise<VaultBrowseResponse> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  return api.getJson<VaultBrowseResponse>(VAULT_BROWSE_PATH + qs);
}

// ── Spaces (cloud storage) ──────────────────────

export async function listSpaces(api: ApiClient): Promise<{ success: boolean; files: VaultSpacesFile[]; count: number }> {
  return api.getJson(VAULT_SPACES_LIST_PATH);
}

export async function getSpacesUsage(api: ApiClient): Promise<VaultSpacesUsage> {
  return api.getJson(VAULT_SPACES_USAGE_PATH);
}

export async function downloadSpacesFile(api: ApiClient, filename: string): Promise<ArrayBuffer> {
  // Raw fetch for binary download — ApiClient doesn't expose raw bytes
  const t = await api["tokens"]?.get?.();
  const headers: Record<string, string> = {};
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(
    (api as any).baseUrl?.replace(/\/$/, "") + VAULT_SPACES_DOWNLOAD_PATH + "/" + encodeURIComponent(filename),
    { headers }
  );
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  return res.arrayBuffer();
}

export async function getSpacesContent(
  api: ApiClient, filename: string
): Promise<{ success: boolean; binary: boolean; content: string | null; filename: string }> {
  return api.getJson(VAULT_SPACES_CONTENT_PATH + "/" + encodeURIComponent(filename));
}

export async function deleteSpacesFile(
  api: ApiClient, filename: string
): Promise<{ success: boolean; deleted: string }> {
  // ApiClient doesn't expose delete — use raw fetch
  const t = await api["tokens"]?.get?.();
  const headers: Record<string, string> = {};
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(
    (api as any).baseUrl?.replace(/\/$/, "") + VAULT_SPACES_DELETE_PATH + "/" + encodeURIComponent(filename),
    { method: "DELETE", headers }
  );
  if (!res.ok) throw new Error(`delete failed: HTTP ${res.status}`);
  return res.json();
}

// ── Notes search ────────────────────────────────

export async function searchNotes(
  api: ApiClient, q: string, opts?: { tags?: string; note_type?: string; project?: string; limit?: number }
): Promise<VaultSearchResponse> {
  const params = new URLSearchParams({ q });
  if (opts?.tags) params.set("tags", opts.tags);
  if (opts?.note_type) params.set("note_type", opts.note_type);
  if (opts?.project) params.set("project", opts.project);
  if (opts?.limit) params.set("limit", String(opts.limit));
  return api.getJson(VAULT_NOTES_SEARCH_PATH + "?" + params.toString());
}

export async function notesByTag(api: ApiClient, tag: string, limit?: number): Promise<VaultTagResponse> {
  const qs = limit ? `?limit=${limit}` : "";
  return api.getJson(VAULT_NOTES_BY_TAG_PATH + "/" + encodeURIComponent(tag) + qs);
}

export async function notesByType(api: ApiClient, noteType: string, limit?: number): Promise<VaultTypeResponse> {
  const qs = limit ? `?limit=${limit}` : "";
  return api.getJson(VAULT_NOTES_BY_TYPE_PATH + "/" + encodeURIComponent(noteType) + qs);
}

export async function getBacklinks(api: ApiClient, path: string): Promise<VaultBacklinksResponse> {
  return api.getJson(VAULT_NOTES_BACKLINKS_PATH + "/" + encodeURIComponent(path));
}

export async function getOutlinks(api: ApiClient, path: string): Promise<VaultOutlinksResponse> {
  return api.getJson(VAULT_NOTES_OUTLINKS_PATH + "/" + encodeURIComponent(path));
}

export async function getNotesTree(api: ApiClient): Promise<VaultTreeResponse> {
  return api.getJson(VAULT_NOTES_TREE_PATH);
}

// ── Agent vault (context, slash) ────────────────

export async function getVaultSnapshot(api: ApiClient, budget?: number): Promise<VaultSnapshotResponse> {
  const qs = budget ? `?budget=${budget}` : "";
  return api.getJson(AGENT_VAULT_SNAPSHOT_PATH + qs);
}

export async function vaultSlash(api: ApiClient, cmd: string, budget?: number): Promise<VaultSlashResponse> {
  return api.postJson(AGENT_VAULT_SLASH_PATH, { cmd, budget: budget ?? 2000 });
}
```

**Verify:** TypeScript compiles cleanly — `npx tsc --noEmit`

### Task 3: Create vault CLI command module

**Objective:** Create `src/commands/vault.ts` with CLI dispatch, help text, and rendering — following the exact pattern of `src/commands/github.ts`.

**Files:**
- Create: `src/commands/vault.ts`

**Step: Full implementation**

```typescript
// `aether vault <list|browse|upload|download|view|delete|search|tags|tag|type|backlinks|outlinks|tree|context|usage|status|help>`
// Same pattern as aether github — subcommand dispatch with typed API calls.

import type { AppContext } from "../core/context.js";
import {
  getVaultList, browseVault,
  listSpaces, getSpacesUsage, getSpacesContent, deleteSpacesFile,
  searchNotes, notesByTag, notesByType,
  getBacklinks, getOutlinks, getNotesTree,
  getVaultSnapshot, vaultSlash,
  type VaultListResponse, type VaultBrowseResponse,
  type VaultSpacesUsage, type VaultSearchResponse,
  type VaultTreeResponse, type VaultSnapshotResponse,
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
  process.stderr.write(`${feature} — coming soon (multipart upload support).\n`);
  return Promise.resolve(1);
}

function printVaultHelp(): void {
  process.stdout.write([
    "aether vault list              List vault files/folders",
    "aether vault browse [path]     Browse a directory",
    "aether vault upload <file>     Upload file to cloud vault",
    "aether vault download <name>   Download file from cloud vault",
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
      `  notes:   ${totalNotes} indexed  (${tree.tree.length} folders)\n`
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
    process.stdout.write("📁 Folders:\n");
    for (const f of r.folders) process.stdout.write(`  📁 ${f.name}/  (${f.file_count ?? 0} files)\n`);
  }
  if (r.files.length > 0) {
    process.stdout.write("📄 Files:\n");
    for (const f of r.files) process.stdout.write(`  ${f.icon ?? "📄"} ${f.name}  ${f.size ?? "?"}  ${f.extension ?? ""}\n`);
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
```

**Verify:** TypeScript compiles cleanly — `npx tsc --noEmit`

### Task 4: Wire vault command into main.ts

**Objective:** Add the "vault" case to the main command switch, import cmdVault, and add vault to the help text.

**Files:**
- Modify: `src/main.ts`

**Step 1: Import cmdVault**

After the github import line:
```typescript
import { cmdVault } from "./commands/vault.js";
```

**Step 2: Add case to switch**

After the `case "github":` block:
```typescript
case "vault":
  return cmdVault(ctx, rest);
```

**Step 3: Add to help text**

In the HELP string, add after the github lines:
```
  aether vault list              List vault files/folders
  aether vault search <query>    Full-text search vault notes
  aether vault context           Show vault snapshot
  aether vault status            Vault health check
  aether vault <sub>             (see `aether vault help` for all)
```

**Verify:** `aether vault status` returns vault health info. `aether vault help` shows subcommands.

### Task 5: Add vault slash commands to REPL

**Objective:** Add `/vault`, `/vault-context`, `/vault-search`, `/vault-recent`, `/vault-project`, `/vault-tag`, `/vault-tree` to the in-REPL slash command handler.

**Files:**
- Modify: `src/commands/slash.ts`

**Step 1: Import vault functions**

```typescript
import { getVaultSnapshot, searchNotes, vaultSlash } from "../core/vault.js";
```

**Step 2: Add cases to handleSlash switch**

After the existing `/audit` case:
```typescript
case "vault": {
  await vaultStatusSlash(ctx, out);
  break;
}
case "vault-context": {
  await vaultContextSlash(ctx, out);
  break;
}
case "vault-search": {
  await vaultSearchSlash(ctx, out, arg);
  break;
}
case "vault-recent": {
  await vaultRecentSlash(ctx, out, arg);
  break;
}
case "vault-project": {
  await vaultProjectSlash(ctx, out, arg);
  break;
}
case "vault-tag": {
  await vaultTagSlash(ctx, out, arg);
  break;
}
case "vault-tree": {
  await vaultTreeSlash(ctx, out);
  break;
}
```

**Step 3: Implement handler functions**

```typescript
async function vaultStatusSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    const r = await getVaultSnapshot(ctx.api, 800);
    out.write(`vault: ${r.note_count} notes\n`);
  } catch {
    out.write("vault: unreachable\n");
  }
}

async function vaultContextSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    const r = await getVaultSnapshot(ctx.api, 2000);
    out.write("vault context loaded for next turn.\n");
    // Content is available in r.tree + r.summaries — injected into next prompt
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function vaultSearchSlash(ctx: AppContext, out: Writable, query: string): Promise<void> {
  if (!query) { out.write("usage: /vault-search <query>\n"); return; }
  try {
    const r = await searchNotes(ctx.api, query, { limit: 10 });
    if (r.results.length === 0) { out.write("no results.\n"); return; }
    for (const n of r.results) {
      out.write(`  ${n.title || n.path}  (${n.path})\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function vaultRecentSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  try {
    const n = Math.min(parseInt(arg) || 10, 50);
    const r = await searchNotes(ctx.api, "", { limit: n });
    if (r.results.length === 0) { out.write("(empty vault)\n"); return; }
    for (const n of r.results) {
      out.write(`  ${n.title || n.path}\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function vaultProjectSlash(ctx: AppContext, out: Writable, name: string): Promise<void> {
  if (!name) { out.write("usage: /vault-project <name>\n"); return; }
  try {
    const r = await searchNotes(ctx.api, "", { project: name, limit: 20 });
    if (r.results.length === 0) { out.write(`no notes for project: ${name}\n`); return; }
    for (const n of r.results) {
      out.write(`  ${n.title || n.path}  [${n.tags.join(", ")}]\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function vaultTagSlash(ctx: AppContext, out: Writable, tag: string): Promise<void> {
  if (!tag) { out.write("usage: /vault-tag <tag>\n"); return; }
  try {
    const r = await notesByTag(ctx.api, tag, 20);
    if (r.results.length === 0) { out.write(`no notes with tag: ${tag}\n`); return; }
    for (const n of r.results) {
      out.write(`  ${n.title || n.path}  (${n.path})\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function vaultTreeSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    const r = await getNotesTree(ctx.api);
    if (r.tree.length === 0) { out.write("(empty vault)\n"); return; }
    for (const e of r.tree) {
      out.write(`  ${e.folder || "/"}  (${e.count} notes)\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
```

**Step 4: Update help text**

Add to the `printHelp` function:
```
"/vault                vault status",
"/vault-context        load vault context into session",
"/vault-search <q>     search vault notes",
"/vault-recent [n]     recent vault notes",
"/vault-project <name> list project notes",
"/vault-tag <tag>      list notes by tag",
"/vault-tree           vault folder tree",
```

**Step 5: Import notesByTag in slash.ts**

Add to the imports:
```typescript
import { getVaultSnapshot, searchNotes, notesByTag, getNotesTree } from "../core/vault.js";
```

### Task 6: Build and verify

**Objective:** Compile TypeScript and run a live test against the backend.

**Files:** None (verification only)

**Step 1: Build**
```bash
cd /root/aether-agent && npx tsc --noEmit
```
Expected: no errors.

**Step 2: Verify commands**
```bash
node --loader ts-node/esm src/main.ts vault status
node --loader ts-node/esm src/main.ts vault usage
node --loader ts-node/esm src/main.ts vault tree
node --loader ts-node/esm src/main.ts vault context
```
Expected: each returns real data from the backend.

**Step 3: Test slash commands (manual)**
Type `aether` to enter REPL, then:
```
/vault
/vault-tree
/vault-search test
```
Expected: each returns correct output.

---

## Implementation Order

| Order | Task | File | Complexity |
|---|---|---|---|
| 1 | Add vault route constants | transport.ts | Trivial |
| 2 | Create vault core module | core/vault.ts | Medium |
| 3 | Create vault CLI command | commands/vault.ts | Medium |
| 4 | Wire into main.ts | main.ts | Trivial |
| 5 | Add slash commands | slash.ts | Medium |
| 6 | Build + verify | — | Verification |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Download endpoint returns binary — ApiClient has no raw-bytes fetch | Use native `fetch()` for download, mirror the auth header pattern |
| DELETE endpoint not in ApiClient | Same — raw `fetch()` with DELETE method |
| Upload requires multipart form data | Defer to "coming soon" — needs FormData + file read, nontrivial |
| Some endpoints 404 if vault not configured on backend | Graceful error message: "vault not configured — upload a file from the Aether app first" |
| Token not present or expired | Standard `✗ ${msg}\n  (are you logged in? run: aether auth login)\n` pattern |

## Open Questions

1. **Vault context injection in chat sessions** — Should `aether chat` auto-prepend vault context to the system prompt? The backend already does this server-side via `session_hook.py`. The CLI might not need to duplicate this, but making `/vault-context` available in-REPL gives users explicit control.

2. **Upload from terminal** — Requires reading local files, FormData, and multipart POST. Deferred to follow-up PR. Could use `aether vault upload <path>` with `fs.readFileSync` + `FormData`.

3. **Download location** — Where to save downloaded files? Default to cwd. Add `--output <path>` flag later.