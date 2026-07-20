// src/core/vault.ts — vault API client, same pattern as github.ts
//
// Every function wraps a single ApiClient call. Download/upload/delete go
// through ApiClient's authed getBinary()/postForm()/deleteJson() (not raw
// fetch()) so they get the same refresh-on-401 retry and HttpError
// classification as every other call.

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

/**
 * Upload a local file to the vault. Uses multipart form upload.
 *
 * The file is handed to FormData as an fs.openAsBlob() Blob — backed by the
 * open file handle itself — instead of fs.readFileSync() + new Blob([data]).
 * The old path buffered the ENTIRE file into a Buffer and then copied it a
 * second time into an in-memory Blob before any bytes went over the wire;
 * openAsBlob() defers reading to whenever the multipart encoder actually
 * streams the part out, so a large vault upload no longer holds the whole
 * file in memory twice (mirrors downloadFile()'s stream-straight-to-disk fix
 * for the download side, 1d33357).
 */
export async function uploadFile(
  api: ApiClient, filePath: string,
): Promise<{ key: string; filename: string; size: number; content_type: string }> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const filename = path.basename(filePath);
  const blob = await fs.openAsBlob(filePath);
  const formData = new FormData();
  formData.append("file", blob, filename);
  return api.postForm(VAULT_SPACES_UPLOAD_PATH, formData);
}

/**
 * Download a vault file and save it to a local path. Streams the response
 * body straight to disk (no full-file buffering) so a large or misbehaving
 * download can't grow the CLI process's memory unbounded. Returns the
 * output path.
 */
export async function downloadFile(api: ApiClient, filename: string, outputPath: string): Promise<string> {
  const res = await api.getBinary(VAULT_SPACES_DOWNLOAD_PATH + "/" + encodeURIComponent(filename));
  if (!res.body) throw new Error("download failed: empty body");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { pipeline } = await import("node:stream/promises");
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  await pipeline(res.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(outputPath));
  return outputPath;
}

export async function getSpacesContent(
  api: ApiClient, filename: string,
): Promise<{ success: boolean; binary: boolean; content: string | null; filename: string }> {
  return api.getJson(VAULT_SPACES_CONTENT_PATH + "/" + encodeURIComponent(filename));
}

export async function deleteSpacesFile(
  api: ApiClient, filename: string,
): Promise<{ success: boolean; deleted: string }> {
  return api.deleteJson(VAULT_SPACES_DELETE_PATH + "/" + encodeURIComponent(filename));
}

// ── Notes search ────────────────────────────────

export async function searchNotes(
  api: ApiClient, q: string,
  opts?: { tags?: string; note_type?: string; project?: string; limit?: number },
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