// src/core/vision.ts — media asset production engine
//
// Pure logic: model shortcuts, auto-routing, aspect ratios, prompt builder,
// download helpers with streaming fetch, output manager with persistent log.
// No terminal I/O. Every function wraps a single concept.

import { ApiClient, isCredentialSafeUrl } from "./transport.js";
import { InsecureTransportError } from "./errors.js";
import type { CatalogItem } from "../types.js";
import { createWriteStream, mkdirSync, readdirSync, statSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { execSync } from "node:child_process";

// ═════════════════════════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════════════════════════════

export const VISION_PREFIX = "vision_";

export type MediaKind = "image" | "video" | "3d";

export interface MediaModel {
  id: string;
  label: string;
  kind: MediaKind;
  provider: string | null;
  tier_min: string | null;
  available: boolean;
  enabled: boolean;
  monthly_uvt_cap: number | null;
}

export interface AspectRatio {
  value: string;
  display: string;
  w: number; h: number;
}

export interface GenFlags {
  model?: string;
  aspect?: string;
  count?: number;
  fourK?: boolean;
  vector?: boolean;
  duration?: number;
  hd1080?: boolean;
  audio?: boolean;
  saveToVault?: boolean;
  ref?: string;
  open?: boolean;
}

export interface GenResult {
  model: string;
  prompt: string;
  kind: MediaKind;
  filepath: string;
  filename: string;
  url: string;
  timestamp: string;
  flags: GenFlags;
  // storyboard fields (set during storyboard render)
  generated_frame_url?: string;
  generated_frame_path?: string;
}

export interface OutputEntry {
  index: number;
  filename: string;
  filepath: string;
  model: string;
  prompt: string;
  kind: MediaKind;
  url: string;
  timestamp: string;
  size_bytes: number;
}

export interface ChatGenResponse {
  response?: string; text?: string;
  media_url?: string; filename?: string;
}

export const ASPECT_RATIOS: Record<string, AspectRatio> = {
  "16_9": { value: "16_9", display: "16:9", w: 16, h: 9 },
  "9_16": { value: "9_16", display: "9:16", w: 9, h: 16 },
  "1_1":  { value: "1_1",  display: "1:1",  w: 1,  h: 1 },
  "3_4":  { value: "3_4",  display: "3:4",  w: 3,  h: 4 },
  "4_3":  { value: "4_3",  display: "4:3",  w: 4,  h: 3 },
};

// ═════════════════════════════════════════════════════════════════════
// Model shortcuts
// ═════════════════════════════════════════════════════════════════════

export const IMAGE_SHORTCUTS: Record<string, string> = {
  "nano":    "vision_nano_pro",
  "recraft": "vision_recraft",
  "edit":    "vision_gpt_image2",
};

export const VIDEO_SHORTCUTS: Record<string, string> = {
  "seedance": "vision_seedance",
  "veo":      "vision_veo31",
  "kling":    "vision_kling",
  "hvideo":   "vision_hunyuan_video",
};

export const MEDIA_3D_SHORTCUTS: Record<string, string> = {
  "3d": "vision_hunyuan3d",
};

export const ALL_SHORTCUTS: Record<string, string> = {
  ...IMAGE_SHORTCUTS, ...VIDEO_SHORTCUTS, ...MEDIA_3D_SHORTCUTS,
};

export function resolveModelKey(arg: string): string {
  return ALL_SHORTCUTS[arg.toLowerCase()] ?? arg;
}

export function mediaKind(id: string): MediaKind {
  if (id.includes("3d")) return "3d";
  if (IMAGE_SHORTCUTS[id] || id.includes("nano") || id.includes("recraft") || id.includes("image")) return "image";
  return "video";
}

// ═════════════════════════════════════════════════════════════════════
// Model discovery (from GET /models catalog)
// ═════════════════════════════════════════════════════════════════════

export function isVisionItem(item: CatalogItem): boolean {
  return item.kind === "model" && item.id.startsWith(VISION_PREFIX);
}

export function filterMediaModels(items: CatalogItem[], kind?: MediaKind): MediaModel[] {
  let filtered = items.filter(isVisionItem);
  if (kind) {
    if (kind === "image") filtered = filtered.filter(m => !m.id.includes("video") && !m.id.includes("3d"));
    else if (kind === "video") filtered = filtered.filter(m => m.id.includes("video"));
    else if (kind === "3d") filtered = filtered.filter(m => m.id.includes("3d"));
  }
  return filtered.map(m => ({
    id: m.id, label: m.label, kind: mediaKind(m.id),
    provider: m.provider, tier_min: m.tier_min,
    available: m.available, enabled: m.enabled,
    monthly_uvt_cap: m.monthly_uvt_cap,
  })).sort((a, b) => a.id.localeCompare(b.id));
}

// ═════════════════════════════════════════════════════════════════════
// Auto-model routing
// ═════════════════════════════════════════════════════════════════════

export function autoRouteModel(prompt: string, kind: MediaKind): string {
  const p = prompt.toLowerCase();
  if (kind === "video") {
    if (/talking|dialogue|narration|voice|speak/.test(p)) return "veo";
    if (/draft|quick|test|budget|cheap/.test(p)) return "kling";
    return "seedance";
  }
  if (/vector|logo|brand|icon|svg|design.system/.test(p)) return "recraft";
  if (/edit|fix|change|inpaint|modify|touch.up|retouch/.test(p)) return "edit";
  return "nano";
}

// ═════════════════════════════════════════════════════════════════════
// Prompt builder
// ═════════════════════════════════════════════════════════════════════

export function buildMediaPrompt(prompt: string, flags: GenFlags, _kind: MediaKind): string {
  const parts: string[] = [prompt];
  if (flags.aspect && ASPECT_RATIOS[flags.aspect]) {
    const ar = ASPECT_RATIOS[flags.aspect]!;
    parts.push(`[aspect ratio: ${ar.display}]`);
  }
  if (flags.fourK) parts.push("[4K resolution]");
  if (flags.vector) parts.push("[SVG vector output]");
  if (flags.duration) parts.push(`[${flags.duration}s video]`);
  if (flags.hd1080) parts.push("[1080p]");
  if (flags.audio) parts.push("[with native synchronized audio]");
  if (flags.ref) parts.push(`[reference image: ${flags.ref}]`);
  return parts.join(" ");
}

// ═════════════════════════════════════════════════════════════════════
// Generation dispatch
// ═════════════════════════════════════════════════════════════════════

export async function dispatchGeneration(
  api: ApiClient, prompt: string, modelKey: string, flags: GenFlags,
): Promise<ChatGenResponse> {
  return api.postJson<ChatGenResponse>("/agent/chat", {
    query: prompt,
    forced_model_key: modelKey,
    media_mode: true,
    mode: "plan",
    ...(flags.ref ? { ref_image: flags.ref } : {}),
  });
}

// ═════════════════════════════════════════════════════════════════════
// Download engine
// ═════════════════════════════════════════════════════════════════════

const OUTPUT_DIR = "./aether-output";

export function ensureOutputDir(): string {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  return OUTPUT_DIR;
}

async function authHeaders(api: ApiClient): Promise<Record<string, string>> {
  return (api as unknown as {
    authHeaders: () => Promise<Record<string, string>>
  }).authHeaders();
}

function mediaExt(modelKey: string, kind: MediaKind): string {
  if (kind === "video") return ".mp4";
  if (kind === "3d") return ".glb";
  if (modelKey.includes("recraft") || modelKey.includes("vector")) return ".svg";
  return ".png";
}

export async function downloadMediaFile(
  api: ApiClient, url: string, destDir: string,
  modelKey: string, kind: MediaKind, label?: string,
): Promise<string> {
  const headers = await authHeaders(api);
  // Only enforce the credential-safe-transport guard when a bearer token is
  // actually about to be attached — mirrors transport.ts's authHeaders()/
  // vault.ts's _authHeaders() token-conditional pattern. An anonymous session
  // or a non-loopback self-hosted media host has nothing to leak, so it
  // shouldn't hard-fail the download.
  if ("Authorization" in headers && !isCredentialSafeUrl(url)) throw new InsecureTransportError(url);
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`download failed: HTTP ${resp.status}`);
  if (!resp.body) throw new Error("download failed: empty body");

  let filename = label ? label.replace(/[^a-zA-Z0-9._-]/g, "_") : undefined;
  if (!filename) {
    try { filename = basename(new URL(url).pathname); } catch { /* fallback */ }
  }
  if (!filename) filename = `${modelKey.replace("vision_", "")}_${Date.now()}${mediaExt(modelKey, kind)}`;

  const destPath = join(destDir, filename);
  await pipeline(resp.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath));
  return destPath;
}

