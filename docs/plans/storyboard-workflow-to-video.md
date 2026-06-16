# Aether Agent — /storyboard: Workflow → Video Pipeline

> **Appended to:** media-asset-production-commands.md (Phase 6)

**Goal:** Parse a text prompt or markdown script file into a structured storyboard — scenes with keyframe prompts, camera movement instructions, shot types, and color palette notes — then drive the full generation pipeline (keyframes → animate → stitch) from that storyboard.

**Architecture:** Storyboard is a workflow subtype. `/storyboard` writes an `aetherflow.json` file to the vault that the existing `/workflow` commands can list, view, and status. Each scene maps to a workflow phase. The storyboard engine generates prompts per phase, then the existing image/video commands render them.

---

## Command Surface

```
/storyboard <prompt> [--scenes <n>] [--style <style>]
    Parse a text description into scenes

/storyboard <script_file.md> [--scenes <n>]
    Parse a markdown script file into scenes

/storyboard --preview [id]
    Show parsed scenes without generating anything

/storyboard --generate [id]
    Generate all keyframes via /photogen per scene

/storyboard --animate [id]
    Animate keyframe sequence via /animate between scenes

/storyboard --render [id]
    Full pipeline: parse → keyframes → animate → output

/storyboard list
    List saved storyboards

/storyboard view <id>
    Show scene breakdown for a saved storyboard
```

---

## Scene Model

```typescript
interface StoryboardScene {
  index: number;               // 1-based
  shot_type: string;           // WIDE | MED | CLOSE | OVERHEAD | POV | TRACKING | DOLLY
  camera_movement: string;     // static | pan-left | pan-right | tilt-up | tilt-down | push-in | pull-out | orbit | dolly | crane
  keyframe_prompt: string;     // ready-to-use /photogen prompt
  animation_prompt: string;    // ready-to-use /animate instruction
  color_palette: string;       // "cold blue / dusty orange" | "warm gold / deep shadow"
  lighting: string;            // "golden hour backlight" | "harsh overhead" | "moody ambient"
  duration_sec: number;         // suggested clip length
  transition: string;          // cut | dissolve | wipe-left | fade-black
  notes: string;               // director notes for reference
}

interface Storyboard {
  id: string;
  title: string;
  source_type: "prompt" | "script_file";
  source: string;              // original prompt or file path
  style: string;               // cinematic | documentary | anime | commercial | music-video
  total_scenes: number;
  scenes: StoryboardScene[];
  created_at: string;
  status: "draft" | "keyframes_generated" | "animated" | "rendered";
}
```

---

## Prompt Parser — LLM-Powered Scene Breakdown

The parser sends the user's narrative to an LLM (Sonnet, cheap, one-shot) with a structured output format:

```
You are a storyboard artist. Break this narrative into N distinct scenes.
For each scene, output:

SCENE <n>: <SHOT_TYPE> | <CAMERA_MOVEMENT>
  Visual: <detailed keyframe description suitable for image generation>
  Motion: <camera movement description for animation>
  Palette: <color palette>
  Lighting: <lighting setup>
  Duration: <seconds>
  Transition: <transition type>
  Notes: <director notes>

Styles: cinematic, documentary, anime, commercial, music-video

Example input: "A lone astronaut discovers an alien artifact on Mars..."
Example output:
SCENE 1: WIDE | push-in
  Visual: Wide shot of red Martian desert, small astronaut figure in distance approaching a metallic geometric structure half-buried in rust-colored sand, dust particles in thin atmosphere, harsh sunlight
  Motion: Slow push-in toward the astronaut, settling to medium distance
  Palette: Rust red, dusty orange, cold steel grey
  Lighting: Harsh overhead sunlight, long shadows
  Duration: 6
  Transition: cut
  Notes: Establish scale and isolation
```

The parser function:

```typescript
export interface StoryboardParseResult {
  title: string;
  style: string;
  scenes: StoryboardScene[];
  raw_llm_output: string;
}

export async function parseStoryboard(
  api: ApiClient,
  source: string,
  sourceType: "prompt" | "script_file",
  options?: { scenes?: number; style?: string },
): Promise<StoryboardParseResult> {
  const style = options?.style ?? "cinematic";
  const sceneHint = options?.scenes ? `Break this into exactly ${options.scenes} distinct scenes.` : "";
  
  const systemPrompt = `You are a storyboard artist. ${sceneHint}
