// ═════════════════════════════════════════════════════════════════════
// In-REPL media pipeline slash commands: /photogen /frame /re-frame
// /videogen /sequence /animate /re-cut /output /storyboard.
// Split out of slash.ts (was 1807 lines) to keep each command group under
// the repo's ~800-line file convention.
// ═════════════════════════════════════════════════════════════════════

import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import { theme } from "../ui/theme.js";
import { basename } from "node:path";
import { existsSync as fsExistsSync } from "node:fs";
import {
  resolveModelKey, autoRouteModel,
  buildMediaPrompt, dispatchGeneration, downloadMediaFile,
  ensureOutputDir, recordOutput, listOutput, findOutput, openOutput, clearOutput,
  parseStoryboard, saveStoryboard, loadStoryboard, listStoryboards,
  type MediaKind, type GenFlags, type GenResult, type Storyboard,
} from "../core/vision.js";

// Media pipeline state — persists across turns in the same REPL session.
// Cleared on REPL restart. Used by /re-frame and /re-cut.
let _lastMediaUrl: string | null = null;
let _lastMediaModel: string | null = null;
let _lastMediaKind: MediaKind | null = null;

function parseSlashFlags(raw: string, _kind: MediaKind): { prompt: string; flags: GenFlags } {
  const flags: GenFlags = {};
  const parts = raw.split(/\s+/);
  const promptParts: string[] = [];
  let inFlags = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] ?? "";
    if (!inFlags && p.startsWith("--")) { inFlags = true; }
    if (inFlags) {
      const next = parts[i + 1] ?? "";
      if (p === "--model" && next) { flags.model = next; i++; }
      else if (p === "--aspect" && next) { flags.aspect = next; i++; }
      else if ((p === "--count" || p === "--batch") && next) { flags.count = parseInt(next, 10) || 1; i++; }
      else if (p === "--4k") { flags.fourK = true; }
      else if (p === "--vector") { flags.vector = true; }
      else if ((p === "--duration" || p === "--10s") && next) { flags.duration = parseInt(next, 10) || 10; i++; }
      else if (p === "--1080p") { flags.hd1080 = true; }
      else if (p === "--audio") { flags.audio = true; }
      else if (p === "--save-to-vault") { flags.saveToVault = true; }
      else if (p === "--ref" && next) { flags.ref = next; i++; }
      else if (p === "--open") { flags.open = true; }
    } else {
      promptParts.push(p);
    }
  }
  return { prompt: promptParts.join(" "), flags };
}

const SF = theme.dim;

export async function photogenSlash(ctx: AppContext, out: Writable, arg: string, _framed: boolean): Promise<void> {
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
  out.write(SF(`generating ${count} image(s) with ${modelKey}: "${prompt}"\n\n`));
  for (let i = 0; i < count; i++) {
    try {
      const vp = count > 1 ? `${fullPrompt} [variant ${i + 1} of ${count}]` : fullPrompt;
      out.write(SF(`[${i + 1}/${count}] `));
      const resp = await dispatchGeneration(ctx.api, vp, modelKey, flags);
      if (resp.media_url) {
        out.write(SF("downloading...\n"));
        const filepath = await downloadMediaFile(ctx.api, resp.media_url, outdir, modelKey, kind, resp.filename);
        const result: GenResult = {
          model: modelKey, prompt: vp, kind, filepath, filename: basename(filepath),
          url: resp.media_url, timestamp: new Date().toISOString(), flags,
        };
        const entry = recordOutput(result);
        out.write(`  ${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n`);
        out.write(`  ${SF(resp.media_url)}\n\n`);
        _lastMediaUrl = resp.media_url; _lastMediaModel = modelKey; _lastMediaKind = kind;
      } else {
        out.write(SF("  no media URL returned\n"));
      }
    } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
  }
}

