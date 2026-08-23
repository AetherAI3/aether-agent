import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, lstatSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import type { CommandFlags } from "../core/command_dispatch.js";
import { openBrowserChecked } from "../core/browser.js";
import type { OpenOutcome } from "../core/opener.js";
import {
  commandDigest, parsePreviewState, PREVIEW_SCHEMA, previewPaths, sanitizePreviewText,
  validatePreviewCommand, type PreviewCommand, type PreviewLaunch, type PreviewState,
} from "../core/preview_contract.js";
import { terminateProcessTree } from "../core/process_tree_kill.js";

export const PREVIEW_EXIT = { ok: 0, usage: 2, declined: 20, unsafe: 21, notRunning: 22, launchFailed: 23, timeout: 24, controlFailed: 25 } as const;

export interface PreviewOptions {
  command?: string;
  args?: string[];
  readyUrl?: string;
  previewCwd?: string;
  timeoutMs?: string;
  noOpen?: boolean;
  out?: Writable;
  err?: Writable;
  /** Test seam for the existing safe opener; production uses openBrowserChecked. */
  open?: (url: string) => OpenOutcome;
}

interface ProjectPreviewFile {
  version: 1;
  command: string;
  args?: string[];
  cwd?: string;
  readyUrl?: string;
  timeoutMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function writePrivate(path: string, value: string): void {
  writeFileSync(path, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { chmodSync(path, 0o600); } catch { /* Windows ACLs are authoritative. */ }
}

function loadDeclared(projectRoot: string): ProjectPreviewFile {
  const path = join(projectRoot, ".aether", "preview.json");
  if (!existsSync(path)) throw new Error("no preview command was supplied and .aether/preview.json is absent");
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 32_768) throw new Error("refusing unsafe .aether/preview.json");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(".aether/preview.json must be an object");
  const v = value as Record<string, unknown>;
  if (v["version"] !== 1 || typeof v["command"] !== "string" ||
      (v["args"] !== undefined && (!Array.isArray(v["args"]) || !(v["args"] as unknown[]).every((item) => typeof item === "string"))) ||
      (v["cwd"] !== undefined && typeof v["cwd"] !== "string") ||
      (v["readyUrl"] !== undefined && typeof v["readyUrl"] !== "string") ||
      (v["timeoutMs"] !== undefined && !Number.isInteger(v["timeoutMs"]))) {
    throw new Error("invalid .aether/preview.json contract");
  }
  return value as ProjectPreviewFile;
}

export function resolvePreviewCommand(projectRoot: string, options: PreviewOptions): PreviewCommand {
  const explicit = options.command !== undefined;
  const declared = explicit ? undefined : loadDeclared(projectRoot);
  const timeoutRaw = options.timeoutMs === undefined ? declared?.timeoutMs ?? 30_000 : Number(options.timeoutMs);
  return validatePreviewCommand({
    executable: options.command ?? declared!.command,
    args: options.args ?? declared?.args ?? [],
    cwd: options.previewCwd ?? declared?.cwd ?? ".",
    ...(options.readyUrl ?? declared?.readyUrl ? { readyUrl: options.readyUrl ?? declared?.readyUrl } : {}),
    timeoutMs: Number(timeoutRaw),
  }, projectRoot);
}

function readState(path: string): PreviewState | null {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 32_768) throw new Error("refusing unsafe preview state file");
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("preview state is malformed; remove it only after checking no preview is active"); }
  const state = parsePreviewState(raw);
  if (!state) throw new Error("preview state failed schema validation; refusing to trust its PID or control endpoint");
  return state;
}

