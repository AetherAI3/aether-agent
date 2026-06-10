# Aether Agent — Media Asset Production Commands Implementation Plan

> **For Hermes:** Use aether-agent-cli-commands skill to implement this plan task-by-task.

**Goal:** Turn the aether-agent terminal into a scriptable, producer-grade media IDE with dedicated image/video generation commands, asset editing pipelines, batch generation, and downstream animation from existing artifacts.

**Architecture:** Two top-level CLI commands (`aether image`, `aether video`) + 7 REPL slash commands (`/photogen`, `/videogen`, `/frame`, `/re-frame`, `/sequence`, `/animate`, `/re-cut`) + output management. Reuses GET /models catalog for model discovery. Generation dispatches through existing /agent/chat SSE with `forced_model_key` + `media_mode: true`. Downloads stream to `./aether-output/`.

**Tech Stack:** TypeScript, Node.js, existing ApiClient, theme.js box library, native fetch for streaming downloads

---

## Command Surface

### Top-Level CLI
```
aether image <prompt>                             Quick generate with auto-model + defaults
aether image <prompt> --model nano --4k --count 4  Full control
aether image models                                List image models
aether image interactive                           Step-through guided picker
aether image --resume                              Resume last image context

aether video <prompt>                              Quick video, 5s default
aether video <prompt> --model seedance --1080p --10s --audio
aether video models                                List video models
aether video interactive                           Guided video picker

aether output                                      Show recent 10 generations
aether output open <n>                             Open generation #n in default viewer
aether output clean                                Clear output directory
```

### REPL Slash Commands
```
🖼  Image
  /photogen <prompt> [--model] [--aspect] [--count] [--4k] [--vector]
  /frame <prompt> --aspect <ratio>            Framed static visual for production
  /re-frame <edit prompt>                     Edit last image, keeps canvas state

🎬  Video
  /videogen <prompt> [--model] [--duration] [--1080p] [--audio]
  /sequence <prompt>                          High-fidelity cinematic shot
  /animate <image_url|file.png>               Bring static image to life
  /re-cut <edit prompt>                       Surgical video edit on last generated

📦  Output
  /output                                     Show last 10 generations
  /output open <n>                            Open generation
  /output clean                               Clear output directory
```

### Smart Model Shortcuts
```
nano      → vision_nano_pro       seedance  → vision_seedance
recraft   → vision_recraft        veo       → vision_veo31
edit      → vision_gpt_image2     kling     → vision_kling
                                  hvideo    → vision_hunyuan_video
                                  3d        → vision_hunyuan3d
```

### Auto-Model Routing (when --model is omitted)
- "vector" "logo" "brand" "icon" "svg" in prompt → recraft
- "edit" "fix" "change" "inpaint" "modify" → edit
- "cinematic" "movie" "dramatic" "film" → seedance
- "talking" "dialogue" "narration" "voice" → veo  
- "draft" "quick" "test" "budget" → kling
- Otherwise → nano (image) / seedance (video)

### Aspect Ratios
```
16_9 → 16:9 (landscape, default)
9_16 → 9:16 (portrait/stories)
1_1  → 1:1 (square/social)
3_4  → 3:4 (portrait)
4_3  → 4:3 (classic)
```

---

## Files to Touch

| Layer | File | Change |
|-------|------|--------|
| Core | `src/core/vision.ts` | NEW — types, model shortcuts, auto-router, download helpers, output manager |
| Commands | `src/commands/media.ts` | NEW — cmdImage, cmdVideo dispatch + handlers |
| Commands | `src/commands/output.ts` | NEW — cmdOutput dispatch + handlers |
| Main | `src/main.ts` | Import + cases for image/video/output + help text |
| Slash | `src/commands/slash.ts` | 7 new cases + Vision section in help |

---

## Phase 1: Core Module — Vision Engine

### Task 1: Create src/core/vision.ts

**File (new):** `src/core/vision.ts`

Full engine: types, model registry, shortcuts, auto-router, downloader, output manager, aspect ratio mapping, quality flags.

