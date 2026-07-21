// UVT /scaffold — strict boilerplate code generation.
// Sends template type + name to backend; backend fills via locked-down LLM prompt.

import type { ApiClient } from "./transport.js";
import { UVT_SCAFFOLD_PATH, defaultStreamTimeoutMs } from "./transport.js";

export type ScaffoldType = "component" | "route" | "module";

export interface ScaffoldRequest {
  type: ScaffoldType;
  name: string;
  language?: string;
}

export interface ScaffoldResponse {
  files: Array<{ path: string; content: string }>;
  template_used: string;
}

export async function generateScaffold(
  api: ApiClient,
  type: ScaffoldType,
  name: string,
  language = "typescript",
): Promise<ScaffoldResponse> {
  // LLM-backed generation, same class as dispatchGeneration (vision.ts) —
  // opt into the 120s stream-class timeout instead of the 30s request default.
  return api.postJson<ScaffoldResponse>(UVT_SCAFFOLD_PATH, {
    type,
    name,
    language,
  } as ScaffoldRequest, undefined, defaultStreamTimeoutMs());
}

// ── Validation ──────────────────────────────

const VALID_TYPES: ScaffoldType[] = ["component", "route", "module"];

export function isValidScaffoldType(t: string): t is ScaffoldType {
  return (VALID_TYPES as string[]).includes(t);
}

export const SCAFFOLD_USAGE = [
  "usage: /scaffold <component|route|module> <name>",
  "  /scaffold component UserCard       React/Vue component",
  "  /scaffold route /api/users         Express/Fastify route",
  "  /scaffold module auth-service      TypeScript module",
].join("\n");