// ═════════════════════════════════════════════════════════════════════
// Output manager
// ═════════════════════════════════════════════════════════════════════

const OUTPUT_LOG = join(OUTPUT_DIR, ".genlog.json");

function readLog(): OutputEntry[] {
  if (!existsSync(OUTPUT_LOG)) return [];
  try { return JSON.parse(readFileSync(OUTPUT_LOG, "utf-8")); } catch { return []; }
}

function saveLog(entries: OutputEntry[]): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_LOG, JSON.stringify(entries, null, 2));
}

export function recordOutput(result: GenResult): OutputEntry {
  const entries = readLog();
  const stat = statSync(result.filepath);
  const entry: OutputEntry = {
    index: entries.length + 1,
    filename: result.filename, filepath: result.filepath,
    model: result.model, prompt: result.prompt, kind: result.kind,
    url: result.url, timestamp: result.timestamp, size_bytes: stat.size,
  };
  entries.push(entry);
  if (entries.length > 100) entries.splice(0, entries.length - 100);
  saveLog(entries);
  return entry;
}

export function listOutput(limit = 10): OutputEntry[] {
  return readLog().slice(-limit).reverse();
}

export function findOutput(ref: string): OutputEntry | null {
  const entries = readLog();
  const n = parseInt(ref, 10);
  if (!isNaN(n)) return entries.find(e => e.index === n) ?? null;
  return entries.find(e => e.filename === ref || e.filepath === ref) ?? null;
}