For each scene output the format:
SCENE <n>: <SHOT_TYPE> | <CAMERA_MOVEMENT>
  Visual: <keyframe description>
  Motion: <camera instructions>
  Palette: <colors>
  Lighting: <setup>
  Duration: <seconds>
  Transition: <type>
  Notes: <any>

Shot types: WIDE | MED | CLOSE | OVERHEAD | POV | TRACKING | DOLLY
Camera: static | pan-left | pan-right | tilt-up | tilt-down | push-in | pull-out | orbit | dolly | crane
Transitions: cut | dissolve | wipe-left | wipe-right | fade-black | fade-white
Style: ${style}

Reply ONLY with the formatted scenes, no preamble.`;

  const content = sourceType === "script_file" 
    ? require("node:fs").readFileSync(source, "utf-8")
    : source;

  const resp = await api.postJson<{ response?: string; text?: string }>("/agent/chat", {
    query: `STORYBOARD REQUEST:\n\n${content}\n\n${sceneHint}`,
    forced_model_key: "sonnet",
    mode: "plan",
    meta: { system_prompt: systemPrompt },
  });

  const raw = resp.response || resp.text || "";
  const scenes = parseScenes(raw);
  const title = sourceType === "prompt" 
    ? source.slice(0, 60).replace(/\n/g, " ") 
    : source.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "untitled";

  return { title, style, scenes, raw_llm_output: raw };
}
```

---

## Scene Parser — Deterministic Regex Extraction

```typescript
function parseScenes(raw: string): StoryboardScene[] {
  const scenes: StoryboardScene[] = [];
  const blocks = raw.split(/SCENE \d+/i).filter(b => b.trim());
  
  let idx = 0;
  for (const block of blocks) {
    idx++;
    const headerMatch = block.match(/^:?\s*(\w+)\s*\|\s*([\w-]+)/);
    const shotType = headerMatch?.[1]?.toUpperCase() ?? "WIDE";
    const camera = headerMatch?.[2]?.toLowerCase() ?? "static";
    
    const visual = extractField(block, "Visual");
    const motion = extractField(block, "Motion");
    const palette = extractField(block, "Palette") ?? "natural";
    const lighting = extractField(block, "Lighting") ?? "ambient";
    const duration = parseInt(extractField(block, "Duration") ?? "5", 10);
    const transition = extractField(block, "Transition") ?? "cut";
    const notes = extractField(block, "Notes") ?? "";
    
    if (!visual) continue;
    
    scenes.push({
      index: idx,
      shot_type: shotType,
      camera_movement: camera,
      keyframe_prompt: visual + ` [${palette} palette, ${lighting} lighting]`,
      animation_prompt: motion || `${camera} camera movement`,
      color_palette: palette,
      lighting,
      duration_sec: Math.min(30, Math.max(3, duration)),
      transition,
      notes,
    });
  }
  
  return scenes;
}

function extractField(block: string, field: string): string | undefined {
  const re = new RegExp(`${field}:\\s*(.+?)(?:\\n|$)`, "i");
  return block.match(re)?.[1]?.trim();
}
```

---

## Storyboard Storage — Vault-Based Persistence

Storyboards are saved as `.aetherflow.json` files in the vault, compatible with the existing workflow system:

```typescript
import { writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const STORYBOARD_DIR = join(ensureOutputDir(), "storyboards");

function storyboardPath(id: string): string {
  return join(STORYBOARD_DIR, `${id}.storyboard.json`);
}

export function saveStoryboard(sb: Storyboard): void {
  if (!existsSync(STORYBOARD_DIR)) require("node:fs").mkdirSync(STORYBOARD_DIR, { recursive: true });
  writeFileSync(storyboardPath(sb.id), JSON.stringify(sb, null, 2));
}

export function loadStoryboard(id: string): Storyboard | null {
  const p = storyboardPath(id);
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
    .filter(Boolean) as any[];
}
```

---

## Storyboard Rendering Pipeline

The render phases use existing commands via internal dispatch:

