// src/core/opener.ts — the one way this CLI hands a URL or a file to the OS.
//
// Two older call sites each built a shell string: browser.ts spawned
// `cmd /c start "" <url>` on Windows (url parsed as a cmd token) and
// vision.ts ran execSync(`${cmd} "${filepath}"`) — a filename containing a
// quote, `&`, or a backtick was a command-injection primitive on every
// platform. Everything here uses an executable plus an argument array with no
// shell, so the target is never re-parsed.
//
// Targets are validated before launch: URLs must be http/https, files must
// exist and be a regular file or a directory. Paths are resolved to absolute
// first, which also removes the leading-dash case (`-rf.png` would otherwise
// reach `xdg-open` as a flag).

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type OpenStatus = "spawned" | "rejected" | "unavailable" | "spawn-error";

export interface OpenOutcome {
  status: OpenStatus;
  /** Present when the target passed validation and a command was selected. */
  executable?: string;
  args?: readonly string[];
  detail: string;
}

export interface OpenCommand {
  executable: string;
  args: readonly string[];
}

export interface OpenOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Injected in tests so no real process is launched. */
  spawnFn?: typeof spawn;
}

const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

/** True when `raw` is a URL this CLI is willing to hand to a browser. */
export function isAllowedUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) return false;
  // Embedded credentials would be handed to the browser and land in history.
  return !parsed.username && !parsed.password;
}

/**
 * True when `raw` is shaped like an absolute URL. The scheme-plus-slashes test
 * matters on Windows: `new URL("C:\\out\\x.png")` parses happily with protocol
 * "c:", so a bare drive path would otherwise be classified as a URL.
 */
export function looksLikeUrl(raw: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
}

/**
 * The executable and argument array for `target` on `platform`. Split out from
 * openTarget so every platform's choice is unit-testable without spawning.
 */
export function resolveOpenCommand(target: string, platform: NodeJS.Platform): OpenCommand {
  if (platform === "win32") {
    // explorer.exe routes both URLs and file paths to their default handler.
    // It exits non-zero on success, which is why openTarget never waits on it.
    return { executable: "explorer.exe", args: [target] };
  }
  if (platform === "darwin") return { executable: "open", args: [target] };
  return { executable: "xdg-open", args: [target] };
}

function headlessReason(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  if (platform !== "linux") return null;
  if (env["DISPLAY"] || env["WAYLAND_DISPLAY"]) return null;
  return "no DISPLAY or WAYLAND_DISPLAY; this session has no desktop to open into";
}

/**
 * Validate `target` and describe how it would be opened, without launching
 * anything. `doctor` uses this to report opener configuration in read-only
 * mode, and openTarget uses it as its own precondition.
 */
export function planOpen(target: string, options: OpenOptions = {}): OpenOutcome {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (!target || !target.trim()) {
    return { status: "rejected", detail: "empty target" };
  }

  let launchTarget = target;
  if (looksLikeUrl(target)) {
    if (!isAllowedUrl(target)) {
      return {
        status: "rejected",
        detail: "only http and https URLs without embedded credentials can be opened",
      };
    }
  } else {
    const absolute = isAbsolute(target) ? target : resolve(target);
    if (!existsSync(absolute)) {
      return { status: "rejected", detail: "local target does not exist" };
    }
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      return { status: "rejected", detail: "local target cannot be inspected" };
    }
    if (!stat.isFile() && !stat.isDirectory()) {
      return { status: "rejected", detail: "local target is not a regular file or directory" };
    }
    launchTarget = absolute;
  }

  const headless = headlessReason(platform, env);
  if (headless) return { status: "unavailable", detail: headless };

  const command = resolveOpenCommand(launchTarget, platform);
  return {
    status: "spawned",
    executable: command.executable,
    args: command.args,
    detail: "ready to open",
  };
}

/**
 * Open `target` in the OS default handler. Never throws: callers always have a
 * fallback (print the URL, print the path). Returns as soon as the child is
 * detached — the opener outliving this process is the point, so a later
 * non-zero exit is not this function's result.
 */
export function openTarget(target: string, options: OpenOptions = {}): OpenOutcome {
  const plan = planOpen(target, options);
  if (plan.status !== "spawned") return plan;

  const launcher = options.spawnFn ?? spawn;
  try {
    const child = launcher(plan.executable!, [...plan.args!], {
      stdio: "ignore",
      detached: true,
      shell: false,
    });
    // ENOENT (no xdg-open on a minimal container) arrives asynchronously.
    child.on("error", () => {});
    child.unref();
    return plan;
  } catch (err) {
    return {
      status: "spawn-error",
      executable: plan.executable,
      args: plan.args,
      detail: err instanceof Error ? err.message : "opener could not be launched",
    };
  }
}