```typescript
// src/core/vision.ts — media asset production engine
//
// Pure logic: model shortcuts, auto-routing, download helpers, output manager.
// No terminal I/O. Every function wraps a single concept.

import { ApiClient, MODELS_PATH } from "./transport.js";
import type { CatalogItem, CatalogResponse } from "../types.js";
import { createWriteStream, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
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
  value: string;       // "16_9"
  display: string;     // "16:9"
  w: number; h: number;
}

export interface GenFlags {
  model?: string;          // shortcut or full id
  aspect?: string;         // "16_9" | "9_16" | "1_1" | "3_4" | "4_3"
  count?: number;           // batch variants (1-10)
  fourK?: boolean;          // 4K resolution
  vector?: boolean;         // SVG output (recraft only)
  duration?: number;        // video seconds (1-30)
  hd1080?: boolean;         // 1080p (vs 720p default)
  audio?: boolean;          // native audio (veo/hunyuan)
  saveToVault?: boolean;    // upload to vault after generation
  ref?: string;             // reference image URL or vault path
  open?: boolean;           // open after generation
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
}

export const ASPECT_RATIOS: Record<string, AspectRatio> = {
  "16_9": { value: "16_9", display: "16:9", w: 16, h: 9 },
  "9_16": { value: "9_16", display: "9:16", w: 9, h: 16 },
  "1_1":  { value: "1_1",  display: "1:1", w: 1, h: 1 },
  "3_4":  { value: "3_4",  display: "3:4", w: 3, h: 4 },
  "4_3":  { value: "4_3",  display: "4:3", w: 4, h: 3 },
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
  ...IMAGE_SHORTCUTS,
  ...VIDEO_SHORTCUTS,
  ...MEDIA_3D_SHORTCUTS,
};

/** Resolve a user-supplied model arg (shortcut or full id) to canonical key. */
export function resolveModelKey(arg: string): string {
  return ALL_SHORTCUTS[arg.toLowerCase()] ?? arg;
}

/** Infer MediaKind from model id. */
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
  return filtered
    .map(m => ({
      id: m.id,
      label: m.label,
      kind: mediaKind(m.id),
      provider: m.provider,
      tier_min: m.tier_min,
      available: m.available,
      enabled: m.enabled,
      monthly_uvt_cap: m.monthly_uvt_cap,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
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
  // image
  if (/vector|logo|brand|icon|svg|design.system/.test(p)) return "recraft";
  if (/edit|fix|change|inpaint|modify|touch.up|retouch/.test(p)) return "edit";
  return "nano";
}

// ═════════════════════════════════════════════════════════════════════
// Prompt builder — inject aspect ratio, resolution, quality flags
// ═════════════════════════════════════════════════════════════════════

export function buildMediaPrompt(prompt: string, flags: GenFlags, kind: MediaKind): string {
  const parts: string[] = [prompt];
  if (flags.aspect && ASPECT_RATIOS[flags.aspect]) {
    parts.push(`[aspect ratio: ${ASPECT_RATIOS[flags.aspect].display}]`);
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
// Generation dispatch — sends to /agent/chat with media_mode flag
// ═════════════════════════════════════════════════════════════════════

export interface ChatGenResponse {
  response?: string;
  text?: string;
  media_url?: string;
  filename?: string;
}

export async function dispatchGeneration(
  api: ApiClient,
  prompt: string,
  modelKey: string,
  flags: GenFlags,
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
  api: ApiClient,
  url: string,
  destDir: string,
  modelKey: string,
  kind: MediaKind,
  label?: string,
): Promise<string> {
  const headers = await authHeaders(api);
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`download failed: HTTP ${resp.status}`);
  if (!resp.body) throw new Error("download failed: empty body");

  let filename = label ? label.replace(/[^a-zA-Z0-9._-]/g, "_") : null;
  if (!filename) {
    try { filename = basename(new URL(url).pathname); } catch { /* use generated name */ }
  }
  if (!filename) filename = `${modelKey.replace("vision_", "")}_${Date.now()}${mediaExt(modelKey, kind)}`;

  const destPath = join(destDir, filename);
  await pipeline(resp.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath));
  return destPath;
}

// ═════════════════════════════════════════════════════════════════════
// Output manager — track generations, list, open
// ═════════════════════════════════════════════════════════════════════

const OUTPUT_LOG = join(OUTPUT_DIR, ".genlog.json");

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

function readLog(): OutputEntry[] {
  if (!existsSync(OUTPUT_LOG)) return [];
  try { return JSON.parse(require("node:fs").readFileSync(OUTPUT_LOG, "utf-8")); } catch { return []; }
}

function saveLog(entries: OutputEntry[]): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  require("node:fs").writeFileSync(OUTPUT_LOG, JSON.stringify(entries, null, 2));
}

export function recordOutput(result: GenResult): OutputEntry {
  const entries = readLog();
  const stat = statSync(result.filepath);
  const entry: OutputEntry = {
    index: entries.length + 1,
    filename: result.filename,
    filepath: result.filepath,
    model: result.model,
    prompt: result.prompt,
    kind: result.kind,
    url: result.url,
    timestamp: result.timestamp,
    size_bytes: stat.size,
  };
  entries.push(entry);
  if (entries.length > 100) entries.splice(0, entries.length - 100);
  saveLog(entries);
  return entry;
}

export function listOutput(limit = 10): OutputEntry[] {
  const entries = readLog();
  return entries.slice(-limit).reverse();
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
```

**Verify:** `npx tsc --noEmit src/core/vision.ts`

---

## Phase 2: CLI Commands

### Task 2: Create src/commands/media.ts — aether image + aether video

**File (new):** `src/commands/media.ts`

