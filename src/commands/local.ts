import { spawnSync } from "node:child_process";
import type { AppContext } from "../core/context.js";
import { saveConfig } from "../core/config.js";
import { normalizeOllamaHost } from "../core/ollama.js";
import { localModelId, normalizeOllamaTag, resolveLocalModel } from "../core/local_ollama.js";

export const LOCAL_EXIT = {
  ok: 0,
  declined: 3,
  usage: 2,
  binaryAbsent: 10,
  serverDown: 11,
  emptyModels: 12,
  selectedMissing: 13,
  timeout: 14,
  malformedResponse: 15,
  operationFailed: 16,
} as const;

export interface LocalProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
  timedOut?: boolean;
}

export interface LocalRuntimeDeps {
  run(command: string, args: readonly string[], timeoutMs: number): LocalProcessResult;
  requestTags(host: string, timeoutMs: number): Promise<unknown>;
  save(ctx: AppContext): void;
}

interface LocalSnapshot {
  host: string;
  binary: { present: boolean; version: string; timedOut: boolean };
  server: "up" | "down" | "timeout" | "malformed";
  models: string[];
  selectedTag: string;
  selectedId: string;
  selectedPresent: boolean;
  configuredBackend: string;
  hostedAuth: "signed-in" | "signed-out";
}

const PROBE_TIMEOUT_MS = 5_000;
const PULL_TIMEOUT_MS = 30 * 60_000;

class MalformedOllamaResponseError extends Error {
  override readonly name = "MalformedOllamaResponseError";
}

function cleanLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
}

