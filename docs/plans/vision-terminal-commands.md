# Aether Agent — Vision Model Terminal Commands Implementation Plan

> **For Hermes:** Use aether-agent-cli-commands skill to implement this plan task-by-task.

**Goal:** Add `aether vision` CLI command and `/vision` + `/download` REPL slash commands so users manage image/video models from the terminal the same way they manage text models.

**Architecture:** Reuses the existing GET /models catalog (which returns all 8 vision_* models with kind="model"). Filter for vision models client-side using id prefix `vision_` — no backend changes needed. Follows the proven 5-file pattern (transport → core → commands → main → slash) from vault and workflow command systems.

**Tech Stack:** TypeScript, Node.js, existing ApiClient + theme.js box library

**Recon Summary:**
- 8 vision models already registered in AETHER-CLOUD backend (PR #392 merged)
- GET /models returns vision models with kind="model", tier_min, enabled, available, monthly_uvt_cap
- Media generation endpoint does NOT exist yet — use existing /agent/chat with forced_model_key=vision_* + media_mode=true
- Vault download exists (VAULT_SPACES_DOWNLOAD_PATH) — can reuse for `/download` command
- Slash.ts has an "Orchestra" section — vision commands get their own "Vision" section
- Main.ts help text has vault/workflow examples — add vision section

---

## Files to Touch

| Layer | File | Change |
|-------|------|--------|
| Transport | `src/core/transport.ts` | Add MEDIA_DOWNLOAD route reference |
| Core | `src/core/vision.ts` | NEW — types, API wrappers, filter helpers, download helper |
| Commands | `src/commands/vision.ts` | NEW — CLI dispatch for `aether vision` (list, use, prompt) |
| Main | `src/main.ts` | Import cmdVision, switch case, 3 help lines |
| Slash | `src/commands/slash.ts` | /vision, /download cases + Vision help section |

---

## Phase 1: Core Module + Transport

### Task 1: Add vision route constant to transport.ts

**File:** `src/core/transport.ts` (append after AGENT_CONTEXT_PATH)

```typescript
// ── Vision media generation ───────────────────
export const MEDIA_GENERATE_PATH = "/agent/chat";  // media flows through chat SSE for MVP
```

**Verify:** `node --check src/core/transport.ts`

### Task 2: Create vision core module (src/core/vision.ts)

**File (new):** `src/core/vision.ts`

```typescript
// src/core/vision.ts — vision media model client (reuses /models catalog)
// 
// Every function wraps a single ApiClient call or filters catalog data.
// No terminal I/O — pure data. Download helper uses native fetch() for
// streaming binary saves since ApiClient only has JSON helpers.

import { ApiClient, VAULT_SPACES_DOWNLOAD_PATH } from "./transport.js";
import type { CatalogItem } from "../types.js";
import { createWriteStream } from "node:fs";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";

// ── Types ──────────────────────────────────────

export interface VisionModel {
  id: string;
  label: string;
  provider: string | null;
  tier_min: string | null;
  available: boolean;
  enabled: boolean;
  monthly_uvt_cap: number | null;
}

// ── Filter helpers ─────────────────────────────

const VISION_PREFIX = "vision_";

/** True iff a catalog item is a vision media model (image/video/3D). */
export function isVisionModel(item: CatalogItem): boolean {
  return item.kind === "model" && item.id.startsWith(VISION_PREFIX);
}

/** Filter catalog items to vision models only, ordered by id. */
export function filterVisionModels(items: CatalogItem[]): VisionModel[] {
  return items
    .filter(isVisionModel)
    .map(m => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      tier_min: m.tier_min,
      available: m.available,
      enabled: m.enabled,
      monthly_uvt_cap: m.monthly_uvt_cap,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ── Download helper ─────────────────────────────

/**
 * Download a file from a URL and save it to `destPath`.
 * Uses native fetch() for streaming binary download — ApiClient only has JSON helpers.
 * Returns the absolute path on success, or throws on failure.
 */
export async function downloadFile(
  api: ApiClient,
  url: string,
  destPath: string,
): Promise<string> {
  // Use the ApiClient's auth headers via internal access pattern
  const authHdrs = await (api as unknown as { 
    authHeaders: () => Promise<Record<string, string>> 
  }).authHeaders();
  
  const resp = await fetch(url, { headers: authHdrs });
  if (!resp.ok) {
    throw new Error(`download failed: HTTP ${resp.status}`);
  }
  if (!resp.body) {
    throw new Error("download failed: empty response body");
  }
  await pipeline(resp.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath));
  return destPath;
}

/**
 * Download a media file from a URL, saving to `destDir` with a filename
 * inferred from the URL or a user-supplied label.
 */
export async function downloadMedia(
  api: ApiClient,
  url: string,
  destDir: string,
  label?: string,
): Promise<string> {
  let filename = label || "media";
  try {
    const urlBasename = new URL(url).pathname.split("/").pop();
    if (urlBasename) filename = urlBasename;
  } catch { /* keep fallback */ }
  const destPath = destDir.replace(/\/$/, "") + "/" + filename;
  return downloadFile(api, url, destPath);
}
```

**Verify:** `npx tsc --noEmit src/core/vision.ts`

---

## Phase 2: CLI Command

### Task 3: Create vision command module (src/commands/vision.ts)

**File (new):** `src/commands/vision.ts`

Follows the exact pattern from `src/commands/github.ts` and `src/commands/workflow.ts`.

```typescript
// `aether vision`             — list vision media models
// `aether vision use <id>`    — set default to a vision model
// `aether vision prompt <...>` — send a prompt to the current/default vision model
//
// Vision models are filtered from the GET /models catalog (kind="model" + id starts with "vision_").

import type { AppContext } from "../core/context.js";
import type { CatalogResponse } from "../types.js";
import { MODELS_PATH } from "../core/transport.js";
import { filterVisionModels, type VisionModel } from "../core/vision.js";
import { saveConfig } from "../core/config.js";
import { theme } from "../ui/theme.js";

export async function cmdVision(ctx: AppContext, argv: string[]): Promise<number> {
  const sub = (argv[0] ?? "list").toLowerCase();
  switch (sub) {
    case "list":
    case "ls":
      return visionList(ctx);
    case "use": {
      const id = argv[1];
      if (!id) {
        process.stderr.write("usage: aether vision use <model-id>\n");
        return 2;
      }
      ctx.cfg.defaultModel = id;
      saveConfig(ctx.cfg);
      process.stdout.write(`default model → ${id}\n`);
      return 0;
    }
    case "prompt":
    case "generate": {
      const prompt = argv.slice(1).join(" ");
      if (!prompt) {
        process.stderr.write("usage: aether vision prompt <description>\n");
        return 2;
      }
      return visionPrompt(ctx, prompt);
    }
    case "help":
    case "":
      printVisionHelp();
      return 0;
    default:
      process.stderr.write(`unknown: aether vision ${sub}\n`);
      printVisionHelp();
      return 2;
  }
}

function printVisionHelp(): void {
  process.stdout.write([
    "aether vision list               List vision media models (image/video/3D)",
    "aether vision use <model-id>     Set default to a vision model",
    "aether vision prompt <desc>      Generate media from text description",
    "",
  ].join("\n"));
}

async function visionList(ctx: AppContext): Promise<number> {
  try {
    const cat = await ctx.api.getJson<CatalogResponse>(MODELS_PATH);
    const visions = filterVisionModels(cat.models);
    if (ctx.flags.json) {
      process.stdout.write(JSON.stringify(visions, null, 2) + "\n");
      return 0;
    }
    if (visions.length === 0) {
      process.stdout.write(theme.dim("  (no vision models available on your tier)\n"));
      return 0;
    }
    const active = ctx.cfg.defaultModel;
    for (const v of visions) {
      const mark = v.id === active ? theme.iceBlue("*") : " ";
      const lock = v.available ? " " : "🔒";
      const cap = v.monthly_uvt_cap != null ? `  cap ${v.monthly_uvt_cap}` : "";
      const provider = v.provider ? theme.dim(` (${v.provider})`) : "";
      const kind = v.id.includes("video") ? "🎬 video" : v.id.includes("3d") ? "🧊 3D" : "🖼  image";
      process.stdout.write(`${mark} ${lock} ${v.id}  ${kind}  ${v.label}${provider}${cap}\n`);
    }
    return 0;
  } catch (err) { return fail(err); }
}

async function visionPrompt(ctx: AppContext, prompt: string): Promise<number> {
  const modelKey = ctx.cfg.defaultModel;
  if (!modelKey || !modelKey.startsWith("vision_")) {
    process.stderr.write(
      "no vision model selected — use `aether vision use <id>` first, or pass --model <vision_id>\n"
    );
    return 1;
  }
  process.stdout.write(theme.dim(`sending to ${modelKey}: "${prompt}"...\n`));
  try {
    const resp = await ctx.api.postJson<{ response?: string; text?: string; media_url?: string }>(
      "/agent/chat",
      {
        query: prompt,
        forced_model_key: modelKey,
        media_mode: true,
        mode: "plan",
      },
    );
    const text = resp.response || resp.text || JSON.stringify(resp);
    process.stdout.write("\n" + text + "\n\n");
    if (resp.media_url) {
      process.stdout.write(theme.iceBlue("↓") + ` Media URL: ${resp.media_url}\n`);
      process.stdout.write(`  Run: aether download ${resp.media_url}\n`);
    }
    return 0;
  } catch (err) { return fail(err); }
}

function fail(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`✗ ${msg}\n  (are you logged in? run: aether auth login)\n`);
  return 1;
}
```

**Verify:** `npx tsc --noEmit src/commands/vision.ts`

---

## Phase 3: main.ts Wiring

### Task 4: Wire cmdVision into main.ts

**File:** `src/main.ts`

**Step 1: Add import** (after `cmdWorkflow` import, line ~21):
```typescript
import { cmdVision } from "./commands/vision.js";
```

**Step 2: Add switch case** (after `case "workflow":`, line ~171):
```typescript
    case "vision":
      return cmdVision(ctx, rest);
```

**Step 3: Add help text** (in HELP template literal, after workflow lines ~51):
```
  aether vision list                List vision media models (image/video/3D)
  aether vision use <model-id>      Set default vision model
  aether vision prompt <desc>       Generate media from description
```

**Verify:** `npx tsc --noEmit src/main.ts` and `node --check src/main.ts`

---

## Phase 4: Slash Commands

### Task 5: Add /vision and /download slash commands to slash.ts

**File:** `src/commands/slash.ts`

**Step 1: Import at top** (after existing imports, line ~36):
```typescript
import { filterVisionModels, downloadMedia, isVisionModel as isVisionItem } from "../core/vision.js";
import { theme } from "../ui/theme.js";
```

**Step 2: Add cases to handleSlash switch** (after `/gather` case, before `default`):

```typescript
    case "vision": {
      if (!arg) {
        // Show picker
        const cat = await getCatalog(ctx);
        const visions = filterVisionModels(cat.models);
        if (visions.length === 0) {
          out.write(theme.dim("  (no vision models available on your tier)\n"));
          break;
        }
        for (let i = 0; i < visions.length; i++) {
          const v = visions[i];
          const mark = v.id === ctx.cfg.defaultModel ? theme.iceBlue("*") : " ";
          const lock = v.available ? " " : "🔒";
          const kind = v.id.includes("video") ? "🎬 video" : v.id.includes("3d") ? "🧊 3D" : "🖼  image";
          out.write(`${i + 1}. ${mark} ${lock} ${v.id}  ${kind}  ${v.label}\n`);
        }
        out.write(theme.dim("\n/vision <n|id> to switch\n"));
        break;
      }
      // Switch to vision model
      const cat = await getCatalog(ctx);
      const visions = filterVisionModels(cat.models);
      const sel = resolveSelection(visions, arg);
      if (!sel) {
        out.write(theme.dim(`no vision model matching "${arg}"\n`));
        break;
      }
      if (!sel.available) {
        out.write(`🔒 ${sel.id} is not available on your tier (requires ${sel.tier_min || "higher tier"})\n`);
        break;
      }
      ctx.cfg.defaultModel = sel.id;
      out.write(theme.iceBlue(`→ default model set to ${sel.id} (${sel.label})\n`));
      out.write(theme.dim("  restart the REPL or switch via /model for it to take effect\n"));
      break;
    }
    case "download": {
      if (!arg) {
        out.write("usage: /download <url> [filename]\n");
        break;
      }
      const parts = arg.split(/\s+/);
      const url = parts[0];
      const label = parts.slice(1).join(" ") || undefined;
      out.write(theme.dim(`downloading ${url}...\n`));
      try {
        const saved = await downloadMedia(ctx.api, url, process.cwd(), label);
        out.write(theme.iceBlue("↓") + ` saved ${saved}\n`);
      } catch (err) {
        out.write(`✗ download failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      break;
    }
