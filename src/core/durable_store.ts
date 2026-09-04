// src/core/durable_store.ts — crash-safe, cross-process-safe local JSON state.
//
// The repo already writes JSON state with a same-directory `.tmp` plus
// renameSync (config.ts, goals.ts, history_store.ts, mcp_store.ts). That is
// atomic against a torn write but NOT against a lost update: two writers that
// each read generation N and each write N+1 silently drop one side, and a
// crash between "truncate the only copy" and "rename" can leave no valid
// generation at all. This module supplies the missing pieces so any index that
// concurrent Agent turns can touch gets the full transaction:
//
//   lock -> read best valid -> mutate -> validate -> temp write -> flush ->
//   refresh backup -> atomic rename -> readback -> unlock
//
// Nothing here is media-specific; media_history.ts is the first caller.

import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { hostname } from "node:os";

/** Owner stamp written inside the lock file so a stale lock is diagnosable. */
export interface LockOwner {
  pid: number;
  host: string;
  startedAt: string;
  label: string;
}

export interface LockOptions {
  /** Total time to wait for a contended lock before giving up. */
  timeoutMs?: number;
  /** A lock older than this whose owner is provably gone may be stolen. */
  staleMs?: number;
  now?: () => number;
}

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_STALE_MS = 60_000;
const LOCK_POLL_MS = 25;

/**
 * Crash points a test can interrupt a transaction at. Production never sets
 * these; `__setDurableFaults` is the only way in and tests always reset it.
 */
export type FaultPoint =
  | "before-temp-flush"
  | "after-temp-flush"
  | "before-backup"
  | "after-backup"
  | "before-rename"
  | "after-rename";

let faultHook: ((point: FaultPoint) => void) | null = null;

/** Test-only. Throwing from the hook simulates a crash at that point. */
export function __setDurableFaults(hook: ((point: FaultPoint) => void) | null): void {
  faultHook = hook;
}

function fault(point: FaultPoint): void {
  if (faultHook) faultHook(point);
}

function sleepSync(ms: number): void {
  // Synchronous by design: the whole transaction is sync so a crash can never
  // interleave an await between "backup refreshed" and "primary renamed".
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readOwner(path: string): LockOwner | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
    if (typeof parsed.pid !== "number" || typeof parsed.host !== "string") return null;
    return {
      pid: parsed.pid,
      host: parsed.host,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      label: typeof parsed.label === "string" ? parsed.label : "",
    };
  } catch {
    return null;
  }
}

/**
 * True when the lock is provably abandoned: same host and a dead PID, or older
 * than `staleMs` regardless of host. An unparseable owner stamp is only
 * stealable once it is that old — it can then only have come from a crash
 * partway through writing the stamp.
 */
export function isLockStale(
  owner: LockOwner | null,
  ageMs: number,
  staleMs = DEFAULT_LOCK_STALE_MS,
): boolean {
  if (ageMs >= staleMs) return true;
  if (!owner) return false;
  if (owner.host !== hostname()) return false;
  return !processAlive(owner.pid);
}

/**
 * Run `fn` holding an exclusive cross-process lock on `lockPath`. Always
 * releases, including on throw. Throws if the lock cannot be acquired inside
 * the timeout rather than proceeding unsynchronised.
 */
export function withFileLock<T>(
  lockPath: string,
  label: string,
  fn: () => T,
  options: LockOptions = {},
): T {
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
  const staleMs = Math.max(1_000, options.staleMs ?? DEFAULT_LOCK_STALE_MS);
  const clock = options.now ?? ((): number => Date.now());
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });

  const deadline = clock() + timeoutMs;
  let fd: number | null = null;
  for (;;) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let ageMs = 0;
      try {
        ageMs = Math.max(0, clock() - statSync(lockPath).mtimeMs);
      } catch {
        // The holder released between open and stat — retry immediately.
        continue;
      }
      if (isLockStale(readOwner(lockPath), ageMs, staleMs)) {
        try {
          rmSync(lockPath, { force: true });
        } catch {
          // Another waiter won the steal; fall through and retry.
        }
        continue;
      }
      if (clock() >= deadline) {
        const owner = readOwner(lockPath);
        throw new Error(
          `could not lock ${lockPath} within ${timeoutMs}ms` +
            (owner ? ` (held by pid ${owner.pid} on ${owner.host})` : ""),
        );
      }
      sleepSync(LOCK_POLL_MS);
    }
  }

  try {
    const owner: LockOwner = {
      pid: process.pid,
      host: hostname(),
      startedAt: new Date(clock()).toISOString(),
      label,
    };
    writeSync(fd, JSON.stringify(owner));
    return fn();
  } finally {
    try {
      if (fd !== null) closeSync(fd);
    } catch {
      // Descriptor already gone; the unlink below is what matters.
    }
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // A lock left behind is recoverable via isLockStale().
    }
  }
}

