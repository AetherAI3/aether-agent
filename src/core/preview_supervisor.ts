import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commandDigest, isLoopbackUrl, parsePreviewState, PREVIEW_SCHEMA, previewPaths, sanitizePreviewText,
  validatePreviewCommand, type PreviewCommand, type PreviewLaunch, type PreviewState,
} from "./preview_contract.js";
import { terminateProcessTree } from "./process_tree_kill.js";

function writeState(path: string, state: PreviewState): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch { /* Windows ACLs are the authority. */ }
  renameSync(tmp, path);
}

function validLaunch(value: unknown): value is PreviewLaunch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const allowed = new Set(["schema", "instanceId", "projectRoot", "commandDigest", "command", "statePath", "logPath"]);
  if (Object.keys(v).some((key) => !allowed.has(key))) return false;
  return v["schema"] === PREVIEW_SCHEMA && typeof v["instanceId"] === "string" &&
    typeof v["projectRoot"] === "string" && typeof v["commandDigest"] === "string" &&
    typeof v["statePath"] === "string" && typeof v["logPath"] === "string" &&
    isAbsolute(v["statePath"] as string) && isAbsolute(v["logPath"] as string) &&
    typeof v["command"] === "object" && v["command"] !== null;
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function consumeControlRequest(launch: PreviewLaunch, req: IncomingMessage): boolean {
  const requestId = req.headers["x-aether-preview-control"];
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return false;
  const requestPath = join(dirname(launch.statePath), "control.json");
  try {
    const stat = lstatSync(requestPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1_024) return false;
    const value: unknown = JSON.parse(readFileSync(requestPath, "utf8"));
    unlinkSync(requestPath);
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const v = value as Record<string, unknown>;
    return Object.keys(v).length === 5 && v["schema"] === PREVIEW_SCHEMA && v["requestId"] === requestId &&
      v["instanceId"] === launch.instanceId && v["method"] === req.method && v["path"] === req.url;
  } catch {
    return false;
  }
}