export async function reframeSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!_lastMediaUrl || _lastMediaKind !== "image") { out.write(SF("  no previous image to edit\n")); return; }
  if (!arg) { out.write("usage: /re-frame <edit description>\n"); return; }
  const editPrompt = `Edit the previously generated image: ${arg}`;
  const flags: GenFlags = { model: "edit", ref: _lastMediaUrl };
  out.write(SF(`editing with gpt-image-2: "${arg}"\n\n`));
  try {
    const resp = await dispatchGeneration(ctx.api, editPrompt, "vision_gpt_image2", flags);
    if (resp.media_url) {
      const filepath = await downloadMediaFile(ctx.api, resp.media_url, ensureOutputDir(), "vision_gpt_image2", "image", resp.filename);
      const entry = recordOutput({ model: "vision_gpt_image2", prompt: editPrompt, kind: "image", filepath, filename: basename(filepath), url: resp.media_url, timestamp: new Date().toISOString(), flags });
      out.write(`${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n`);
      _lastMediaUrl = resp.media_url; _lastMediaModel = "vision_gpt_image2";
    }
  } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
}

export async function videogenSlash(ctx: AppContext, out: Writable, arg: string, cinematic: boolean): Promise<void> {
  const { prompt, flags } = parseSlashFlags(arg, "video");
  if (!prompt) { out.write("usage: /videogen <prompt> [--model seedance] [--duration 10] [--1080p] [--audio]\n  /sequence <prompt>\n"); return; }
  const kind: MediaKind = "video";
  const modelKey = flags.model ? resolveModelKey(flags.model) : cinematic ? "seedance" : autoRouteModel(prompt, kind);
  if (!flags.duration) flags.duration = 5;
  const fullPrompt = buildMediaPrompt(prompt, flags, kind);
  out.write(SF(`generating video with ${modelKey}: "${prompt}"\n\n`));
  try {
    const resp = await dispatchGeneration(ctx.api, fullPrompt, modelKey, flags);
    if (resp.media_url) {
      out.write(SF("downloading video...\n"));
      const filepath = await downloadMediaFile(ctx.api, resp.media_url, ensureOutputDir(), modelKey, kind, resp.filename);
      const entry = recordOutput({ model: modelKey, prompt: fullPrompt, kind, filepath, filename: basename(filepath), url: resp.media_url, timestamp: new Date().toISOString(), flags });
      out.write(`${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n  ${SF(resp.media_url)}\n\n`);
      _lastMediaUrl = resp.media_url; _lastMediaModel = modelKey; _lastMediaKind = kind;
    }
  } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
}

export async function animateSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const args = arg.trim().split(/\s+/);
  const ref = args[0];
  const extraPrompt = args.slice(1).join(" ");
  if (!ref) { out.write("usage: /animate <image_url|file.png|#n> [motion description]\n"); return; }
  let refUrl = ref;
  if (/^#?\d+$/.test(ref)) {
    const entry = findOutput(ref.replace("#", ""));
    if (entry) refUrl = entry.url;
    else { out.write(SF(`  no output matching "${ref}"\n`)); return; }
  }
  const prompt = `Animate this image into a fluid video sequence${extraPrompt ? ": " + extraPrompt : ""}`;
  out.write(SF(`animating from ${refUrl.slice(0, 50)}...\n\n`));
  try {
    const resp = await dispatchGeneration(ctx.api, prompt, "vision_seedance", { model: "seedance", ref: refUrl, duration: 5 });
    if (resp.media_url) {
      const filepath = await downloadMediaFile(ctx.api, resp.media_url, ensureOutputDir(), "vision_seedance", "video", resp.filename);
      const entry = recordOutput({ model: "vision_seedance", prompt, kind: "video", filepath, filename: basename(filepath), url: resp.media_url, timestamp: new Date().toISOString(), flags: { model: "seedance", ref: refUrl, duration: 5 } });
      out.write(`${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n`);
      _lastMediaUrl = resp.media_url; _lastMediaModel = "vision_seedance"; _lastMediaKind = "video";
    }
  } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
}

export async function recutSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!_lastMediaUrl || _lastMediaKind !== "video") { out.write(SF("  no previous video to edit\n")); return; }
  if (!arg) { out.write("usage: /re-cut <edit description>\n"); return; }
  const modelKey = _lastMediaModel || "vision_seedance";
  const editPrompt = `Edit the previously generated video: ${arg}`;
  out.write(SF(`editing video: "${arg}"\n\n`));
  try {
    const resp = await dispatchGeneration(ctx.api, editPrompt, modelKey, { model: modelKey, ref: _lastMediaUrl });
    if (resp.media_url) {
      const filepath = await downloadMediaFile(ctx.api, resp.media_url, ensureOutputDir(), modelKey, "video", resp.filename);
      const entry = recordOutput({ model: modelKey, prompt: editPrompt, kind: "video", filepath, filename: basename(filepath), url: resp.media_url, timestamp: new Date().toISOString(), flags: {} });
      out.write(`${theme.iceBlue("↓")} #${entry.index}  ${entry.filename}\n`);
      _lastMediaUrl = resp.media_url;
    }
  } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
}

