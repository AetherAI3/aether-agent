import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";

const IS_WIN = process.platform === "win32";

function tmpBase(tag: string): string {
  return join(tmpdir(), `aether-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

/** Run `fn` with AETHER_CONFIG_DIR pointed at a scratch dir, then clean up. */
async function withConfigDir(tag: string, fn: (base: string, configDir: string) => Promise<void>): Promise<void> {
  const base = tmpBase(tag);
  const configDir = join(base, "cfg");
  const prev = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = configDir;
  try {
    mkdirSync(base, { recursive: true });
    await fn(base, configDir);
  } finally {
    if (prev === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prev;
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * Plant a link-like entry at `linkPath` and return a reader for the content it
 * would expose if something followed it.
 *
 * Platform reality, not a preference: on Windows a FILE symlink needs
 * SeCreateSymbolicLinkPrivilege (EPERM on a normal account, verified on this
 * box), while a directory JUNCTION needs no privilege at all — and lstat
 * reports a junction as isSymbolicLink(), which is exactly the entry an
 * attacker can actually plant there. So the Windows arm redirects to a
 * directory and the POSIX arm to a file; both assert the same property.
 */
function plantLink(base: string, linkPath: string): { readVictim: () => string } {
  if (IS_WIN) {
    const victimDir = join(base, "victim-dir");
    mkdirSync(victimDir, { recursive: true });
    writeFileSync(join(victimDir, "secret"), "VICTIM", "utf8");
    symlinkSync(victimDir, linkPath, "junction");
    return { readVictim: () => readFileSync(join(victimDir, "secret"), "utf8") };
  }
  const victim = join(base, "victim");
  writeFileSync(victim, "VICTIM", "utf8");
  symlinkSync(victim, linkPath, "file");
  return { readVictim: () => readFileSync(victim, "utf8") };
}

async function newStore() {
  const { FileTokenStore } = await import("../src/core/auth.js");
  return new FileTokenStore();
}

// First-run regression: the token store must create the config dir itself —
// `aether auth login` is the documented first command on a fresh machine and
// nothing earlier on that path writes the directory.
test("token store set() works when the config dir does not exist yet", async () => {
  const dir = join(tmpdir(), `aether-fresh-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const prev = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = dir;
  try {
    assert.equal(existsSync(dir), false, "precondition: dir must not exist");
    const { FileTokenStore } = await import("../src/core/auth.js");
    const store = new FileTokenStore();
    await store.set("aek_fresh_machine");
    assert.equal(await store.get(), "aek_fresh_machine");
    await store.clear();
    assert.equal(await store.get(), null);
  } finally {
    if (prev === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

// The security fix this file exists for. O_NOFOLLOW is undefined on Windows
// (libuv never defines it), so `O_NOFOLLOW ?? 0` was a no-op guard there and a
// planted link was followed on BOTH read and write. The lstat check must hold
// on every platform.
test("a link planted at the token path is never read through", async () => {
  await withConfigDir("nofollow-get", async (base, configDir) => {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const tokenPath = join(configDir, ".token");
    const { readVictim } = plantLink(base, tokenPath);
    assert.equal(lstatSync(tokenPath).isSymbolicLink(), true, "precondition: a link is planted");

    const store = await newStore();
    assert.equal(await store.get(), null, "a planted link must read as 'no token', never followed");
    assert.equal(readVictim(), "VICTIM", "the link target must be untouched by a read");
  });
});

test("set() refuses a linked token path instead of writing through it", async () => {
  await withConfigDir("nofollow-set", async (base, configDir) => {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const tokenPath = join(configDir, ".token");
    const { readVictim } = plantLink(base, tokenPath);

    const store = await newStore();
    await assert.rejects(
      () => store.set("aek_attacker_would_capture_this"),
      /symlink or reparse point/,
      "set() must fail loudly on a planted link",
    );
    assert.equal(readVictim(), "VICTIM", "the link target must never receive the token");
    assert.equal(
      lstatSync(tokenPath).isSymbolicLink(),
      true,
      "the planted link is left as-is; set() must not silently replace it either",
    );
    // And nothing partial was left beside it.
    assert.deepEqual(
      readdirSync(configDir).filter((n) => n.endsWith(".tmp")),
      [],
      "a refused set() must leave no temp file behind",
    );
  });
});

test("set() leaves no temp sibling and rename replaces an existing token in place", async () => {
  await withConfigDir("atomic-set", async (_base, configDir) => {
    const store = await newStore();
    await store.set("aek_first");
    assert.equal(await store.get(), "aek_first");

    // Windows rename-over-an-existing-file: MoveFileEx REPLACE_EXISTING
    // semantics. Asserted here rather than assumed, because the write-to-temp
    // fix depends on it.
    await store.set("aek_second_value_replaces_the_first");
    assert.equal(await store.get(), "aek_second_value_replaces_the_first");

    const entries = readdirSync(configDir).sort();
    assert.deepEqual(entries, [".token"], "the only file at the config dir must be the complete token");
    assert.equal(readFileSync(join(configDir, ".token"), "utf8"), "aek_second_value_replaces_the_first");
    assert.equal(lstatSync(join(configDir, ".token")).isFile(), true);
  });
});

test("a stale temp file beside the token is never mistaken for the token", async () => {
  await withConfigDir("stale-tmp", async (_base, configDir) => {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    // A crashed writer's leftovers, including one that could look plausible.
    writeFileSync(join(configDir, `.token.999999.deadbeef.tmp`), "aek_GARBAGE_FROM_A_CRASH", "utf8");

    const store = await newStore();
    assert.equal(await store.get(), null, "a .tmp sibling is not the token");

    await store.set("aek_real");
    assert.equal(await store.get(), "aek_real", "the real token wins over any leftover temp file");
  });
});

test("an empty token file reads as null", async () => {
  await withConfigDir("empty-token", async (_base, configDir) => {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(configDir, ".token"), "   \n", "utf8");
    const store = await newStore();
    assert.equal(await store.get(), null);
  });
});

test("the token file is 0600 and the config dir 0700 at creation", { skip: IS_WIN }, async () => {
  await withConfigDir("modes", async (_base, configDir) => {
    const store = await newStore();
    await store.set("aek_modes");
    assert.equal(statSync(join(configDir, ".token")).mode & 0o777, 0o600);
    assert.equal(statSync(configDir).mode & 0o777, 0o700);
  });
});

// A reader in another process must never catch the store mid-write. This is
// what the O_TRUNC-then-write version could not promise: between truncate and
// write the file was empty on disk.
test("a concurrent writer never lets a reader observe an empty or partial token", async () => {
  await withConfigDir("concurrent", async (_base, configDir) => {
    const A = "aek_" + "a".repeat(4000);
    const B = "aek_" + "b".repeat(4000);
    const store = await newStore();
    await store.set(A);

    const authUrl = new URL("../src/core/auth.js", import.meta.url).href;
    const worker = new Worker(
      `
      const { workerData, parentPort } = require("node:worker_threads");
      (async () => {
        const { FileTokenStore } = await import(workerData.url);
        const s = new FileTokenStore();
        for (let i = 0; i < 200; i++) await s.set(i % 2 === 0 ? workerData.a : workerData.b);
        parentPort.postMessage("done");
      })().catch((e) => { parentPort.postMessage("error: " + (e && e.stack || e)); });
      `,
      {
        eval: true,
        workerData: { url: authUrl, a: A, b: B },
        env: { ...process.env, AETHER_CONFIG_DIR: configDir },
      },
    );

    let workerMsg: string | null = null;
    worker.on("message", (m: string) => {
      workerMsg = m;
    });
    const workerExit = new Promise<number>((resolve) => worker.on("exit", resolve));

    const bad: string[] = [];
    let reads = 0;
    while (workerMsg === null) {
      const v = await store.get();
      reads++;
      if (v !== A && v !== B) bad.push(v === null ? "<null>" : `len=${v.length}`);
      await new Promise((r) => setImmediate(r));
    }
    await workerExit;

    assert.equal(workerMsg, "done", `worker failed: ${workerMsg}`);
    assert.ok(reads > 0, "the reader must have actually run");
    assert.deepEqual(bad, [], "every read must return one whole token, never empty or truncated");
    assert.deepEqual(
      readdirSync(configDir).filter((n) => n.endsWith(".tmp")),
      [],
      "200 writes must leave no temp files behind",
    );
  });
});

test("clear() on a missing token file is not an error", async () => {
  await withConfigDir("clear-missing", async (_base, configDir) => {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const store = await newStore();
    await store.clear();
    await store.clear();
    assert.equal(await store.get(), null);
  });
});

test("clear() removes a planted link, never what it points at", async () => {
  await withConfigDir("clear-link", async (base, configDir) => {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const tokenPath = join(configDir, ".token");
    const { readVictim } = plantLink(base, tokenPath);

    const store = await newStore();
    await store.clear();
    assert.equal(existsSync(tokenPath), false, "the link itself is gone");
    assert.equal(readVictim(), "VICTIM", "the link target survives a logout");
  });
});

// POSIX-only: Windows has no getuid and models this with ACLs, which Node does
// not expose — see assertSafeConfigDir's doc comment.
test("set() refuses a group/world-writable config dir", { skip: IS_WIN }, async () => {
  await withConfigDir("bad-dir-mode", async (_base, configDir) => {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    chmodSync(configDir, 0o777);
    const store = await newStore();
    await assert.rejects(() => store.set("aek_nope"), /group\/world-writable/);
    assert.equal(existsSync(join(configDir, ".token")), false);
  });
});

// Runs on BOTH platforms, unlike the uid/mode test above: a directory junction
// needs no privilege on Windows, which makes a redirected config dir the most
// reachable form of this attack there — the token would land in a directory the
// attacker controls while login still reported success.
test("set() refuses a config dir that is itself a link", async () => {
  await withConfigDir("linked-dir", async (base, configDir) => {
    const real = join(base, "elsewhere");
    mkdirSync(real, { recursive: true, mode: 0o700 });
    symlinkSync(real, configDir, IS_WIN ? "junction" : "dir");
    assert.equal(lstatSync(configDir).isSymbolicLink(), true, "precondition: the config dir is a link");

    const store = await newStore();
    await assert.rejects(() => store.set("aek_nope"), /symlink or reparse point/);
    assert.equal(existsSync(join(real, ".token")), false, "nothing was written through the linked dir");
    assert.deepEqual(readdirSync(real), [], "not even a temp file reached the redirected directory");
  });
});