async function control(state: PreviewState, method: "GET" | "POST", path: "/status" | "/stop"): Promise<PreviewState | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetch(`http://127.0.0.1:${state.controlPort}${path}`, {
      method, headers: { authorization: `Bearer ${state.token}` }, signal: controller.signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (path === "/stop") return state;
    const checked = parsePreviewState(body);
    return checked?.instanceId === state.instanceId && checked.projectRoot === state.projectRoot &&
      checked.commandDigest === state.commandDigest ? checked : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function currentState(projectRoot: string, statePath: string): Promise<{ state: PreviewState | null; stale: boolean }> {
  const state = readState(statePath);
  if (!state) return { state: null, stale: false };
  if (realpathSync(resolve(state.projectRoot)) !== projectRoot) throw new Error("preview state belongs to a different project");
  const live = await control(state, "GET", "/status");
  return live ? { state: live, stale: false } : { state, stale: true };
}

function showOpen(state: PreviewState, noOpen: boolean, out: Writable, err: Writable, opener = openBrowserChecked): number {
  if (!state.url) { err.write("Preview is not ready yet.\n"); return PREVIEW_EXIT.notRunning; }
  out.write(`${state.url}\n`);
  if (noOpen) { out.write("Browser not opened (--no-browser/headless mode).\n"); return PREVIEW_EXIT.ok; }
  const result = opener(state.url);
  if (result.status === "spawned") out.write("Browser launch requested through the system opener.\n");
  else err.write(`Browser was not opened (${sanitizePreviewText(result.detail)}). Use the URL printed above.\n`);
  return result.status === "spawned" || result.status === "unavailable" ? PREVIEW_EXIT.ok : PREVIEW_EXIT.controlFailed;
}

async function approve(ctx: AppContext): Promise<boolean> {
  if (ctx.flags.yes) return true;
  if (!process.stdin.isTTY) return false;
  return ctx.confirm("Start this managed local preview? [y/N] ");
}

export async function cmdPreview(ctx: AppContext, argv: string[], options: PreviewOptions = {}): Promise<number> {
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const sub = argv[0] ?? "status";
  if (!new Set(["start", "open", "logs", "status", "stop"]).has(sub) || argv.length !== 1) {
    err.write("usage: aether preview <start|open|logs|status|stop> [preview flags]\n");
    return PREVIEW_EXIT.usage;
  }
  let projectRoot: string;
  let paths: ReturnType<typeof previewPaths>;
  try {
    projectRoot = realpathSync(resolve(ctx.flags.cwd));
    paths = previewPaths(projectRoot);
  } catch (error) {
    err.write(`${sanitizePreviewText(error instanceof Error ? error.message : String(error))}\n`);
    return PREVIEW_EXIT.unsafe;
  }

  if (sub === "start") {
    let command: PreviewCommand;
    try { command = resolvePreviewCommand(projectRoot, options); }
    catch (error) { err.write(`${sanitizePreviewText(error instanceof Error ? error.message : String(error))}\n`); return PREVIEW_EXIT.unsafe; }
    const digest = commandDigest(command);
    const existing = await currentState(projectRoot, paths.statePath);
    if (existing.state && !existing.stale) {
      if (existing.state.commandDigest !== digest) {
        err.write("A different declared preview is already running; stop it before changing commands.\n");
        return PREVIEW_EXIT.controlFailed;
      }
      out.write(`Attached to declared preview ${existing.state.instanceId}.\n`);
      return existing.state.phase === "ready" ? showOpen(existing.state, options.noOpen ?? false, out, err, options.open) : PREVIEW_EXIT.ok;
    }
    if (existing.stale) {
      err.write("Removed stale preview state after its token-bound supervisor challenge failed; no PID was signalled.\n");
      unlinkSync(paths.statePath);
    }
    err.write(
      `Preview plan\n  argv: ${JSON.stringify([command.executable, ...command.args])}\n  cwd: ${command.cwd}\n` +
      "  filesystem: child runs as your user inside the declared cwd\n" +
      "  process: argv-only launch; Aether owns and stops the full process tree\n" +
      "  network: HOST=127.0.0.1; readiness accepts loopback http(s) URLs only; child may make outbound connections\n" +
      "  environment: inherited from this process\n",
    );
    if (!(await approve(ctx))) {
      err.write("Preview was not started. Pass --yes in a non-interactive session.\n");
      return PREVIEW_EXIT.declined;
    }
    const instanceId = randomUUID();
    const token = randomBytes(32).toString("hex");
    const launchPath = join(paths.dir, `launch-${instanceId}.json`);
    const launch: PreviewLaunch = {
      schema: PREVIEW_SCHEMA, instanceId, token, projectRoot, commandDigest: digest, command,
      statePath: paths.statePath, logPath: paths.logPath,
    };
    try {
      if (existsSync(paths.logPath)) unlinkSync(paths.logPath);
      writePrivate(paths.logPath, "");
      writePrivate(launchPath, JSON.stringify(launch));
      const supervisorPath = fileURLToPath(new URL("../core/preview_supervisor.js", import.meta.url));
      const supervisor = spawn(process.execPath, [supervisorPath, launchPath], {
        cwd: projectRoot, detached: true, windowsHide: true, shell: false, stdio: "ignore",
      });
      supervisor.unref();
      let cancelled = false;
      const cancel = (): void => { cancelled = true; terminateProcessTree(supervisor); };
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      const deadline = Date.now() + command.timeoutMs + 3_000;
      try {
        while (!cancelled && Date.now() < deadline) {
          await sleep(100);
          const state = readState(paths.statePath);
          if (!state || state.instanceId !== instanceId) continue;
          const live = await control(state, "GET", "/status");
          if (live?.phase === "ready") return showOpen(live, options.noOpen ?? false, out, err, options.open);
          if (state.phase === "failed") { err.write(`${state.error ?? "preview launch failed"}\n`); return PREVIEW_EXIT.launchFailed; }
        }
      } finally {
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
      }
      if (cancelled) { err.write("Preview start cancelled; the supervisor process tree was stopped.\n"); return 130; }
      terminateProcessTree(supervisor);
      err.write("Timed out waiting for the preview supervisor; its process tree was stopped.\n");
      return PREVIEW_EXIT.timeout;
    } catch (error) {
      try { if (existsSync(launchPath)) unlinkSync(launchPath); } catch { /* preserve launch error */ }
      err.write(`Preview launch failed: ${sanitizePreviewText(error instanceof Error ? error.message : String(error))}\n`);
      return PREVIEW_EXIT.launchFailed;
    }
  }

  let live: PreviewState | null;
  let stale: boolean;
  try {
    ({ state: live, stale } = await currentState(projectRoot, paths.statePath));
  } catch (error) {
    err.write(`${sanitizePreviewText(error instanceof Error ? error.message : String(error))}\n`);
    return PREVIEW_EXIT.unsafe;
  }
  if (!live) { err.write("No managed preview is recorded for this project.\n"); return PREVIEW_EXIT.notRunning; }
  if (stale) {
    err.write(`Preview state is stale (${live.instanceId}); no process was signalled because ownership could not be proved.\n`);
    return PREVIEW_EXIT.notRunning;
  }
  if (sub === "status") {
    out.write(`${live.phase}  pid=${live.childPid}${live.url ? `  ${live.url}` : ""}\n`);
    return live.phase === "ready" ? PREVIEW_EXIT.ok : PREVIEW_EXIT.notRunning;
  }
  if (sub === "open") return showOpen(live, options.noOpen ?? false, out, err, options.open);
  if (sub === "logs") {
    if (!existsSync(paths.logPath) || lstatSync(paths.logPath).isSymbolicLink()) { err.write("No safe preview log is available.\n"); return PREVIEW_EXIT.notRunning; }
    const size = statSync(paths.logPath).size;
    const body = readFileSync(paths.logPath).subarray(Math.max(0, size - 64 * 1024)).toString("utf8");
    out.write(sanitizePreviewText(body));
    return PREVIEW_EXIT.ok;
  }
  err.write(`Stopping declared preview ${live.instanceId} (pid ${live.childPid}) and its process tree.\n`);
  if (!await control(live, "POST", "/stop")) { err.write("Supervisor ownership challenge failed; no PID was signalled.\n"); return PREVIEW_EXIT.controlFailed; }
  for (let i = 0; i < 50 && existsSync(paths.statePath); i += 1) await sleep(100);
  if (existsSync(paths.statePath)) { err.write("Preview stop was requested, but cleanup was not confirmed.\n"); return PREVIEW_EXIT.controlFailed; }
  out.write("Preview stopped.\n");
  return PREVIEW_EXIT.ok;
}

export function previewOptionsFromFlags(flags: CommandFlags): PreviewOptions {
  return {
    command: flags.str("command"), args: flags.list("arg"), readyUrl: flags.str("ready-url"),
    previewCwd: flags.str("preview-cwd"), timeoutMs: flags.str("preview-timeout-ms"), noOpen: flags.bool("no-open"),
  };
}
