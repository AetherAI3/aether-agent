import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isAllowedUrl,
  looksLikeUrl,
  openTarget,
  planOpen,
  resolveOpenCommand,
} from "../src/core/opener.js";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "aether-opener-"));
}

/** A spawn stand-in that records the call instead of launching anything. */
function recorder(): {
  calls: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }>;
  fn: (file: string, args: readonly string[], options: Record<string, unknown>) => unknown;
} {
  const calls: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }> = [];
  return {
    calls,
    fn: (file, args, options) => {
      calls.push({ file, args, options });
      return { on: (): void => {}, unref: (): void => {} };
    },
  };
}

const DESKTOP_ENV = { DISPLAY: ":0" } as NodeJS.ProcessEnv;

test("each platform gets an executable plus an argument array, never a shell string", () => {
  assert.deepEqual(resolveOpenCommand("/tmp/a.png", "darwin"), {
    executable: "open",
    args: ["/tmp/a.png"],
  });
  assert.deepEqual(resolveOpenCommand("/tmp/a.png", "linux"), {
    executable: "xdg-open",
    args: ["/tmp/a.png"],
  });
  // Never `cmd /c start "" <target>` — the old browser.ts path handed the
  // target to the command interpreter as a token.
  assert.deepEqual(resolveOpenCommand("C:\\out\\a.png", "win32"), {
    executable: "explorer.exe",
    args: ["C:\\out\\a.png"],
  });
  // URLs also unchanged on darwin/linux — `open`/`xdg-open` already route a
  // URL to the default browser, no separate launcher needed.
  assert.deepEqual(resolveOpenCommand("https://example.invalid/x", "darwin", true), {
    executable: "open",
    args: ["https://example.invalid/x"],
  });
  assert.deepEqual(resolveOpenCommand("https://example.invalid/x", "linux", true), {
    executable: "xdg-open",
    args: ["https://example.invalid/x"],
  });
});

test("a win32 URL is routed to rundll32's FileProtocolHandler, not explorer.exe", () => {
  // explorer.exe opens a File Explorer window for a URL instead of the
  // default browser — this is the bug: `aether auth login` never opened the
  // device-approval page. rundll32 url.dll,FileProtocolHandler is the
  // no-shell equivalent of ShellExecute on a URL: two argv elements, the URL
  // never re-interpreted by cmd.exe or PowerShell string interpolation.
  assert.deepEqual(resolveOpenCommand("https://aethersystems.net/platform/device", "win32", true), {
    executable: "rundll32.exe",
    args: ["url.dll,FileProtocolHandler", "https://aethersystems.net/platform/device"],
  });
});

test("a win32 file path still goes through explorer.exe, unaffected by the URL fix", () => {
  assert.deepEqual(resolveOpenCommand("C:\\out\\a.png", "win32", false), {
    executable: "explorer.exe",
    args: ["C:\\out\\a.png"],
  });
  // Default (omitted) isUrl argument behaves like a file path too.
  assert.deepEqual(resolveOpenCommand("C:\\out\\a.png", "win32"), {
    executable: "explorer.exe",
    args: ["C:\\out\\a.png"],
  });
});

test("only http and https URLs without embedded credentials are openable", () => {
  assert.equal(isAllowedUrl("https://example.invalid/a.png"), true);
  assert.equal(isAllowedUrl("http://127.0.0.1:8080/a.png"), true);
  assert.equal(isAllowedUrl("file:///etc/passwd"), false);
  assert.equal(isAllowedUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedUrl("data:text/html,<script>"), false);
  assert.equal(isAllowedUrl("https://user:pass@example.invalid/a"), false);
  assert.equal(isAllowedUrl("not a url"), false);
  // Scheme-less input never reaches the URL branch's launcher path either.
  assert.equal(isAllowedUrl("example.invalid/a"), false);
});

test("a URL with control characters or whitespace is refused, not silently normalized", () => {
  // The WHATWG URL parser trims leading/trailing C0-and-space and strips any
  // tab/CR/LF from the middle. We launch the raw string (never parsed.href),
  // so a raw target with these would either mismatch what was "approved" or
  // — worse — smuggle bytes past the allowlist check into the argv element
  // handed to rundll32. Reject outright instead.
  assert.equal(isAllowedUrl("https://example.invalid/\t/a"), false);
  assert.equal(isAllowedUrl("https://example.invalid/\n/a"), false);
  assert.equal(isAllowedUrl("https://example.invalid/\r/a"), false);
  assert.equal(isAllowedUrl("https://example.invalid/\x00/a"), false);
  assert.equal(isAllowedUrl(" https://example.invalid/a"), false);
  assert.equal(isAllowedUrl("https://example.invalid/a "), false);
  assert.equal(isAllowedUrl("https://example.invalid/a b"), false);
});

test("a bare Windows path is not mistaken for a URL", () => {
  // new URL("C:\\out\\x.png") parses with protocol "c:", so a naive URL test
  // would classify a drive path as a URL and skip the file checks.
  assert.equal(looksLikeUrl("C:\\out\\x.png"), false);
  assert.equal(looksLikeUrl("https://example.invalid"), true);
});

/**
 * Every metacharacter a shell would act on that the platform also allows in a
 * filename. Windows forbids < > : " / \ | ? * outright, so the double quote
 * only appears where a file can actually carry it.
 */
const HOSTILE_NAME =
  process.platform === "win32"
    ? "a;calc.exe & echo $(id) `whoami` '.png"
    : `a";calc.exe & echo $(id) \`whoami\` '.png`;