```typescript
// `aether image <prompt> [--model] [--aspect] [--count] [--4k] [--vector] [--interactive]`
// `aether video <prompt> [--model] [--duration] [--1080p] [--audio] [--batch] [--interactive]`
//
// Full control over image/video generation from the terminal.

import type { AppContext } from "../core/context.js";
import type { CatalogResponse } from "../types.js";
import { MODELS_PATH } from "../core/transport.js";
import {
  filterMediaModels, resolveModelKey, autoRouteModel, mediaKind,
  buildMediaPrompt, dispatchGeneration, downloadMediaFile,
  ensureOutputDir, recordOutput, listOutput, findOutput, openOutput, clearOutput,
  IMAGE_SHORTCUTS, VIDEO_SHORTCUTS, ASPECT_RATIOS,
  type MediaKind, type MediaModel, type GenFlags, type GenResult,
} from "../core/vision.js";
import { theme } from "../ui/theme.js";

// ═════════════════════════════════════════════════════════════════════
// Shared dispatch
// ═════════════════════════════════════════════════════════════════════

export async function cmdImage(ctx: AppContext, argv: string[]): Promise<number> {
  return mediaDispatch(ctx, argv, "image");
}

export async function cmdVideo(ctx: AppContext, argv: string[]): Promise<number> {
  return mediaDispatch(ctx, argv, "video");
}

async function mediaDispatch(ctx: AppContext, argv: string[], kind: MediaKind): Promise<number> {
  const sub = (argv[0] ?? "").toLowerCase();
  
  if (sub === "models" || sub === "list") {
    return mediaModelsList(ctx, kind);
  }
  if (sub === "interactive" || sub === "i") {
    return mediaInteractive(ctx, kind);
  }
  if (sub === "help" || sub === "") {
    printMediaHelp(kind);
    return 0;
  }

  // Parse flags from combined arg string
  const flags = parseFlags(argv.join(" "));
  const prompt = extractPrompt(argv);
  
  if (!prompt) {
    process.stderr.write(`usage: aether ${kind} "<prompt>" [flags]\n`);
    printMediaHelp(kind);
    return 2;
  }

  return mediaGenerate(ctx, prompt, kind, flags);
}

// ═════════════════════════════════════════════════════════════════════
// Flag parser — extracts --flags from combined string
// ═════════════════════════════════════════════════════════════════════

function parseFlags(raw: string): GenFlags {
  const flags: GenFlags = {};
  const parts = raw.split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--model" && parts[i + 1]) { flags.model = parts[++i]; }
    else if (p === "--aspect") { flags.aspect = parts[++i]; }
    else if (p === "--count") { flags.count = parseInt(parts[++i], 10) || 1; }
    else if (p === "--4k") { flags.fourK = true; }
    else if (p === "--vector") { flags.vector = true; }
    else if (p === "--duration" || p === "--10s") { flags.duration = parseInt(parts[++i], 10) || 10; }
    else if (p === "--1080p") { flags.hd1080 = true; }
    else if (p === "--audio") { flags.audio = true; }
    else if (p === "--save-to-vault") { flags.saveToVault = true; }
    else if (p === "--ref" && parts[i + 1]) { flags.ref = parts[++i]; }
    else if (p === "--open") { flags.open = true; }
  }
  return flags;
}

function extractPrompt(argv: string[]): string {
  // Everything before the first --flag is the prompt
  const parts: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--")) break;
    parts.push(a);
  }
  return parts.join(" ");
}

// ═════════════════════════════════════════════════════════════════════
// Model listing
// ═════════════════════════════════════════════════════════════════════

async function mediaModelsList(ctx: AppContext, kind: MediaKind): Promise<number> {
  try {
    const cat = await ctx.api.getJson<CatalogResponse>(MODELS_PATH);
    const models = filterMediaModels(cat.models, kind);
    if (ctx.flags.json) {
      process.stdout.write(JSON.stringify(models, null, 2) + "\n");
      return 0;
    }
    const icon = kind === "video" ? "🎬" : "🖼";
    process.stdout.write(`\n${icon}  ${kind.toUpperCase()} MODELS\n\n`);
    for (const m of models) {
      const mark = m.id === ctx.cfg.defaultModel ? theme.iceBlue("*") : " ";
      const lock = m.available ? " " : "🔒";
      const cap = m.monthly_uvt_cap != null ? `  cap ${m.monthly_uvt_cap.toLocaleString()}` : "";
      const provider = m.provider ? theme.dim(` (${m.provider})`) : "";
      const shortcuts = Object.entries(kind === "image" ? IMAGE_SHORTCUTS : VIDEO_SHORTCUTS)
        .filter(([, v]) => v === m.id)
        .map(([k]) => k)
        .join(", ");
      const alias = shortcuts ? theme.dim(` [${shortcuts}]`) : "";
      process.stdout.write(`${mark} ${lock} ${m.id}  ${m.label}${provider}${alias}${cap}\n`);
    }
    process.stdout.write("\n");
    return 0;
  } catch (err) { return fail(err); }
}

// ═════════════════════════════════════════════════════════════════════
// Interactive guided mode
// ═════════════════════════════════════════════════════════════════════

async function mediaInteractive(ctx: AppContext, kind: MediaKind): Promise<number> {
  const icon = kind === "video" ? "🎬" : "🖼";
  process.stdout.write(theme.iceBlue(`\n${icon}  Aether ${kind === "video" ? "Video" : "Image"} Generation\n\n`));
  
  // List models
  const cat = await ctx.api.getJson<CatalogResponse>(MODELS_PATH);
  const models = filterMediaModels(cat.models, kind).filter(m => m.available);
  
  process.stdout.write("Available models:\n\n");
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const shortcut = Object.entries(kind === "image" ? IMAGE_SHORTCUTS : VIDEO_SHORTCUTS)
      .find(([, v]) => v === m.id)?.[0];
    process.stdout.write(`  ${i + 1}. ${m.label}${shortcut ? theme.dim(` (${shortcut})`) : ""}\n`);
  }
  process.stdout.write("\n");

  // Model pick
  process.stdout.write(theme.dim("Select model [1-" + models.length + "] or type shortcut: "));
  const modelInput = await readLine();
  const modelKey = resolveModelShortcut(modelInput, models, kind);
  if (!modelKey) {
    process.stdout.write(theme.dim("  (defaulting to auto)\n"));
  }
  process.stdout.write(`  → model: ${modelKey ? resolveModelKey(modelKey) : "auto"}\n\n`);

  // Prompt
  process.stdout.write(theme.dim("Prompt: "));
  const prompt = await readLine();
  if (!prompt) {
    process.stderr.write("no prompt entered\n");
    return 1;
  }

  // Resolution
  const resOptions = kind === "video" 
    ? ["720p (default)", "1080p", "4K"] 
    : ["standard", "4K"];
  process.stdout.write(theme.dim(`Resolution [${resOptions.join(" / ")}]: `));
  const res = (await readLine()).toLowerCase();

  // Count
  process.stdout.write(theme.dim("Count [1-10]: "));
  const cnt = parseInt(await readLine(), 10) || 1;

  process.stdout.write("\n");

  const flags: GenFlags = {
    model: modelKey,
    count: Math.min(10, Math.max(1, cnt)),
    fourK: res.includes("4k"),
    hd1080: res.includes("1080"),
    audio: kind === "video" && (await confirm("Native audio? [y/N]: ")),
  };

  return mediaGenerate(ctx, prompt, kind, flags);
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const { createInterface } = require("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.once("line", (line: string) => {
      rl.close();
      resolve(line.trim());
    });
  });
}

function confirm(q: string): Promise<boolean> {
  return readLine().then(a => /^y(es)?$/i.test(a));
}

function resolveModelShortcut(input: string, models: MediaModel[], kind: MediaKind): string | undefined {
  const n = parseInt(input, 10);
  if (!isNaN(n) && n >= 1 && n <= models.length) return models[n - 1].id;
  const resolved = resolveModelKey(input);
  if (models.some(m => m.id === resolved)) return resolved;
  return undefined;
}

// ═════════════════════════════════════════════════════════════════════
// Generation + batch download
// ═════════════════════════════════════════════════════════════════════

async function mediaGenerate(
  ctx: AppContext, prompt: string, kind: MediaKind, flags: GenFlags,
): Promise<number> {
  const modelKey = flags.model ? resolveModelKey(flags.model) : autoRouteModel(prompt, kind);
  const fullPrompt = buildMediaPrompt(prompt, flags, kind);
  const count = Math.min(10, Math.max(1, flags.count ?? 1));
  const outdir = ensureOutputDir();

  process.stdout.write(theme.dim(
    `generating ${count} ${kind}(s) with ${modelKey}: "${prompt}"\n\n`
  ));

  for (let i = 0; i < count; i++) {
    try {
      const variantPrompt = count > 1
        ? `${fullPrompt} [variant ${i + 1} of ${count}]`
        : fullPrompt;
      
      const resp = await dispatchGeneration(ctx.api, variantPrompt, modelKey, flags);
      const text = resp.response || resp.text || "";
      
      if (resp.media_url) {
        process.stdout.write(theme.dim(`[${i + 1}/${count}] downloading ${resp.media_url.slice(0, 60)}...\n`));
        const filepath = await downloadMediaFile(
          ctx.api, resp.media_url, outdir, modelKey, kind, resp.filename
        );
        const result: GenResult = {
          model: modelKey, prompt: variantPrompt, kind,
          filepath, filename: basename(filepath),
          url: resp.media_url, timestamp: new Date().toISOString(), flags,
        };
        const entry = recordOutput(result);
        process.stdout.write(
          `${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n` +
          `        ${theme.dim(`url: ${resp.media_url}`)}\n\n`
        );
        if (flags.open) openOutput(entry);
      } else {
        process.stdout.write(theme.dim(`  [${i + 1}/${count}] no media URL in response\n`));
        process.stdout.write(theme.dim(`  response: ${text.slice(0, 200)}\n`));
      }
    } catch (err) {
      process.stdout.write(`✗ [${i + 1}/${count}] ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  process.stdout.write(theme.dim(`\noutput: ${outdir}/\nview: aether output\n\n`));
  return 0;
}