```

**Step 3: Add Vision section to printHelp** (after "Orchestra" section closing `]`, before "UVT Tools" section):

```typescript
    [
      "",
      theme.iceBlue("🖼") + "  " + theme.bold("Vision (Image/Video)"),
      "",
      theme.dim("/vision") + "               list vision media models",
      theme.dim("/vision") + " <n|id>          switch to vision model",
      theme.dim("/download") + " <url> [name]   download generated media to disk",
      "",
    ],
```

**Verify:** `npx tsc --noEmit src/commands/slash.ts`

---

## Phase 5: Build & Verify

### Task 6: Full build and end-to-end verification

```bash
cd /root/aether-agent
# Type-check all changed files
npx tsc --noEmit src/core/vision.ts src/commands/vision.ts src/main.ts src/commands/slash.ts

# Full build
npx tsc -p tsconfig.json

# Verify help text renders
node dist/src/main.js vision help
# Expected: prints "aether vision list ... use ... prompt ..."

node dist/src/main.js help | grep -A2 vision
# Expected: 3 vision help lines

# Verify slash help includes Vision section
# (tested interactively in REPL, not scriptable)
```

---

## Summary: The Vision Command Surface

```
aether vision list                List vision media models (image/video/3D)
aether vision use <model-id>      Set default to a vision model  
aether vision prompt <desc>       Generate media from description

/vision              Show vision model picker (REPL)
/vision <n|id>       Switch to vision model (REPL)
/download <url>      Download media to current directory (REPL)
/download <url> <name> Download with custom filename (REPL)
```

### Data Flow
```
aether vision list
  → GET /models → filter catalog for id starts "vision_"
  → render with kind icons (🖼 image / 🎬 video / 🧊 3D)

aether vision prompt "sunset over mountains"
  → POST /agent/chat {forced_model_key: vision_nano_pro, media_mode: true}
  → SSE response includes media URL in text
  → terminal prints response + URL + "Run: aether download <url>"

/download https://cdn.aethersystems.net/gen/abc123.png
  → fetch() with auth headers → stream to file → print saved path
```