export function openOutput(entry: OutputEntry): void {
  const cmd = process.platform === "darwin" ? "open" :
              process.platform === "win32" ? "start" : "xdg-open";
  execSync(`${cmd} "${entry.filepath}"`, { stdio: "ignore" });
}

export function clearOutput(): number {
  const entries = readLog();
  const count = entries.length;
  saveLog([]);
  return count;
}

// ═════════════════════════════════════════════════════════════════════
// Storyboard
// ═════════════════════════════════════════════════════════════════════

export interface StoryboardScene {
  index: number;
  shot_type: string;
  camera_movement: string;
  keyframe_prompt: string;
  animation_prompt: string;
  color_palette: string;
  lighting: string;
  duration_sec: number;
  transition: string;
  notes: string;
  generated_frame_url?: string;
  generated_frame_path?: string;
}

export interface Storyboard {
  id: string; title: string;
  source_type: "prompt" | "script_file";
  source: string; style: string;
  total_scenes: number; scenes: StoryboardScene[];
  created_at: string;
  status: "draft" | "keyframes_generated" | "animated" | "rendered";
}

const STORYBOARD_DIR = join(OUTPUT_DIR, "storyboards");

function sbPath(id: string): string { return join(STORYBOARD_DIR, `${id}.storyboard.json`); }

export function saveStoryboard(sb: Storyboard): void {
  if (!existsSync(STORYBOARD_DIR)) mkdirSync(STORYBOARD_DIR, { recursive: true });
  writeFileSync(sbPath(sb.id), JSON.stringify(sb, null, 2));
}

export function loadStoryboard(id: string): Storyboard | null {
  const p = sbPath(id);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

export function listStoryboards(): { id: string; title: string; scenes: number; status: string; created: string }[] {
  if (!existsSync(STORYBOARD_DIR)) return [];
  return readdirSync(STORYBOARD_DIR)
    .filter(f => f.endsWith(".storyboard.json"))
    .map(f => {
      const sb = loadStoryboard(f.replace(".storyboard.json", ""));
      return sb ? { id: sb.id, title: sb.title, scenes: sb.total_scenes, status: sb.status, created: sb.created_at } : null;
    })
    .filter(Boolean) as { id: string; title: string; scenes: number; status: string; created: string }[];
}

export function parseScenes(raw: string): StoryboardScene[] {
  const scenes: StoryboardScene[] = [];
  const blocks = raw.split(/SCENE \d+/i).filter(b => b.trim());
  let idx = 0;
  for (const block of blocks) {
    idx++;
    const hm = block.match(/^:?\s*(\w+)\s*\|\s*([\w-]+)/);
    const shotType = hm?.[1]?.toUpperCase() ?? "WIDE";
    const camera = hm?.[2]?.toLowerCase() ?? "static";
    const visual = extractField(block, "Visual");
    const motion = extractField(block, "Motion");
    const palette = extractField(block, "Palette") ?? "natural";
    const lighting = extractField(block, "Lighting") ?? "ambient";
    const duration = parseInt(extractField(block, "Duration") ?? "5", 10);
    const transition = extractField(block, "Transition") ?? "cut";
    const notes = extractField(block, "Notes") ?? "";
    if (!visual) continue;
    scenes.push({
      index: idx, shot_type: shotType, camera_movement: camera,
      keyframe_prompt: visual + ` [${palette} palette, ${lighting} lighting]`,
      animation_prompt: motion || `${camera} camera movement`,
      color_palette: palette, lighting,
      duration_sec: Math.min(30, Math.max(3, duration)),
      transition, notes,
    });
  }
  return scenes;
}

function extractField(block: string, field: string): string | undefined {
  const re = new RegExp(`${field}:\\s*(.+?)(?:\\n|$)`, "i");
  return block.match(re)?.[1]?.trim();
}

export interface StoryboardParseResult {
  title: string; style: string;
  scenes: StoryboardScene[];
  raw_llm_output: string;
}

export async function parseStoryboard(
  api: ApiClient, source: string, sourceType: "prompt" | "script_file",
  options?: { scenes?: number; style?: string },
): Promise<StoryboardParseResult> {
  const style = options?.style ?? "cinematic";
  const content = sourceType === "script_file" ? readFileSync(source, "utf-8") : source;
  const resp = await api.postJson<ChatGenResponse>("/agent/chat", {
    query: `STORYBOARD REQUEST:\n\n${content}`,
    forced_model_key: "sonnet", mode: "plan",
  });
  const raw = resp.response || resp.text || "";
  const scenes = parseScenes(raw);
  const title = sourceType === "prompt"
    ? source.slice(0, 60).replace(/\n/g, " ")
    : source.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "untitled";
  return { title, style, scenes, raw_llm_output: raw };
}