const productionDeps: LocalRuntimeDeps = {
  run(command, args, timeoutMs) {
    const result = spawnSync(command, [...args], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    const code = result.error && "code" in result.error ? String(result.error.code) : undefined;
    return {
      status: result.status,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      ...(code ? { errorCode: code } : {}),
      ...(code === "ETIMEDOUT" ? { timedOut: true } : {}),
    };
  },
  async requestTags(host, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${host}/api/tags`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      try {
        return await response.json() as unknown;
      } catch {
        throw new MalformedOllamaResponseError("Ollama returned a non-JSON /api/tags response");
      }
    } finally {
      clearTimeout(timer);
    }
  },
  save(ctx) {
    saveConfig(ctx.cfg);
  },
};

function tagsFromResponse(value: unknown): string[] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const models = (value as Record<string, unknown>)["models"];
  if (!Array.isArray(models)) return null;
  const tags: string[] = [];
  for (const item of models) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const name = (item as Record<string, unknown>)["name"];
    if (typeof name !== "string") return null;
    try {
      tags.push(normalizeOllamaTag(name));
    } catch {
      return null;
    }
  }
  return [...new Set(tags)].sort();
}

async function snapshot(ctx: AppContext, deps: LocalRuntimeDeps): Promise<LocalSnapshot | { code: number; message: string }> {
  let host: string;
  try {
    host = normalizeOllamaHost(process.env["OLLAMA_HOST"]);
  } catch (error) {
    return { code: LOCAL_EXIT.malformedResponse, message: error instanceof Error ? error.message : String(error) };
  }

  const binaryResult = deps.run("ollama", ["--version"], PROBE_TIMEOUT_MS);
  const binary = {
    present: binaryResult.status === 0,
    version: binaryResult.status === 0 ? cleanLine(binaryResult.stdout || binaryResult.stderr) || "present" : "not found",
    timedOut: binaryResult.timedOut === true,
  };
  const selectedTag = resolveLocalModel(undefined, ctx.cfg.localModel ?? "");
  const common = {
    host,
    binary,
    selectedTag,
    selectedId: localModelId(selectedTag),
    configuredBackend: cleanLine(process.env["AETHER_BACKEND"] || ctx.cfg.backend || "auto") || "auto",
    hostedAuth: Boolean(await ctx.tokens.get()) ? "signed-in" as const : "signed-out" as const,
  };

  let raw: unknown;
  try {
    raw = await deps.requestTags(host, PROBE_TIMEOUT_MS);
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || /timed?\s*out/i.test(error.message));
    return {
      ...common,
      server: error instanceof MalformedOllamaResponseError ? "malformed" : timedOut ? "timeout" : "down",
      models: [],
      selectedPresent: false,
    };
  }
  const models = tagsFromResponse(raw);
  if (models === null) return { ...common, server: "malformed", models: [], selectedPresent: false };
  return { ...common, server: "up", models, selectedPresent: models.includes(selectedTag) };
}

function snapshotExit(state: LocalSnapshot): number {
  if (state.binary.timedOut) return LOCAL_EXIT.timeout;
  if (!state.binary.present) return LOCAL_EXIT.binaryAbsent;
  if (state.server === "timeout") return LOCAL_EXIT.timeout;
  if (state.server === "down") return LOCAL_EXIT.serverDown;
  if (state.server === "malformed") return LOCAL_EXIT.malformedResponse;
  if (state.models.length === 0) return LOCAL_EXIT.emptyModels;
  if (!state.selectedPresent) return LOCAL_EXIT.selectedMissing;
  return LOCAL_EXIT.ok;
}

function runtimeFailure(state: LocalSnapshot, requireBinary: boolean): number | null {
  if (state.binary.timedOut) {
    process.stderr.write("The Ollama binary check timed out; inspect the local installation and retry.\n");
    return LOCAL_EXIT.timeout;
  }
  if (requireBinary && !state.binary.present) {
    process.stderr.write("Ollama binary not found on PATH. Install Ollama and retry.\n");
    return LOCAL_EXIT.binaryAbsent;
  }
  if (state.server === "timeout") {
    process.stderr.write("Ollama did not answer in 5s; check OLLAMA_HOST and the server.\n");
    return LOCAL_EXIT.timeout;
  }
  if (state.server === "down") {
    process.stderr.write("Ollama server is down. Start it separately, then retry.\n");
    return LOCAL_EXIT.serverDown;
  }
  if (state.server === "malformed") {
    process.stderr.write("Ollama returned malformed model metadata; upgrade or restart Ollama.\n");
    return LOCAL_EXIT.malformedResponse;
  }
  return null;
}

async function approveMutation(ctx: AppContext, prompt: string): Promise<boolean> {
  if (ctx.flags.yes) return true;
  if (!process.stdin.isTTY) {
    process.stderr.write("This mutation requires --yes in a non-interactive session.\n");
    return false;
  }
  return ctx.confirm(prompt);
}

function writeSnapshot(ctx: AppContext, state: LocalSnapshot): void {
  const code = snapshotExit(state);
  if (ctx.flags.json) {
    process.stdout.write(JSON.stringify({ schema: "aether/local-doctor@1", ok: code === 0, exitCode: code, ...state }, null, 2) + "\n");
    return;
  }
  process.stdout.write(
    `Local Ollama\n` +
      `  host             ${state.host}\n` +
      `  binary           ${state.binary.present ? state.binary.version : "not found on PATH"}\n` +
      `  server           ${state.server}\n` +
      `  installed models ${state.models.length}\n` +
      `  selected model   ${state.selectedId}${state.selectedPresent ? "" : " (not installed)"}\n` +
      `  backend setting  ${state.configuredBackend} (unchanged)\n` +
      `  hosted auth      ${state.hostedAuth}\n`,
  );
  if (state.binary.timedOut) process.stderr.write("The Ollama binary check timed out; inspect the local installation and retry.\n");
  else if (!state.binary.present) process.stderr.write("Install Ollama, then run: aether local doctor\n");
  else if (state.server === "down") process.stderr.write("Start Ollama separately, then run: aether local doctor\n");
  else if (state.server === "timeout") process.stderr.write("Ollama did not answer in 5s; check OLLAMA_HOST and the server.\n");
  else if (state.server === "malformed") process.stderr.write("Ollama returned malformed model metadata; upgrade or restart Ollama.\n");
  else if (state.models.length === 0) process.stderr.write("No local models are installed. Run: aether local pull <model> --yes\n");
  else if (!state.selectedPresent) process.stderr.write(`Selected model is missing. Run: aether local pull ${state.selectedTag} --yes\n`);
}

async function diagnose(ctx: AppContext, deps: LocalRuntimeDeps): Promise<{ code: number; state?: LocalSnapshot }> {
  const result = await snapshot(ctx, deps);
  if ("message" in result) {
    process.stderr.write(result.message + "\n");
    return { code: result.code };
  }
  writeSnapshot(ctx, result);
  return { code: snapshotExit(result), state: result };
}

export async function cmdSetup(ctx: AppContext, _argv: string[], _flags: unknown, deps: LocalRuntimeDeps = productionDeps): Promise<number> {
  if (!ctx.flags.local) {
    process.stderr.write("usage: aether setup --local\nThis bounded setup path diagnoses local Ollama only; it does not switch backends.\n");
    return LOCAL_EXIT.usage;
  }
  const result = await diagnose(ctx, deps);
  if (result.code === 0) process.stdout.write("Ready. Start explicitly with: aether agent --local <task>\n");
  return result.code;
}

export async function cmdLocal(ctx: AppContext, argv: string[], _flags: unknown, deps: LocalRuntimeDeps = productionDeps): Promise<number> {
  const sub = argv[0] ?? "doctor";
  if (sub === "doctor") return (await diagnose(ctx, deps)).code;

  if (sub === "models") {
    const result = await snapshot(ctx, deps);
    if ("message" in result) {
      process.stderr.write(result.message + "\n");
      return result.code;
    }
    const failure = runtimeFailure(result, false);
    if (failure !== null) return failure;
    if (result.models.length === 0) {
      process.stderr.write("No local models are installed. Run: aether local pull <model> --yes\n");
      return LOCAL_EXIT.emptyModels;
    }
    if (ctx.flags.json) process.stdout.write(JSON.stringify(result.models.map(localModelId), null, 2) + "\n");
    else for (const tag of result.models) process.stdout.write(`${tag === result.selectedTag ? "*" : " "} ${localModelId(tag)}\n`);
    return LOCAL_EXIT.ok;
  }

  if (sub === "use") {
    const raw = argv[1];
    if (!raw || argv.length !== 2) {
      process.stderr.write("usage: aether local use <model>\n");
      return LOCAL_EXIT.usage;
    }
    let tag: string;
    try {
      tag = raw.startsWith("ollama:") ? normalizeOllamaTag(raw.slice("ollama:".length)) : normalizeOllamaTag(raw);
    } catch (error) {
      process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
      return LOCAL_EXIT.usage;
    }
    const result = await snapshot(ctx, deps);
    if ("message" in result) {
      process.stderr.write(result.message + "\n");
      return result.code;
    }
    const failure = runtimeFailure(result, false);
    if (failure !== null) return failure;
    if (result.models.length === 0) {
      process.stderr.write(`No local models are installed. Run: aether local pull ${tag} --yes\n`);
      return LOCAL_EXIT.emptyModels;
    }
    if (!result.models.includes(tag)) {
      process.stderr.write(`Model ${localModelId(tag)} is not installed. Run: aether local pull ${tag} --yes\n`);
      return LOCAL_EXIT.selectedMissing;
    }
    const id = localModelId(tag);
    const hostedDefault = cleanLine(ctx.cfg.defaultModel) || "automatic";
    const backend = cleanLine(ctx.cfg.backend) || "auto";
    process.stderr.write(`Plan\n  write localModel = ${id}\n  hosted defaultModel remains ${hostedDefault}\n  backend setting remains ${backend}\n`);
    if (!(await approveMutation(ctx, "Apply this local model selection? [y/N] "))) {
      process.stderr.write("No changes made.\n");
      return LOCAL_EXIT.declined;
    }
    ctx.cfg.localModel = id;
    deps.save(ctx);
    process.stdout.write(`local model → ${id}\nBackend was not changed. Use --local when you want Ollama.\n`);
    return LOCAL_EXIT.ok;
  }

  if (sub === "pull") {
    const raw = argv[1];
    if (!raw || argv.length !== 2) {
      process.stderr.write("usage: aether local pull <model> [--yes]\n");
      return LOCAL_EXIT.usage;
    }
    let tag: string;
    try {
      tag = raw.startsWith("ollama:") ? normalizeOllamaTag(raw.slice("ollama:".length)) : normalizeOllamaTag(raw);
    } catch (error) {
      process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
      return LOCAL_EXIT.usage;
    }
    process.stderr.write(`Plan\n  run: ollama pull ${tag}\n  may download model data; config and backend remain unchanged\n`);
    if (!(await approveMutation(ctx, "Run this pull? [y/N] "))) {
      process.stderr.write("No changes made.\n");
      return LOCAL_EXIT.declined;
    }
    const binary = deps.run("ollama", ["--version"], PROBE_TIMEOUT_MS);
    if (binary.status !== 0) {
      process.stderr.write("Ollama binary not found on PATH. Install Ollama and retry.\n");
      return LOCAL_EXIT.binaryAbsent;
    }
    const pulled = deps.run("ollama", ["pull", tag], PULL_TIMEOUT_MS);
    if (pulled.timedOut) {
      process.stderr.write("Ollama pull timed out after 30 minutes; retry when the connection is stable.\n");
      return LOCAL_EXIT.timeout;
    }
    if (pulled.status !== 0) {
      process.stderr.write(`Ollama pull failed${cleanLine(pulled.stderr) ? `: ${cleanLine(pulled.stderr)}` : "."}\n`);
      return LOCAL_EXIT.operationFailed;
    }
    process.stdout.write(`pulled ${localModelId(tag)}\nSelection and backend were not changed.\n`);
    return LOCAL_EXIT.ok;
  }

  process.stderr.write("usage: aether local <doctor|models|use <model>|pull <model>>\n");
  return LOCAL_EXIT.usage;
}
