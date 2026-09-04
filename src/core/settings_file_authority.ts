// Shared filesystem authority for settings-owned files.
//
// Every cooperating writer for a target uses the same adjacent lock. Reads are
// bounded and keep an opened regular file tied to the path that was inspected,
// so symlink swaps and unbounded growth fail closed.

import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { dirname, resolve } from "node:path";

export type BoundedRegularFileRead =
  | { readonly status: "missing" }
  | { readonly status: "ok"; readonly bytes: string }
  | { readonly status: "unsafe" | "unreadable" | "oversize"; readonly detail: string };

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Read at most maxBytes from the exact non-symlink regular file at path. */
export function readBoundedRegularFile(path: string, maxBytes: number): BoundedRegularFileRead {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("bounded file limit must be a positive safe integer");
  }
  const target = resolve(path);
  let before: Stats;
  try {
    before = lstatSync(target);
  } catch (error) {
    if (errno(error) === "ENOENT") return { status: "missing" };
    return { status: "unreadable", detail: "file metadata cannot be read" };
  }
  if (before.isSymbolicLink()) {
    return { status: "unsafe", detail: "symbolic links are not accepted" };
  }
  if (!before.isFile()) {
    return { status: "unreadable", detail: "path is not a regular file" };
  }
  if (before.size > maxBytes) {
    return { status: "oversize", detail: "file exceeds the bounded input limit" };
  }

  const noFollow = constants.O_NOFOLLOW ?? 0;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(target, constants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) {
      return { status: "unreadable", detail: "opened path is not a regular file" };
    }
    if (opened.size > maxBytes) {
      return { status: "oversize", detail: "file exceeds the bounded input limit" };
    }

    const attached = lstatSync(target);
    if (attached.isSymbolicLink() || !attached.isFile() || !sameFile(before, opened) || !sameFile(opened, attached)) {
      return { status: "unsafe", detail: "file identity changed during inspection" };
    }

    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > maxBytes) {
      return { status: "oversize", detail: "file exceeds the bounded input limit" };
    }

    const after = fstatSync(descriptor);
    const stillAttached = lstatSync(target);
    if (
      stillAttached.isSymbolicLink()
      || !stillAttached.isFile()
      || !sameFile(opened, after)
      || !sameFile(after, stillAttached)
    ) {
      return { status: "unsafe", detail: "file identity changed during inspection" };
    }
    if (after.size > maxBytes) {
      return { status: "oversize", detail: "file exceeds the bounded input limit" };
    }
    if (
      opened.size !== after.size
      || opened.mtimeMs !== after.mtimeMs
      || opened.ctimeMs !== after.ctimeMs
      || length !== after.size
    ) {
      return { status: "unreadable", detail: "file changed while it was being read" };
    }
    try {
      return {
        status: "ok",
        bytes: new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)),
      };
    } catch {
      return { status: "unreadable", detail: "file is not valid UTF-8" };
    }
  } catch (error) {
    if (errno(error) === "ENOENT") return { status: "missing" };
    if (errno(error) === "ELOOP") {
      return { status: "unsafe", detail: "symbolic links are not accepted" };
    }
    return { status: "unreadable", detail: "file cannot be read safely" };
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* read result remains fail-closed */ }
    }
  }
}

export function settingsFileLockPath(path: string): string {
  return `${resolve(path)}.aether-settings.lock`;
}

export class SettingsFileBusyError extends Error {
  readonly path: string;

  constructor(path: string) {
    super("settings file is locked by another apply or rollback; retry after it finishes");
    this.name = "SettingsFileBusyError";
    this.path = path;
  }
}

/** Serialize all cooperating apply/rollback CAS sections across processes. */
export function withSettingsFileLock<T>(path: string, work: () => T): T {
  const lockPath = settingsFileLockPath(path);
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  let descriptor: number | undefined;
  let lockIdentity: Stats | undefined;
  let created = false;
  try {
    descriptor = openSync(
      lockPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    created = true;
    lockIdentity = fstatSync(descriptor);
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid })}\n`, { encoding: "utf8" });
    fsyncSync(descriptor);
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* preserve acquisition failure */ }
      descriptor = undefined;
    }
    if (created && lockIdentity) {
      try {
        const current = lstatSync(lockPath);
        if (!current.isSymbolicLink() && sameFile(lockIdentity, current)) unlinkSync(lockPath);
      } catch {
        // A leftover acquisition marker is safer than deleting an unproven path.
      }
    }
    if (errno(error) === "EEXIST" || errno(error) === "ELOOP") {
      throw new SettingsFileBusyError(lockPath);
    }
    throw error;
  }

  try {
    return work();
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* cleanup below remains best effort */ }
    }
    try {
      const current = lstatSync(lockPath);
      if (lockIdentity && !current.isSymbolicLink() && sameFile(lockIdentity, current)) {
        unlinkSync(lockPath);
      }
    } catch {
      // Never turn a completed mutation into an apparent apply failure. A
      // leftover lock fails subsequent writers closed and can be inspected.
    }
  }
}