// ═════════════════════════════════════════════════════════════════════
// Help + errors
// ═════════════════════════════════════════════════════════════════════

function printMediaHelp(kind: MediaKind): void {
  const v = kind === "video";
  process.stdout.write([
    v
      ? "aether video \"<prompt>\"              Quick generate with auto-model + defaults"
      : "aether image \"<prompt>\"              Quick generate with auto-model + defaults",
    v
      ? "aether video \"<prompt>\" --model seedance --1080p --10s --audio"
      : "aether image \"<prompt>\" --model nano --4k --count 4",
    "aether " + kind + " models                List " + kind + " models",
    "aether " + kind + " interactive            Step-through guided picker",
    "",
  ].join("\n"));
}

function fail(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`✗ ${msg}\n  (are you logged in? run: aether auth login)\n`);
  return 1;
}
```

**Verify:** `npx tsc --noEmit src/commands/media.ts`

### Task 3: Create src/commands/output.ts

**File (new):** `src/commands/output.ts`

```typescript
// `aether output`              — show recent 10 generations
// `aether output open <n>`     — open generation #n
// `aether output clean`         — clear output directory + log

import type { AppContext } from "../core/context.js";
import { listOutput, findOutput, openOutput, clearOutput, type OutputEntry } from "../core/vision.js";
import { theme } from "../ui/theme.js";