async function probe(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 700);
  try {
    await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
    return true;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

export async function runPreviewSupervisor(launchJson: string): Promise<number> {
  let launch: PreviewLaunch;
  try {
    const parsed: unknown = JSON.parse(launchJson);
    if (!validLaunch(parsed)) throw new Error("invalid launch contract");
    const projectRoot = realpathSync(parsed.projectRoot);
    const paths = previewPaths(projectRoot);
    const command = validatePreviewCommand(parsed.command as PreviewCommand, projectRoot);
    if (parsed.projectRoot !== projectRoot || parsed.statePath !== paths.statePath || parsed.logPath !== paths.logPath ||
        parsed.commandDigest !== commandDigest(command)) throw new Error("launch contract confinement or digest mismatch");
    launch = { ...parsed, projectRoot, command };
  } catch { return 2; }

  let child: ChildProcess | null = null;
  let stopping = false;
  let state!: PreviewState;
  const candidates: string[] = [];
  if (launch.command.readyUrl) candidates.push(launch.command.readyUrl);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // The request is authorized by a one-use file created inside the private
    // project state directory. A browser cannot create it, another OS user
    // cannot access that directory, and no reusable bearer credential exists.
    if (!consumeControlRequest(launch, req)) return reply(res, 403, { ok: false });
    if (req.url === "/status" && req.method === "GET") return reply(res, 200, state);
    if (req.url === "/stop" && req.method === "POST") {
      if (!stopping) {
        stopping = true;
        state = { ...state, phase: "stopping" };
        writeState(launch.statePath, state);
        terminateProcessTree(child);
      }
      return reply(res, 202, { ok: true, instanceId: launch.instanceId });
    }
    return reply(res, 404, { ok: false });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") return 2;

  try {
    child = spawn(launch.command.executable, launch.command.args, {
      cwd: launch.command.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: { ...process.env, HOST: "127.0.0.1", AETHER_PREVIEW_HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    state = {
      schema: PREVIEW_SCHEMA, instanceId: launch.instanceId, projectRoot: launch.projectRoot,
      commandDigest: launch.commandDigest, phase: "failed", supervisorPid: process.pid, childPid: 0,
      controlPort: address.port, startedAt: new Date().toISOString(),
      error: sanitizePreviewText(error instanceof Error ? error.message : String(error)).slice(0, 500),
    };
    writeState(launch.statePath, state);
    server.close();
    return 1;
  }

  state = {
    schema: PREVIEW_SCHEMA, instanceId: launch.instanceId, projectRoot: launch.projectRoot,
    commandDigest: launch.commandDigest, phase: "starting", supervisorPid: process.pid, childPid: child.pid ?? 0,
    controlPort: address.port, startedAt: new Date().toISOString(),
  };
  writeState(launch.statePath, state);

  let tail = "";
  let logChars = 0;
  const consume = (chunk: Buffer | string): void => {
    const safe = sanitizePreviewText(String(chunk));
    logChars += safe.length;
    if (logChars > 1_048_576) {
      const prior = readFileSync(launch.logPath, "utf8").slice(-524_288);
      writeFileSync(launch.logPath, (prior + safe).slice(-1_048_576), { encoding: "utf8", mode: 0o600 });
      logChars = Math.min(1_048_576, prior.length + safe.length);
    } else {
      appendFileSync(launch.logPath, safe, { encoding: "utf8", mode: 0o600 });
    }
    tail = (tail + safe).slice(-16_384);
    for (const match of tail.matchAll(/https?:\/\/[^\s"'<>\]\[()]+/g)) {
      const value = match[0].replace(/[.,;:!?]+$/, "");
      if (isLoopbackUrl(value) && !candidates.includes(value)) candidates.unshift(value);
    }
  };
  child.stdout?.on("data", consume);
  child.stderr?.on("data", consume);

  let closed: number | null = null;
  let spawnError = "";
  child.once("error", (error: NodeJS.ErrnoException) => { spawnError = error.code ?? error.message; });
  child.once("close", (code) => { closed = code ?? 1; });
  const cancel = (): void => {
    stopping = true;
    terminateProcessTree(child);
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);

  const deadline = Date.now() + launch.command.timeoutMs;
  let readyUrl: string | undefined;
  while (!stopping && Date.now() < deadline && closed === null) {
    for (const candidate of candidates) {
      if (await probe(candidate)) { readyUrl = candidate; break; }
    }
    if (readyUrl) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (closed === null) break;
      readyUrl = undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!readyUrl) {
    const error = spawnError ? `launch failed: ${spawnError}` : closed !== null
      ? `dev command exited before readiness (exit ${closed})`
      : "timed out waiting for a reachable loopback ready URL";
    state = { ...state, phase: "failed", error };
    writeState(launch.statePath, state);
    terminateProcessTree(child);
    server.close();
    return 1;
  }

  state = { ...state, phase: "ready", url: readyUrl };
  writeState(launch.statePath, state);

  if (closed === null) await new Promise<void>((resolve) => child!.once("close", () => resolve()));
  if (!stopping) {
    state = { ...state, phase: "failed", error: `dev command exited after readiness (exit ${closed ?? 1})` };
    writeState(launch.statePath, state);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
  if (stopping) { try { if (existsSync(launch.statePath) && parsePreviewState(JSON.parse(readFileSync(launch.statePath, "utf8")))?.instanceId === launch.instanceId) unlinkSync(launch.statePath); } catch { /* stale state is safer than deleting an unknown file */ } }
  return stopping ? 0 : 1;
}

const invoked = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] || fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase() : false;
if (invoked) {
  let launchJson = "";
  try { launchJson = readFileSync(0, "utf8"); } catch { /* invalid input fails closed below */ }
  runPreviewSupervisor(launchJson).then((code) => { process.exitCode = code; });
}