```typescript
export async function renderStoryboardPhase(
  api: ApiClient,
  sb: Storyboard,
  phase: "preview" | "generate" | "animate" | "render",
  out: Writable,
): Promise<void> {
  switch (phase) {
    case "preview":
      previewStoryboard(sb, out);
      break;
    case "generate":
      await generateKeyframes(api, sb, out);
      break;
    case "animate":
      await animateScenes(api, sb, out);
      break;
    case "render":
      await generateKeyframes(api, sb, out);
      await animateScenes(api, sb, out);
      break;
  }
}

function previewStoryboard(sb: Storyboard, out: Writable): void {
  out.write(`\n${theme.iceBlue("🎬")}  STORYBOARD: ${sb.title}\n`);
  out.write(`   style: ${sb.style}  |  scenes: ${sb.total_scenes}  |  status: ${sb.status}\n\n`);
  
  for (const s of sb.scenes) {
    const dur = `${s.duration_sec}s`;
    out.write(
      `${theme.iceBlue("SCENE " + s.index)}  ${s.shot_type.padEnd(8)} | ${s.camera_movement.padEnd(10)} | ${dur.padEnd(4)} | ${s.transition}\n` +
      `  ${theme.dim("visual:")} ${s.keyframe_prompt.slice(0, 80)}${s.keyframe_prompt.length > 80 ? "..." : ""}\n` +
      `  ${theme.dim("motion:")} ${s.animation_prompt.slice(0, 80)}\n` +
      `  ${theme.dim("palette:")} ${s.color_palette}  ${theme.dim("light:")} ${s.lighting}\n\n`
    );
  }
}

async function generateKeyframes(api: ApiClient, sb: Storyboard, out: Writable): Promise<void> {
  out.write(theme.dim(`generating ${sb.total_scenes} keyframes...\n\n`));
  for (const s of sb.scenes) {
    out.write(theme.dim(`  scene ${s.index}/${sb.total_scenes}: ${s.shot_type}\n`));
    try {
      const resp = await dispatchGeneration(api, s.keyframe_prompt, autoRouteModel(s.keyframe_prompt, "image"), {
        aspect: "16_9",
      });
      if (resp.media_url) {
        const filepath = await downloadMediaFile(api, resp.media_url, ensureOutputDir(), 
          autoRouteModel(s.keyframe_prompt, "image"), "image");
        s.generated_frame_url = resp.media_url;
        s.generated_frame_path = filepath;
        const result: GenResult = {
          model: autoRouteModel(s.keyframe_prompt, "image"),
          prompt: s.keyframe_prompt, kind: "image",
          filepath, filename: basename(filepath),
          url: resp.media_url, timestamp: new Date().toISOString(), flags: {},
        };
        const entry = recordOutput(result);
        out.write(`    ${theme.iceBlue("#" + entry.index)} ${entry.filename}\n`);
      }
    } catch (err) {
      out.write(`    ✗ ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  sb.status = "keyframes_generated";
  saveStoryboard(sb);
}