function fsyncPath(path: string, flags: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(path, flags);
    fsyncSync(fd);
  } catch {
    // Directory fsync is unsupported on Windows and on some network mounts.
    // The rename is still atomic there; only the ordering guarantee is weaker.
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Nothing recoverable.
      }
    }
  }
}

export interface AtomicWriteOptions {
  /** Keep the current contents here before replacing the primary. */
  backupPath?: string | null;
  mode?: number;
}

let tmpCounter = 0;
const RENAME_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const RENAME_RETRY_WAIT = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

/** Windows can transiently deny an atomic replace while Defender/indexing has
 * just opened the destination. A bounded retry preserves the same-volume
 * rename contract without turning that platform race into a lost generation.
 * Permanent permission failures still surface after at most 75 ms. */
function renameAtomicWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 5 || !RENAME_RETRY_CODES.has(code)) throw error;
      Atomics.wait(RENAME_RETRY_WAIT, 0, 0, 5 * (attempt + 1));
    }
  }
}

function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0 ? path : path.slice(cut + 1);
}

/**
 * Replace `path` with `bytes` atomically, preserving the previous contents as
 * a recoverable backup. The temp file is always a sibling of the target so the
 * rename stays within one volume — a temp on another filesystem turns rename
 * into copy+delete, which is not atomic.
 */
export function atomicWriteFile(
  path: string,
  bytes: string,
  options: AtomicWriteOptions = {},
): void {
  const dir = dirname(path);
  const mode = options.mode ?? 0o600;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  tmpCounter += 1;
  const tmp = join(dir, `.${baseName(path)}.${process.pid}.${tmpCounter}.tmp`);

  let fd: number | null = null;
  try {
    fd = openSync(tmp, "wx", mode);
    writeSync(fd, bytes);
    fault("before-temp-flush");
    fsyncSync(fd);
    fault("after-temp-flush");
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // A close failure surfaces as a readback mismatch in the caller.
      }
    }
  }

  try {
    if (options.backupPath && existsSync(path)) {
      fault("before-backup");
      // Stage the backup too: copying straight onto the backup path would, if
      // interrupted, destroy the last known good copy while the primary is
      // still the generation we are about to replace.
      const backupTmp = options.backupPath + ".tmp";
      copyFileSync(path, backupTmp);
      fsyncPath(backupTmp, "r+");
      renameAtomicWithRetry(backupTmp, options.backupPath);
      fault("after-backup");
    }
    fault("before-rename");
    renameAtomicWithRetry(tmp, path);
    fault("after-rename");
    fsyncPath(dir, "r");
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Leaving our own temp behind is cleaned by `doctor --fix`.
    }
    throw err;
  }
}

export type JsonReadFailure = "missing" | "unreadable" | "corrupt";

export type JsonReadResult<T> =
  | { ok: true; value: T; raw: string }
  | { ok: false; reason: JsonReadFailure; detail: string };

/**
 * Read and parse a JSON document, distinguishing "not there yet" from "there
 * but broken" so callers never render a corrupt file as an empty one.
 */
export function readJsonFile<T>(path: string): JsonReadResult<T> {
  if (!existsSync(path)) return { ok: false, reason: "missing", detail: "file does not exist" };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { ok: false, reason: "unreadable", detail: "file cannot be read" };
  }
  if (!raw.trim()) return { ok: false, reason: "corrupt", detail: "file is empty" };
  try {
    return { ok: true, value: JSON.parse(raw) as T, raw };
  } catch {
    return { ok: false, reason: "corrupt", detail: "file is not valid JSON" };
  }
}

/**
 * Move an unusable file aside as `<path>.corrupt.<stamp>` so the evidence
 * survives the repair. Returns the preserved path, or null when there was
 * nothing to preserve.
 */
export function preserveCorrupt(path: string, now = new Date().toISOString()): string | null {
  if (!existsSync(path)) return null;
  const preserved = `${path}.corrupt.${now.replace(/[:.]/g, "-")}`;
  try {
    copyFileSync(path, preserved);
    return preserved;
  } catch {
    return null;
  }
}