export async function outputSlash(_ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const ref = parts.slice(1).join(" ");
  if (sub === "open" || sub === "o") {
    if (!ref) { out.write("usage: /output open <n|filename>\n"); return; }
    const entry = findOutput(ref);
    if (!entry) { out.write(SF(`  no output matching "${ref}"\n`)); return; }
    try { openOutput(entry); out.write(`${theme.iceBlue("→")} opened ${entry.filename}\n`); }
    catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
    return;
  }
  if (sub === "clean" || sub === "clear") { out.write(SF(`  cleared ${clearOutput()} entries\n`)); return; }
  const entries = listOutput(10);
  if (!entries.length) { out.write(SF("  (no generations yet — use /photogen or /videogen)\n")); return; }
  out.write(`${theme.iceBlue("📦")}  RECENT GENERATIONS\n\n`);
  for (const e of entries) {
    const icon = e.kind === "video" ? "🎬" : e.kind === "3d" ? "🧊" : "🖼";
    const sp = e.prompt.length > 50 ? e.prompt.slice(0, 47) + "..." : e.prompt;
    out.write(`  ${theme.iceBlue("#" + e.index)} ${icon}  ${e.filename}\n     ${SF(`${e.model}  ${(e.size_bytes/1024/1024).toFixed(1)}MB  ${sp}`)}\n`);
  }
  out.write(SF("\n  /output open <n>  — open in default viewer\n\n"));
}

