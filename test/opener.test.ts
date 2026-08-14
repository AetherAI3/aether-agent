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
});

test("only http and https URLs without embedded credentials are openable", () => {
  assert.equal(isAllowedUrl("https://example.invalid/a.png"), true);
  assert.equal(isAllowedUrl("http://127.0.0.1:8080/a.png"), true);
  assert.equal(isAllowedUrl("file:///etc/passwd"), false);
  assert.equal(isAllowedUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedUrl("data:text/html,<script>"), false);
  assert.equal(isAllowedUrl("https://user:pass@example.invalid/a"), false);
  assert.equal(isAllowedUrl("not a url"), false);
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
