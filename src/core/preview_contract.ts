import { createHash } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readSync, realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { redactForBundle } from "./redaction.js";

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
  startedAt: string;
  url?: string;
  error?: string;
}

export interface PreviewFileIdentity { dev: bigint; ino: bigint }

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

export function sanitizePreviewText(value: string): string {
  return redactForBundle(value).replace(ANSI, "").replace(CONTROL, "").replace(/\r(?!\n)/g, "\n");
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

export function isOwnerPrivateMode(mode: number, kind: "directory" | "file"): boolean {
  const actual = mode & 0o777;
  return kind === "directory" ? actual === 0o700 : actual === 0o600;
}

/** Open first, then prove the path still names that same regular file. */
export function readStablePreviewFile(path: string, maxBytes: number): { bytes: Buffer; identity: PreviewFileIdentity } {
  const before = lstatSync(path, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile() || before.size > BigInt(maxBytes)) throw new Error("refusing unsafe preview file");
  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  const fd = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(fd, { bigint: true });
    const after = lstatSync(path, { bigint: true });
    if (!opened.isFile() || after.isSymbolicLink() || before.dev !== opened.dev || before.ino !== opened.ino ||
        opened.dev !== after.dev || opened.ino !== after.ino ||
        opened.size > BigInt(maxBytes)) throw new Error("preview file changed while it was being opened");
    const bytes = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) throw new Error("preview file grew beyond its bound while being read");
    return { bytes: bytes.subarray(0, offset), identity: { dev: opened.dev, ino: opened.ino } };
  } finally { closeSync(fd); }
}

export function previewPathStillNames(path: string, identity: PreviewFileIdentity): boolean {
  try {
    const current = lstatSync(path, { bigint: true });
    return !current.isSymbolicLink() && current.isFile() && current.dev === identity.dev && current.ino === identity.ino;
  } catch { return false; }
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
  if (process.platform !== "win32" && !isOwnerPrivateMode(lstatSync(dir).mode, "directory")) {
    throw new Error("preview state directory permissions must be 0700");
  }
  const statePath = join(dir, "state.json");
  const logPath = join(dir, "preview.log");
  for (const path of [statePath, logPath]) {
    if (existsSync(path)) {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("refusing linked or non-file preview state or log path");
      if (process.platform !== "win32" && !isOwnerPrivateMode(stat.mode, "file")) {
        throw new Error("preview state and log file permissions must be 0600");
      }
    }
    if (dirname(path) !== dir) throw new Error("preview artifact escaped its state directory");
  }
  return { dir, statePath, logPath };
}

function wildcardHost(value: string): boolean {
  const normalized = value.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  return /^(?:0\.0\.0\.0|\[?::\]?|\[?0(?::0){7}\]?)(?::\d{1,5})?$/.test(normalized) || normalized === "*" || normalized === "true";
}

function requestsWildcardBind(args: readonly string[]): boolean {
  const hostFlags = new Set(["--host", "--hostname", "--bind", "--listen-host", "--address"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (wildcardHost(arg)) return true;
    const equals = /^(--host|--hostname|--bind|--listen|--listen-host|--address)=(.*)$/i.exec(arg) ?? /^(-H)=(.*)$/.exec(arg);
    if (equals && (wildcardHost(equals[2] ?? "") || equals[2] === "0")) return true;
    const compact = /^-H(.+)$/.exec(arg);
    if (compact && wildcardHost(compact[1] ?? "")) return true;
    if (hostFlags.has(arg.toLowerCase()) || arg === "-H") {
      const next = args[index + 1];
      // Vite and several framework CLIs interpret a bare --host as expose-all.
      if (next === undefined || next.startsWith("-") || wildcardHost(next) || next === "0") return true;
    }
  }
  return false;
}

export function validatePreviewCommand(command: PreviewCommand, projectRoot: string): PreviewCommand {
  if (!command.executable || command.executable.length > 260 || /[\u0000-\u001f\u007f]/.test(command.executable)) {
    throw new Error("preview executable is missing or contains control characters");
  }
  if (command.args.length > 64 || command.args.some((arg) => arg.length > 4096 || /[\u0000\r\n]/.test(arg))) {
    throw new Error("preview arguments exceed their safe bounds or contain controls");
  }
  if (requestsWildcardBind(command.args)) {
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
  const allowed = new Set([
    "schema", "instanceId", "projectRoot", "commandDigest", "phase", "supervisorPid", "childPid",
    "controlPort", "startedAt", "url", "error",
  ]);
  if (Object.keys(v).some((key) => !allowed.has(key))) return null;
  const phase = String(v["phase"]);
  const instanceId = typeof v["instanceId"] === "string" ? v["instanceId"] : "";
  const projectRoot = typeof v["projectRoot"] === "string" ? v["projectRoot"] : "";
  const digest = typeof v["commandDigest"] === "string" ? v["commandDigest"] : "";
  const startedAt = typeof v["startedAt"] === "string" ? v["startedAt"] : "";
  const parsedTime = Date.parse(startedAt);
  if (v["schema"] !== PREVIEW_SCHEMA || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(instanceId) ||
      !projectRoot || projectRoot.length > 4096 || !isAbsolute(projectRoot) || /[\u0000-\u001f\u007f]/.test(projectRoot) ||
      !/^[0-9a-f]{64}$/.test(digest) ||
      !["starting", "ready", "failed", "stopping"].includes(String(v["phase"])) ||
      !Number.isSafeInteger(v["supervisorPid"]) || Number(v["supervisorPid"]) <= 0 ||
      !Number.isSafeInteger(v["childPid"]) || Number(v["childPid"]) < 0 || (phase !== "failed" && Number(v["childPid"]) === 0) ||
      !Number.isInteger(v["controlPort"]) || Number(v["controlPort"]) < 1 || Number(v["controlPort"]) > 65535 ||
      !Number.isFinite(parsedTime) || new Date(parsedTime).toISOString() !== startedAt || parsedTime > Date.now() + 300_000 ||
      (v["error"] !== undefined && (typeof v["error"] !== "string" || v["error"].length > 500 || sanitizePreviewText(v["error"]) !== v["error"]))) return null;
  if (v["url"] !== undefined && (typeof v["url"] !== "string" || !isLoopbackUrl(v["url"]))) return null;
  if (phase === "ready" && v["url"] === undefined) return null;
  if (phase === "starting" && v["url"] !== undefined) return null;
  if (v["error"] !== undefined && phase !== "failed") return null;
  return value as PreviewState;
}