export async function cmdOutput(ctx: AppContext, argv: string[]): Promise<number> {
  const sub = (argv[0] ?? "list").toLowerCase();
  switch (sub) {
    case "list":
    case "ls":
    case "":
      return outputList();
    case "open":
      return outputOpen(argv[1]);
    case "clean":
    case "clear":
      return outputClean();
    default:
      return outputList();
  }
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
    const size = (e.size_bytes / 1024 / 1024).toFixed(1) + "MB";
    const shortPrompt = e.prompt.length > 50 ? e.prompt.slice(0, 47) + "..." : e.prompt;
    process.stdout.write(
      `  ${theme.iceBlue("#" + e.index)} ${icon}  ${e.filename}\n` +
      `     ${theme.dim(e.model)}  ${size}  ${shortPrompt}\n`
    );
  }
  process.stdout.write(theme.dim("\n  aether output open <n>  — open in default viewer\n\n"));
  return 0;
}

async function outputOpen(ref?: string): Promise<number> {
  if (!ref) {
    process.stderr.write("usage: aether output open <index|filename>\n");
    return 2;
  }
  const entry = findOutput(ref);
  if (!entry) {
    process.stderr.write(`no output matching "${ref}"\n`);
    return 1;
  }
  try {
    openOutput(entry);
    process.stdout.write(theme.iceBlue("→") + ` opened ${entry.filename}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function outputClean(): Promise<number> {
  const count = clearOutput();
  process.stdout.write(theme.dim(`  cleared ${count} generation log entries\n  (files preserved in ./aether-output/)\n\n`));
  return 0;
}
```

---

## Phase 3: main.ts Wiring

### Task 4: Wire image/video/output into main.ts

**File:** `src/main.ts`

**Add imports** (after workflow import):
```typescript
import { cmdImage, cmdVideo } from "./commands/media.js";
import { cmdOutput } from "./commands/output.js";
```

**Add switch cases** (after workflow case):
```typescript
    case "image":
    case "img":
      return cmdImage(ctx, rest);
    case "video":
    case "vid":
      return cmdVideo(ctx, rest);
    case "output":
    case "out":
      return cmdOutput(ctx, rest);
```

**Add help text** (after vault lines):
```
  aether image "<prompt>" [--model] [--aspect] [--count] [--4k] [--vector] [--interactive]
  aether video "<prompt>" [--model] [--duration] [--1080p] [--audio] [--interactive]
  aether image models                aether video models
  aether output                      Show recent 10 generations
  aether output open <n>             Open generation in viewer
```

---

## Phase 4: Slash Commands

### Task 5: Add /photogen, /videogen, /frame, /re-frame, /sequence, /animate, /re-cut, /output to slash.ts

**File:** `src/commands/slash.ts`

Add imports at top:
```typescript
import {
  filterMediaModels, resolveModelKey, autoRouteModel, mediaKind,
  buildMediaPrompt, dispatchGeneration, downloadMediaFile,
  ensureOutputDir, recordOutput, listOutput, findOutput, openOutput, clearOutput,
  ASPECT_RATIOS, IMAGE_SHORTCUTS, VIDEO_SHORTCUTS,
  type MediaKind, type GenFlags, type GenResult,
} from "../core/vision.js";
import { basename } from "node:path";
```

Add state for re-frame/re-cut (session-scoped, cleared on restart):
```typescript
// Media pipeline state — persists across turns in the same REPL session.
// Cleared on REPL restart.
let _lastMediaUrl: string | null = null;
let _lastMediaModel: string | null = null;
let _lastMediaPrompt: string | null = null;
let _lastMediaKind: MediaKind | null = null;
```

Add cases to handleSlash switch (after /gather, before default):
```typescript
    // ── Vision: Image ────────────────────────────
    case "photogen":
    case "frame": {
      await photogenSlash(ctx, out, arg, cmd === "frame");
      break;
    }
    case "re-frame": {
      await reframeSlash(ctx, out, arg);
      break;
    }
    // ── Vision: Video ────────────────────────────
    case "videogen":
    case "sequence": {
      await videogenSlash(ctx, out, arg, cmd === "sequence");
      break;
    }
    case "animate": {
      await animateSlash(ctx, out, arg);
      break;
    }
    case "re-cut": {
      await recutSlash(ctx, out, arg);
      break;
    }
    // ── Output ───────────────────────────────────
    case "output": {
      await outputSlash(ctx, out, arg);
      break;
    }
```

Add handler functions (detailed implementations):
```typescript
// ═════════════════════════════════════════════════════════════════════
// /photogen + /frame — image generation
// ═════════════════════════════════════════════════════════════════════

async function photogenSlash(ctx: AppContext, out: Writable, arg: string, framed: boolean): Promise<void> {
  const { prompt, flags } = parseSlashFlags(arg, "image");
  if (!prompt) {
    out.write("usage: /photogen <prompt> [--model nano] [--aspect 16_9] [--count 4] [--4k] [--vector]\n");
    out.write("usage: /frame <prompt> --aspect <ratio>\n");
    return;
  }
  const kind: MediaKind = "image";
  const modelKey = flags.model ? resolveModelKey(flags.model) : autoRouteModel(prompt, kind);
  const fullPrompt = buildMediaPrompt(prompt, flags, kind);
  const count = Math.min(10, Math.max(1, flags.count ?? 1));
  const outdir = ensureOutputDir();

  out.write(theme.dim(`generating ${count} image(s) with ${modelKey}: "${prompt}"\n\n`));

  for (let i = 0; i < count; i++) {
    try {
      const vp = count > 1 ? `${fullPrompt} [variant ${i + 1} of ${count}]` : fullPrompt;
      const resp = await dispatchGeneration(ctx.api, vp, modelKey, flags);
      if (resp.media_url) {
        out.write(theme.dim(`[${i + 1}/${count}] downloading...\n`));
        const filepath = await downloadMediaFile(ctx.api, resp.media_url, outdir, modelKey, kind, resp.filename);
        const result: GenResult = {
          model: modelKey, prompt: vp, kind, filepath, filename: basename(filepath),
          url: resp.media_url, timestamp: new Date().toISOString(), flags,
        };
        const entry = recordOutput(result);
        out.write(
          `${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n` +
          `  ${theme.dim(resp.media_url)}\n\n`
        );
        // Store for /re-frame
        _lastMediaUrl = resp.media_url;
        _lastMediaModel = modelKey;
        _lastMediaPrompt = vp;
        _lastMediaKind = kind;
      } else {
        out.write(theme.dim(`  no media URL returned\n`));
      }
    } catch (err) {
      out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════
// /re-frame — edit last generated image
// ═════════════════════════════════════════════════════════════════════

async function reframeSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!_lastMediaUrl || _lastMediaKind !== "image") {
    out.write(theme.dim("  no previous image to edit — generate one with /photogen first\n"));
    return;
  }
  if (!arg) {
    out.write("usage: /re-frame <edit description>\n");
    return;
  }
  const editPrompt = `Edit the previously generated image: ${arg}`;
  const flags: GenFlags = { model: "edit", ref: _lastMediaUrl };
  out.write(theme.dim(`editing with gpt-image-2: "${arg}"\n\n`));
  try {
    const resp = await dispatchGeneration(ctx.api, editPrompt, "vision_gpt_image2", flags);
    if (resp.media_url) {
      const outdir = ensureOutputDir();
      const filepath = await downloadMediaFile(ctx.api, resp.media_url, outdir, "vision_gpt_image2", "image", resp.filename);
      const result: GenResult = {
        model: "vision_gpt_image2", prompt: editPrompt, kind: "image",
        filepath, filename: basename(filepath), url: resp.media_url,
        timestamp: new Date().toISOString(), flags,
      };
      const entry = recordOutput(result);
      out.write(`${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n`);
      _lastMediaUrl = resp.media_url;
      _lastMediaModel = "vision_gpt_image2";
      _lastMediaPrompt = editPrompt;
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ═════════════════════════════════════════════════════════════════════
// /videogen + /sequence — video generation
// ═════════════════════════════════════════════════════════════════════

async function videogenSlash(ctx: AppContext, out: Writable, arg: string, cinematic: boolean): Promise<void> {
  const { prompt, flags } = parseSlashFlags(arg, "video");
  if (!prompt) {
    out.write("usage: /videogen <prompt> [--model seedance] [--duration 10] [--1080p] [--audio]\n");
    out.write("usage: /sequence <prompt>\n");
    return;
  }
  const kind: MediaKind = "video";
  const modelKey = flags.model ? resolveModelKey(flags.model)
    : cinematic ? "seedance" : autoRouteModel(prompt, kind);
  if (!flags.duration) flags.duration = 5;
  const fullPrompt = buildMediaPrompt(prompt, flags, kind);
  const outdir = ensureOutputDir();

  out.write(theme.dim(`generating video with ${modelKey}: "${prompt}"\n\n`));
  try {
    const resp = await dispatchGeneration(ctx.api, fullPrompt, modelKey, flags);
    if (resp.media_url) {
      out.write(theme.dim("downloading video...\n"));
      const filepath = await downloadMediaFile(ctx.api, resp.media_url, outdir, modelKey, kind, resp.filename);
      const result: GenResult = {
        model: modelKey, prompt: fullPrompt, kind, filepath, filename: basename(filepath),
        url: resp.media_url, timestamp: new Date().toISOString(), flags,
      };
      const entry = recordOutput(result);
      out.write(`${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n`);
      out.write(`  ${theme.dim(resp.media_url)}\n\n`);
      _lastMediaUrl = resp.media_url;
      _lastMediaModel = modelKey;
      _lastMediaPrompt = fullPrompt;
      _lastMediaKind = kind;
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ═════════════════════════════════════════════════════════════════════
// /animate — bring static image to life
// ═════════════════════════════════════════════════════════════════════

async function animateSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const args = arg.trim().split(/\s+/);
  const ref = args[0];
  const extraPrompt = args.slice(1).join(" ");
  if (!ref) {
    out.write("usage: /animate <image_url|file.png> [motion description]\n");
    out.write("       /animate #3                     — use output #3 as reference\n");
    out.write("       /animate http://.../image.png   — URL reference\n");
    return;
  }
  
  let refUrl = ref;
  // Check if ref is an output index
  if (/^#?\d+$/.test(ref)) {
    const entry = findOutput(ref.replace("#", ""));
    if (entry) refUrl = entry.url;
    else { out.write(theme.dim(`  no output matching "${ref}"\n`)); return; }
  }

  const kind: MediaKind = "video";
  const prompt = `Animate this image into a fluid video sequence${extraPrompt ? ": " + extraPrompt : ""}`;
  const flags: GenFlags = { model: "seedance", ref: refUrl, duration: 5 };
  
  out.write(theme.dim(`animating from ${refUrl.slice(0, 50)}...\n\n`));
  try {
    const resp = await dispatchGeneration(ctx.api, prompt, "vision_seedance", flags);
    if (resp.media_url) {
      const outdir = ensureOutputDir();
      const filepath = await downloadMediaFile(ctx.api, resp.media_url, outdir, "vision_seedance", kind, resp.filename);
      const result: GenResult = {
        model: "vision_seedance", prompt, kind, filepath, filename: basename(filepath),
        url: resp.media_url, timestamp: new Date().toISOString(), flags,
      };
      const entry = recordOutput(result);
      out.write(`${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n`);
      _lastMediaUrl = resp.media_url;
      _lastMediaModel = "vision_seedance";
      _lastMediaPrompt = prompt;
      _lastMediaKind = kind;
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ═════════════════════════════════════════════════════════════════════
// /re-cut — surgical video edit on last generated
// ═════════════════════════════════════════════════════════════════════

async function recutSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!_lastMediaUrl || _lastMediaKind !== "video") {
    out.write(theme.dim("  no previous video to edit — generate one with /videogen first\n"));
    return;
  }
  if (!arg) {
    out.write("usage: /re-cut <edit description>\n");
    out.write("  e.g. /re-cut slow down the camera pan and add dramatic zoom\n");
    return;
  }
  const editPrompt = `Edit the previously generated video: ${arg}`;
  const flags: GenFlags = { model: _lastMediaModel || "seedance", ref: _lastMediaUrl };
  const kind: MediaKind = "video";
  out.write(theme.dim(`editing video: "${arg}"\n\n`));
  try {
    const resp = await dispatchGeneration(ctx.api, editPrompt, _lastMediaModel || "vision_seedance", flags);
    if (resp.media_url) {
      const outdir = ensureOutputDir();
      const filepath = await downloadMediaFile(ctx.api, resp.media_url, outdir, _lastMediaModel || "vision_seedance", kind, resp.filename);
      const result: GenResult = {
        model: _lastMediaModel || "vision_seedance", prompt: editPrompt, kind,
        filepath, filename: basename(filepath), url: resp.media_url,
        timestamp: new Date().toISOString(), flags,
      };
      const entry = recordOutput(result);
      out.write(`${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n`);
      _lastMediaUrl = resp.media_url;
      _lastMediaPrompt = editPrompt;
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ═════════════════════════════════════════════════════════════════════
// /output — generation viewer
// ═════════════════════════════════════════════════════════════════════

async function outputSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const ref = parts.slice(1).join(" ");

  if (sub === "open" || sub === "o") {
    if (!ref) { out.write("usage: /output open <n|filename>\n"); return; }
    const entry = findOutput(ref);
    if (!entry) { out.write(theme.dim(`  no output matching "${ref}"\n`)); return; }
    try {
      openOutput(entry);
      out.write(theme.iceBlue("→") + ` opened ${entry.filename}\n`);
    } catch (err) {
      out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    }
    return;
  }

  if (sub === "clean" || sub === "clear") {
    const count = clearOutput();
    out.write(theme.dim(`  cleared ${count} generation log entries\n`));
    return;
  }

  const entries = listOutput(10);
  if (entries.length === 0) {
    out.write(theme.dim("  (no generations yet — use /photogen or /videogen)\n"));
    return;
  }
  out.write(`${theme.iceBlue("📦")}  RECENT GENERATIONS\n\n`);
  for (const e of entries) {
    const icon = e.kind === "video" ? "🎬" : e.kind === "3d" ? "🧊" : "🖼";
    const size = (e.size_bytes / 1024 / 1024).toFixed(1) + "MB";
    const shortPrompt = e.prompt.length > 50 ? e.prompt.slice(0, 47) + "..." : e.prompt;
    out.write(
      `  ${theme.iceBlue("#" + e.index)} ${icon}  ${e.filename}\n` +
      `     ${theme.dim(e.model)}  ${size}  ${shortPrompt}\n`
    );
  }
  out.write(theme.dim("\n  /output open <n>  — open in default viewer\n\n"));
}

// ═════════════════════════════════════════════════════════════════════
// Flag parser for slash commands
// ═════════════════════════════════════════════════════════════════════

function parseSlashFlags(raw: string, kind: MediaKind): { prompt: string; flags: GenFlags } {
  const flags: GenFlags = {};
  const parts = raw.split(/\s+/);
  const promptParts: string[] = [];
  let inPrompt = true;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (inPrompt && p.startsWith("--")) {
      inPrompt = false;
    }
    if (inPrompt) {
      promptParts.push(p);
    } else {
      if (p === "--model") { flags.model = parts[++i]; }
      else if (p === "--aspect") { flags.aspect = parts[++i]; }
      else if (p === "--count") { flags.count = parseInt(parts[++i], 10) || 1; }
      else if (p === "--4k") { flags.fourK = true; }
      else if (p === "--vector") { flags.vector = true; }
      else if (p === "--duration" || p === "--10s") { flags.duration = parseInt(parts[++i], 10) || 10; }
      else if (p === "--1080p") { flags.hd1080 = true; }
      else if (p === "--audio") { flags.audio = true; }
      else if (p === "--save-to-vault") { flags.saveToVault = true; }
      else if (p === "--ref") { flags.ref = parts[++i]; }
      else if (p === "--open") { flags.open = true; }
    }
  }

  return { prompt: promptParts.join(" "), flags };
}
```

**Update printHelp** — Replace the placeholder Vision section with:
```typescript
    [
      "",
      theme.iceBlue("🖼") + "  " + theme.bold("Vision — Image Generation"),
      "",
      theme.dim("/photogen") + " <prompt> [--model] [--aspect] [--count] [--4k] [--vector]",
      theme.dim("/frame") + " <prompt> --aspect <ratio>    framed static asset for production",
      theme.dim("/re-frame") + " <edit>                   edit last generated image",
      "",
    ],
    [
      "",
      theme.iceBlue("🎬") + "  " + theme.bold("Vision — Video Generation"),
      "",
      theme.dim("/videogen") + " <prompt> [--model] [--duration] [--1080p] [--audio]",
      theme.dim("/sequence") + " <prompt>                  cinematic tracking shot",
      theme.dim("/animate") + " <url|file|#n>              bring static image to life",
      theme.dim("/re-cut") + " <edit>                     surgical video edit on last generated",
      "",
    ],
    [
      "",
      theme.iceBlue("📦") + "  " + theme.bold("Vision — Output"),
      "",
      theme.dim("/output") + "                     show last 10 generations",
      theme.dim("/output") + " open <n>             open in default viewer",
      "",
    ],
```

---

## Phase 5: Build + Verify

### Task 6: Full build + syntax check

```bash
cd /root/aether-agent
npx tsc --noEmit src/core/vision.ts
npx tsc --noEmit src/commands/media.ts
npx tsc --noEmit src/commands/output.ts
npx tsc --noEmit src/main.ts
npx tsc --noEmit src/commands/slash.ts
npx tsc -p tsconfig.json

# Verify help renders
node dist/src/main.js image help
node dist/src/main.js video help
node dist/src/main.js help | grep -A3 image
node dist/src/main.js output
```

---

## Summary

### Full Command Surface

```
TERMINAL (CLI):
  aether image "<prompt>" [--model] [--aspect] [--count] [--4k] [--vector] [--i]
  aether image models
  aether video "<prompt>" [--model] [--duration] [--1080p] [--audio] [--i]
  aether video models
  aether output                    Show recent 10 generations
  aether output open <n>           Open in viewer
  aether output clean

REPL (INTERACTIVE):
  /photogen <prompt> [flags]       Generate images (batch, aspect, resolution)
  /frame <prompt> --aspect <r>     Framed production asset
  /re-frame <edit>                 Edit last image inline
  /videogen <prompt> [flags]       Generate video (model, duration, audio)
  /sequence <prompt>               Cinematic B-roll shot
  /animate <url|#n> [motion]       Bring image to life
  /re-cut <edit>                   Surgical video edit
  /output                          View recent gens
  /output open <n>                 Open in viewer
```

### REPL Pipeline Flow
```
/photogen "hero shot" → #1 saved
/re-frame "make it warmer, add fog" → #2 saved (uses #1 context)
/animate #1 "slow dramatic zoom" → #3 saved (video from still)
/re-cut "faster camera movement" → #4 saved (edit #3)

/storyboard "lone astronaut discovers alien artifact on Mars"
  → parses into 4 scenes automatically
  → Scene 1: WIDE - astronaut approaching artifact (dusty, cold palette)
  → Scene 2: MED - artifact activates, holographic glow (blue shift)
  → Scene 3: CLOSE - astronaut face, realization (warm contrast)
  → Scene 4: OVERHEAD - star map expanding (pull-out, grand reveal)

/storyboard ./scripts/launch-trailer.md --scenes 8
  → reads markdown script file, splits into 8 storyboard scenes

/storyboard --preview            inspect scenes without generating
/storyboard --generate            generate all keyframes (/photogen per scene)
/storyboard --animate             animate keyframes into sequence (/animate each)
/storyboard --render              full pipeline: parse → keyframes → animate → stitch
```
