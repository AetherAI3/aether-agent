// UVT /port — deep code translation between languages.

import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { ApiClient } from "./transport.js";
import { UVT_PORT_PATH } from "./transport.js";

export interface PortRequest {
  files: Array<{ path: string; content: string }>;
  target_language: string;
  source_language?: string;
}

export interface PortedFile {
  path: string;
  content: string;
}

export interface PortResponse {
  files: PortedFile[];
}

export async function portCode(
  api: ApiClient,
  files: Array<{ path: string; content: string }>,
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<PortResponse> {
  return api.postJson<PortResponse>(UVT_PORT_PATH, {
    files,
    target_language: targetLanguage,
    source_language: sourceLanguage,
  } as PortRequest);
}

// ── File I/O helpers ────────────────────────

export function readSource(target: string): Array<{ path: string; content: string }> {
  const cwd = process.cwd();
  const abs = target.startsWith("/") ? target : join(cwd, target);

  if (!existsSync(abs)) throw new Error(`not found: ${target}`);

  const st = statSync(abs);
  if (st.isDirectory()) {
    const entries: Array<{ path: string; content: string }> = [];
    for (const name of readdirSync(abs)) {
      const fp = join(abs, name);
      if (statSync(fp).isFile()) {
        entries.push({ path: name, content: readFileSync(fp, "utf8") });
      }
    }
    if (entries.length === 0) throw new Error(`no files in directory: ${target}`);
    return entries;
  }

  return [{ path: basename(abs), content: readFileSync(abs, "utf8") }];
}

export function writePortedFiles(files: PortedFile[], outputDir: string): string[] {
  const cwd = process.cwd();
  const abs = outputDir.startsWith("/") ? outputDir : join(cwd, outputDir);
  mkdirSync(abs, { recursive: true });
  const written: string[] = [];
  for (const f of files) {
    const fp = join(abs, f.path);
    writeFileSync(fp, f.content, "utf8");
    written.push(fp);
  }
  return written;
}

// Language extension map
export const LANG_EXTS: Record<string, string> = {
  typescript: "ts", python: "py", rust: "rs", go: "go",
  java: "java", kotlin: "kt", swift: "swift", cpp: "cpp",
  c: "c", ruby: "rb", php: "php", zig: "zig",
};

export function langExtension(targetLang: string): string {
  return LANG_EXTS[targetLang.toLowerCase()] ?? targetLang.toLowerCase();
}
