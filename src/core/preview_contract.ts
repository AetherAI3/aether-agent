import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const PREVIEW_SCHEMA = "aether.preview/1" as const;

export interface PreviewCommand {
  executable: string;
  args: string[];
  cwd: string;
  readyUrl?: string;
  timeoutMs: number;
}

export interface PreviewLaunch {
  schema: typeof PREVIEW_SCHEMA;
  instanceId: string;
  token: string;
  projectRoot: string;
  commandDigest: string;
  command: PreviewCommand;
  statePath: string;
  logPath: string;
}

export interface PreviewState {
  schema: typeof PREVIEW_SCHEMA;
  instanceId: string;
  projectRoot: string;
  commandDigest: string;
  phase: "starting" | "ready" | "failed" | "stopping";
  supervisorPid: number;
  childPid: number;
  controlPort: number;
  token: string;
  startedAt: string;
  url?: string;
  error?: string;
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

export function sanitizePreviewText(value: string): string {
  return value.replace(ANSI, "").replace(CONTROL, "").replace(/\r(?!\n)/g, "\n");
}

export function isLoopbackUrl(raw: string): boolean {
  if (!raw || /[\x00-\x20\x7f]/.test(raw)) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

export function commandDigest(command: PreviewCommand): string {
  return createHash("sha256").update(JSON.stringify({
    executable: command.executable,
    args: command.args,
    cwd: command.cwd,
    readyUrl: command.readyUrl ?? null,
    timeoutMs: command.timeoutMs,
  })).digest("hex");
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** Resolve an existing directory without following a path outside the real project root. */
export function resolvePreviewCwd(projectRoot: string, requested = "."): string {
  const root = realpathSync(resolve(projectRoot));
  const candidate = resolve(root, requested);
  if (!inside(root, candidate) || !existsSync(candidate)) throw new Error("preview cwd must be an existing directory inside the project");
  const real = realpathSync(candidate);
  if (!inside(root, real) || !lstatSync(real).isDirectory()) throw new Error("preview cwd escapes the project through a link");
  return real;
}

/** Create the private state directory while refusing planted links/junctions. */
export function previewPaths(projectRoot: string): { dir: string; statePath: string; logPath: string } {
  const root = realpathSync(resolve(projectRoot));
  const aether = join(root, ".aether");
  const dir = join(aether, "preview");
  for (const path of [aether, dir]) {
    if (existsSync(path)) {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isDirectory() || !inside(root, realpathSync(path))) {
        throw new Error("refusing preview state through a symlink, junction, or non-directory path");
      }
    } else {
      mkdirSync(path, { mode: 0o700 });
    }
  }
  const statePath = join(dir, "state.json");
  const logPath = join(dir, "preview.log");
  for (const path of [statePath, logPath]) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("refusing linked preview state or log file");
    if (dirname(path) !== dir) throw new Error("preview artifact escaped its state directory");
  }
  return { dir, statePath, logPath };
}

export function validatePreviewCommand(command: PreviewCommand, projectRoot: string): PreviewCommand {
  if (!command.executable || command.executable.length > 260 || /[\u0000-\u001f\u007f]/.test(command.executable)) {
    throw new Error("preview executable is missing or contains control characters");
  }
  if (command.args.length > 64 || command.args.some((arg) => arg.length > 4096 || /[\u0000\r\n]/.test(arg))) {
    throw new Error("preview arguments exceed their safe bounds or contain controls");
  }
  if (command.args.some((arg) => /^(?:0\.0\.0\.0|::|\[::\]|--host=(?:0\.0\.0\.0|::|\[::\]))$/i.test(arg))) {
    throw new Error("preview arguments may not request a wildcard network bind; use 127.0.0.1 or localhost");
  }
  const cwd = resolvePreviewCwd(projectRoot, command.cwd);
  if (command.readyUrl !== undefined && !isLoopbackUrl(command.readyUrl)) {
    throw new Error("preview ready URL must be an http(s) loopback URL without credentials or controls");
  }
  if (!Number.isInteger(command.timeoutMs) || command.timeoutMs < 1_000 || command.timeoutMs > 120_000) {
    throw new Error("preview timeout must be between 1000 and 120000 milliseconds");
  }
  return { ...command, cwd };
}

export function parsePreviewState(value: unknown): PreviewState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v["schema"] !== PREVIEW_SCHEMA || typeof v["instanceId"] !== "string" ||
      typeof v["projectRoot"] !== "string" || typeof v["commandDigest"] !== "string" ||
      !["starting", "ready", "failed", "stopping"].includes(String(v["phase"])) ||
      !Number.isInteger(v["supervisorPid"]) || !Number.isInteger(v["childPid"]) ||
      !Number.isInteger(v["controlPort"]) || typeof v["token"] !== "string" ||
      typeof v["startedAt"] !== "string") return null;
  if (v["url"] !== undefined && (typeof v["url"] !== "string" || !isLoopbackUrl(v["url"]))) return null;
  return value as PreviewState;
}