async function animateScenes(api: ApiClient, sb: Storyboard, out: Writable): Promise<void> {
  const animated = sb.scenes.filter(s => s.generated_frame_url);
  out.write(theme.dim(`animating ${animated.length} scenes...\n\n`));
  for (const s of animated) {
    out.write(theme.dim(`  scene ${s.index}: ${s.camera_movement} over ${s.duration_sec}s\n`));
    try {
      const flags: GenFlags = { model: "seedance", ref: s.generated_frame_url, duration: s.duration_sec };
      const resp = await dispatchGeneration(api, s.animation_prompt, "vision_seedance", flags);
      if (resp.media_url) {
        const filepath = await downloadMediaFile(api, resp.media_url, ensureOutputDir(), "vision_seedance", "video");
        const result: GenResult = {
          model: "vision_seedance", prompt: s.animation_prompt, kind: "video",
          filepath, filename: basename(filepath),
          url: resp.media_url, timestamp: new Date().toISOString(), flags,
        };
        const entry = recordOutput(result);
        out.write(`    ${theme.iceBlue("#" + entry.index)} ${entry.filename}\n`);
      }
    } catch (err) {
      out.write(`    ✗ ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  sb.status = "animated";
  saveStoryboard(sb);
}
```

---

## Slash Handler

```typescript
case "storyboard": {
  await storyboardSlash(ctx, out, arg);
  break;
}
```

Handler:

```typescript
async function storyboardSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(" ");

  if (sub === "list" || sub === "ls") {
    const boards = listStoryboards();
    if (boards.length === 0) {
      out.write(theme.dim("  (no saved storyboards)\n"));
      return;
    }
    out.write(`\n${theme.iceBlue("🎬")}  STORYBOARDS\n\n`);
    for (const b of boards) {
      out.write(`  ${b.id.padEnd(20)} ${b.title.slice(0, 40)}  ${b.scenes} scenes  [${b.status}]\n`);
    }
    return;
  }

  if (sub === "view" && rest) {
    const sb = loadStoryboard(rest);
    if (!sb) { out.write(theme.dim(`  no storyboard "${rest}"\n`)); return; }
    previewStoryboard(sb, out);
    return;
  }

  if (sub === "--preview" || sub === "--generate" || sub === "--animate" || sub === "--render") {
    const phase = sub.replace("--", "") as "preview" | "generate" | "animate" | "render";
    // Find most recent storyboard
    const boards = listStoryboards();
    const id = rest || (boards[0]?.id ?? "");
    const sb = loadStoryboard(id);
    if (!sb) { out.write(theme.dim("  no storyboard found — create one first\n")); return; }
    await renderStoryboardPhase(ctx.api, sb, phase, out);
    return;
  }

  // Parse mode — arg is either a prompt or a file path
  if (!arg.trim()) {
    out.write("usage: /storyboard <prompt|script_file> [--scenes <n>] [--style <style>]\n");
    out.write("       /storyboard --preview|--generate|--animate|--render [id]\n");
    out.write("       /storyboard list|view <id>\n");
    return;
  }

  // Detect source type
  let sourceType: "prompt" | "script_file" = "prompt";
  let source = arg;
  let options: { scenes?: number; style?: string } = {};

  if (existsSync(parts[0]) && /\.(md|txt)$/i.test(parts[0])) {
    sourceType = "script_file";
    source = parts[0];
    const flagStr = parts.slice(1).join(" ");
    options = parseStoryboardFlags(flagStr);
  } else {
    const firstFlag = parts.findIndex(p => p.startsWith("--"));
    if (firstFlag > 0) {
      source = parts.slice(0, firstFlag).join(" ");
      options = parseStoryboardFlags(parts.slice(firstFlag).join(" "));
    }
  }

  out.write(theme.dim("parsing storyboard...\n"));
  try {
    const result = await parseStoryboard(ctx.api, source, sourceType, options);
    const sb: Storyboard = {
      id: `sb_${Date.now().toString(36)}`,
      title: result.title,
      source_type: sourceType,
      source,
      style: result.style,
      total_scenes: result.scenes.length,
      scenes: result.scenes,
      created_at: new Date().toISOString(),
      status: "draft",
    };
    saveStoryboard(sb);
    previewStoryboard(sb, out);
    out.write(theme.dim("\n/storyboard --generate   to generate all keyframes\n"));
    out.write(theme.dim("/storyboard --animate    to animate the sequence\n"));
    out.write(theme.dim("/storyboard --render     full pipeline\n"));
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

function parseStoryboardFlags(raw: string): { scenes?: number; style?: string } {
  const result: { scenes?: number; style?: string } = {};
  const parts = raw.split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    if ((parts[i] === "--scenes" || parts[i] === "-n") && parts[i + 1]) {
      result.scenes = parseInt(parts[++i], 10);
    } else if (parts[i] === "--style" && parts[i + 1]) {
      result.style = parts[++i];
    }
  }
  return result;
}
```

---

## Help Section Addition

Add to printHelp (new section between Vision Video and Vision Output):

```typescript
    [
      "",
      theme.iceBlue("🎬") + "  " + theme.bold("Vision — Storyboard"),
      "",
      theme.dim("/storyboard") + " <prompt|file> [--scenes n] [--style]   parse into scenes",
      theme.dim("/storyboard") + " --preview|--generate|--animate|--render",
      theme.dim("/storyboard") + " list|view <id>                        manage storyboards",
      "",
    ],
```

---

## Additions to core/vision.ts

Extend the `GenResult` interface to include storyboard-scoped fields:

```typescript
  // Storyboard fields (set during storyboard render pipeline)
  generated_frame_url?: string;
  generated_frame_path?: string;
```

Add these exports: `parseStoryboard`, `saveStoryboard`, `loadStoryboard`, `listStoryboards`, `renderStoryboardPhase`.

---

## Workflow Integration

Storyboards write `.storyboard.json` files to `./aether-output/storyboards/`. The existing `/workflow` commands can discover these via the workflow list (if we add a storyboard kind to the `aetherflow.json` format). This connects two workflows:

```
/storyboard "product launch trailer concept"     → writes sb_xyz.storyboard.json
/workflow                                         → shows storyboard as active workflow
/workflow view <id>                               → shows scene breakdown
/storyboard --generate                            → keyframes become output #1-#8
/storyboard --animate                             → videos become output #9-#16
/output                                           → see all 16 items
```

---

## Files to Add (Phase 6)

| Layer | Change |
|-------|--------|
| `src/core/vision.ts` | Add parseStoryboard, save/load/list, render pipeline, GenResult.storyboard fields |
| `src/commands/slash.ts` | Add /storyboard case + handler + help section |
| `output/storyboards/` | Directory auto-created for persistence |