export async function storyboardSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(" ");
  if (sub === "list" || sub === "ls") {
    const boards = listStoryboards();
    if (!boards.length) { out.write(SF("  (no saved storyboards)\n")); return; }
    out.write(`\n${theme.iceBlue("🎬")}  STORYBOARDS\n\n`);
    for (const b of boards) out.write(`  ${b.id.padEnd(20)} ${b.title.slice(0, 40)}  ${b.scenes} scenes  [${b.status}]\n`);
    return;
  }
  if (sub === "view" && rest) {
    const sb = loadStoryboard(rest);
    if (!sb) { out.write(SF(`  no storyboard "${rest}"\n`)); return; }
    sbPreview(sb, out);
    return;
  }
  if (sub === "--preview" || sub === "--generate" || sub === "--animate" || sub === "--render") {
    const boards = listStoryboards();
    const id = rest || (boards[0]?.id ?? "");
    const sb = loadStoryboard(id);
    if (!sb) { out.write(SF("  no storyboard found\n")); return; }
    const phase = sub.replace("--", "");
    if (phase === "preview") { sbPreview(sb, out); return; }
    await sbRender(ctx, sb, phase, out);
    return;
  }
  if (!arg.trim()) { out.write("usage: /storyboard <prompt|file> [--scenes n] [--style style]\n  /storyboard --preview|--generate|--animate|--render [id]\n  /storyboard list|view <id>\n"); return; }
  let sourceType: "prompt" | "script_file" = "prompt";
  let source = arg;
  let opts: { scenes?: number; style?: string } = {};
  const firstArg = parts[0] ?? "";
  if (fsExistsSync(firstArg) && /\.(md|txt)$/i.test(firstArg)) {
    sourceType = "script_file"; source = firstArg; opts = sbFlagParse(parts.slice(1).join(" "));
  } else {
    const fi = parts.findIndex(p => p.startsWith("--"));
    if (fi > 0) { source = parts.slice(0, fi).join(" "); opts = sbFlagParse(parts.slice(fi).join(" ")); }
  }
  out.write(SF("parsing storyboard...\n"));
  try {
    const result = await parseStoryboard(ctx.api, source, sourceType, opts);
    const sb = { id: `sb_${Date.now().toString(36)}`, title: result.title, source_type: sourceType, source, style: result.style, total_scenes: result.scenes.length, scenes: result.scenes, created_at: new Date().toISOString(), status: "draft" as const };
    saveStoryboard(sb);
    sbPreview(sb, out);
    out.write(SF("\n/storyboard --generate   to generate all keyframes\n"));
    out.write(SF("/storyboard --animate    to animate the sequence\n"));
    out.write(SF("/storyboard --render     full pipeline\n"));
  } catch (err) { out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`); }
}

function sbFlagParse(raw: string): { scenes?: number; style?: string } {
  const r: { scenes?: number; style?: string } = {};
  const p = raw.split(/\s+/);
  for (let i = 0; i < p.length; i++) {
    const next = p[i + 1] ?? "";
    if ((p[i] === "--scenes" || p[i] === "-n") && next) { r.scenes = parseInt(next, 10); i++; }
    else if (p[i] === "--style" && next) { r.style = next; i++; }
  }
  return r;
}

function sbPreview(sb: Storyboard, out: Writable): void {
  out.write(`\n${theme.iceBlue("🎬")}  STORYBOARD: ${sb.title}\n`);
  out.write(SF(`   style: ${sb.style}  |  scenes: ${sb.total_scenes}  |  status: ${sb.status}\n\n`));
  for (const s of sb.scenes) {
    out.write(
      `${theme.iceBlue("SCENE " + s.index)}  ${(s.shot_type||"WIDE").padEnd(8)} | ${(s.camera_movement||"static").padEnd(10)} | ${s.duration_sec}s  | ${s.transition}\n` +
      `  ${SF("visual:")} ${(s.keyframe_prompt||"").slice(0,80)}${(s.keyframe_prompt||"").length>80?"...":""}\n` +
      `  ${SF("motion:")} ${(s.animation_prompt||"").slice(0,80)}\n` +
      `  ${SF("palette:")} ${s.color_palette||"natural"}  ${SF("light:")} ${s.lighting||"ambient"}\n\n`
    );
  }
}

async function sbRender(ctx: AppContext, sb: Storyboard, phase: string, out: Writable): Promise<void> {
  if (phase === "generate" || phase === "render") {
    out.write(SF(`generating ${sb.total_scenes} keyframes...\n\n`));
    for (const s of sb.scenes) {
      out.write(SF(`  scene ${s.index}/${sb.total_scenes}: ${s.shot_type}\n`));
      try {
        const mk = autoRouteModel(s.keyframe_prompt, "image");
        const resp = await dispatchGeneration(ctx.api, s.keyframe_prompt, mk, { aspect: "16_9" });
        if (resp.media_url) {
          const fp = await downloadMediaFile(ctx.api, resp.media_url, ensureOutputDir(), mk, "image");
          s.generated_frame_url = resp.media_url; s.generated_frame_path = fp;
          recordOutput({ model: mk, prompt: s.keyframe_prompt, kind: "image", filepath: fp, filename: basename(fp), url: resp.media_url, timestamp: new Date().toISOString(), flags: {} });
          out.write(`    ${theme.iceBlue("✓")} scene ${s.index}\n`);
        }
      } catch (err) { out.write(`    ✗ ${err instanceof Error ? err.message : String(err)}\n`); }
    }
    sb.status = "keyframes_generated"; saveStoryboard(sb);
  }
  if (phase === "animate" || phase === "render") {
    const anim = sb.scenes.filter((s) => s.generated_frame_url);
    out.write(SF(`animating ${anim.length} scenes...\n\n`));
    for (const s of anim) {
      out.write(SF(`  scene ${s.index}: ${s.camera_movement} over ${s.duration_sec}s\n`));
      try {
        const resp = await dispatchGeneration(ctx.api, s.animation_prompt, "vision_seedance", { model: "seedance", ref: s.generated_frame_url, duration: s.duration_sec });
        if (resp.media_url) {
          const fp = await downloadMediaFile(ctx.api, resp.media_url, ensureOutputDir(), "vision_seedance", "video");
          recordOutput({ model: "vision_seedance", prompt: s.animation_prompt, kind: "video", filepath: fp, filename: basename(fp), url: resp.media_url, timestamp: new Date().toISOString(), flags: {} });
          out.write(`    ${theme.iceBlue("✓")} scene ${s.index}\n`);
        }
      } catch (err) { out.write(`    ✗ ${err instanceof Error ? err.message : String(err)}\n`); }
    }
    sb.status = "animated"; saveStoryboard(sb);
  }
}