test("a filename full of shell metacharacters is passed through as one argument", () => {
  const dir = sandbox();
  const file = join(dir, HOSTILE_NAME);
  writeFileSync(file, "x");

  const spawned = recorder();
  const outcome = openTarget(file, {
    platform: "linux",
    env: DESKTOP_ENV,
    spawnFn: spawned.fn as never,
  });

  assert.equal(outcome.status, "spawned");
  assert.equal(spawned.calls.length, 1);
  const call = spawned.calls[0]!;
  assert.equal(call.file, "xdg-open");
  // One argument, byte-identical to the path. Nothing was split or re-quoted.
  assert.deepEqual(call.args, [file]);
  assert.equal(call.options["shell"], false);
});

test("a leading-dash filename cannot reach the opener as a flag", () => {
  const dir = sandbox();
  const file = join(dir, "-rf.png");
  writeFileSync(file, "x");

  const spawned = recorder();
  const relative = openTarget("-rf.png", {
    platform: "linux",
    env: DESKTOP_ENV,
    spawnFn: spawned.fn as never,
  });

  // Relative paths resolve against cwd, which is not the sandbox — so this
  // one is refused for not existing rather than launched as `-rf.png`.
  assert.equal(relative.status, "rejected");
  assert.equal(spawned.calls.length, 0);

  const absolute = openTarget(file, {
    platform: "linux",
    env: DESKTOP_ENV,
    spawnFn: spawned.fn as never,
  });
  assert.equal(absolute.status, "spawned");
  assert.equal(spawned.calls[0]!.args[0]!.startsWith("-"), false);
});

test("a target that does not exist is refused instead of launched", () => {
  const spawned = recorder();
  const outcome = openTarget(join(sandbox(), "absent.png"), {
    platform: "linux",
    env: DESKTOP_ENV,
    spawnFn: spawned.fn as never,
  });
  assert.equal(outcome.status, "rejected");
  assert.match(outcome.detail, /does not exist/);
  assert.equal(spawned.calls.length, 0);
});

test("a directory is openable", () => {
  const dir = sandbox();
  const nested = join(dir, "gallery");
  mkdirSync(nested);
  const spawned = recorder();
  assert.equal(
    openTarget(nested, { platform: "darwin", env: DESKTOP_ENV, spawnFn: spawned.fn as never })
      .status,
    "spawned",
  );
});

test("a headless Linux session reports unavailable rather than pretending to open", () => {
  const dir = sandbox();
  const file = join(dir, "a.png");
  writeFileSync(file, "x");
  const spawned = recorder();
  const outcome = openTarget(file, {
    platform: "linux",
    env: {} as NodeJS.ProcessEnv,
    spawnFn: spawned.fn as never,
  });
  assert.equal(outcome.status, "unavailable");
  assert.match(outcome.detail, /DISPLAY/);
  assert.equal(spawned.calls.length, 0);
});

test("a spawn failure is reported, not thrown", () => {
  const dir = sandbox();
  const file = join(dir, "a.png");
  writeFileSync(file, "x");
  const outcome = openTarget(file, {
    platform: "linux",
    env: DESKTOP_ENV,
    spawnFn: ((): never => {
      throw new Error("ENOENT xdg-open");
    }) as never,
  });
  assert.equal(outcome.status, "spawn-error");
  assert.match(outcome.detail, /ENOENT/);
});

test("planOpen validates without launching so doctor can report read-only", () => {
  const dir = sandbox();
  const file = join(dir, "a.png");
  writeFileSync(file, "x");
  const plan = planOpen(file, { platform: "win32", env: DESKTOP_ENV });
  assert.equal(plan.status, "spawned");
  assert.equal(plan.executable, "explorer.exe");
  assert.deepEqual(plan.args, [file]);
});

test("planOpen picks rundll32 for a win32 URL, not explorer.exe", () => {
  // This is the live bug end to end: `aether auth login` calls openBrowser,
  // which calls openTarget, which used to hand the device-approval URL to
  // explorer.exe — opening a File Explorer window instead of the browser.
  const plan = planOpen("https://aethersystems.net/platform/device", {
    platform: "win32",
    env: DESKTOP_ENV,
  });
  assert.equal(plan.status, "spawned");
  assert.equal(plan.executable, "rundll32.exe");
  assert.deepEqual(plan.args, [
    "url.dll,FileProtocolHandler",
    "https://aethersystems.net/platform/device",
  ]);
});

test("openTarget spawns rundll32 with the URL as its own argv element, no shell", () => {
  const spawned = recorder();
  const outcome = openTarget("https://aethersystems.net/platform/device", {
    platform: "win32",
    env: DESKTOP_ENV,
    spawnFn: spawned.fn as never,
  });
  assert.equal(outcome.status, "spawned");
  assert.equal(spawned.calls.length, 1);
  const call = spawned.calls[0]!;
  assert.equal(call.file, "rundll32.exe");
  assert.deepEqual(call.args, [
    "url.dll,FileProtocolHandler",
    "https://aethersystems.net/platform/device",
  ]);
  assert.equal(call.options["shell"], false);
});

test("a disallowed win32 target (javascript:, file:, scheme-less, control chars) is refused, never launched", () => {
  const spawned = recorder();
  for (const target of [
    "javascript:alert(1)",
    "file:///C:/Windows/System32/cmd.exe",
    "not a url",
    "https://example.invalid/\n/a",
    " https://example.invalid/a",
  ]) {
    const outcome = openTarget(target, {
      platform: "win32",
      env: DESKTOP_ENV,
      spawnFn: spawned.fn as never,
    });
    assert.equal(outcome.status, "rejected", `expected rejection for ${JSON.stringify(target)}`);
  }
  assert.equal(spawned.calls.length, 0);
});
