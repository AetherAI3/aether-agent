import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";

// Spawn-level pins for main.ts's dispatch wiring (untestable via import —
// main() runs at module load): the typo guard and the chat fallthrough + hint.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runCli(
  args: string[],
  cfgDir: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ exit: number | string; out: string; err: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, [join(root, "dist", "src", "main.js"), ...args], {
      env: {
        ...process.env,
        // Closed port → instant ECONNREFUSED for anything that tries the network.
        AETHER_BASE_URL: "http://127.0.0.1:9",
        AETHER_CONFIG_DIR: cfgDir,
        AETHER_NO_ANIM: "1",
        NO_COLOR: "1",
        ...extraEnv,
      },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ exit: "SPAWN_BLOCKED", out: "", err: String(err) });
      return;
    }
    let out = "";
    let err = "";
    child.stdout!.on("data", (d: Buffer) => (out += String(d)));
    child.stderr!.on("data", (d: Buffer) => (err += String(d)));
    const to = setTimeout(() => {
      child.kill();
      resolve({ exit: "TIMEOUT", out, err });
    }, 8000);
    child.on("exit", (c) => {
      clearTimeout(to);
      resolve({ exit: c ?? -1, out, err });
    });
  });
}

test("a lone near-miss token exits 2 with the suggestion + chat escape", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aether-guard-"));
  try {
    const r = await runCli(["recipt"], dir);
    if (r.exit === "SPAWN_BLOCKED") { t.skip("sandbox blocks child process spawning"); return; }
    assert.equal(r.exit, 2);
    assert.match(r.err, /did you mean: aether receipt\?/);
    assert.match(r.err, /aether chat recipt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("auht is an adjacent-transposition typo and makes no hosted request", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aether-guard-"));
  let hostedCalls = 0;
  const server = createServer((_req, res) => {
    hostedCalls++;
    res.writeHead(500, { "content-type": "application/json" });
    res.end('{"error":"the typo guard should have stopped before this request"}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address() as AddressInfo;
    const r = await runCli(["auht"], dir, {
      AETHER_BASE_URL: `http://127.0.0.1:${port}`,
      AETHER_BACKEND: "cloud",
    });
    if (r.exit === "SPAWN_BLOCKED") { t.skip("sandbox blocks child process spawning"); return; }
    assert.equal(r.exit, 2);
    assert.match(r.err, /unknown command: auht/);
    assert.match(r.err, /did you mean: aether auth\?/);
    assert.match(r.err, /aether chat auht/);
    assert.equal(hostedCalls, 0, "a command typo must be rejected before any hosted request");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => err ? reject(err) : resolve()),
    );
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a wrong-case command is guarded and makes no hosted request", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aether-guard-"));
  let hostedCalls = 0;
  const server = createServer((_req, res) => {
    hostedCalls++;
    res.writeHead(500, { "content-type": "application/json" });
    res.end('{"error":"the wrong-case guard should have stopped before this request"}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address() as AddressInfo;
    const r = await runCli(["Vault"], dir, {
      AETHER_BASE_URL: `http://127.0.0.1:${port}`,
      AETHER_BACKEND: "cloud",
    });
    if (r.exit === "SPAWN_BLOCKED") { t.skip("sandbox blocks child process spawning"); return; }
    assert.equal(r.exit, 2);
    assert.match(r.err, /unknown command: Vault/);
    assert.match(r.err, /did you mean: aether vault\?/);
    assert.match(r.err, /aether chat Vault/);
    assert.equal(hostedCalls, 0, "a wrong-case command must be rejected before any hosted request");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => err ? reject(err) : resolve()),
    );
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-near-miss word flows to chat and fails with the network hint", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aether-guard-"));
  try {
    // resolveBackend is local-first when unauthenticated ("auto" picks Ollama,
    // not cloud, unless a session is signed in — see chat.ts). Force the cloud
    // leg explicitly so this test still exercises what it's named for: a
    // chat-path network failure surfacing the /doctor-style connectivity hint.
    const r = await runCli(["hello"], dir, { AETHER_BACKEND: "cloud" });
    if (r.exit === "SPAWN_BLOCKED") { t.skip("sandbox blocks child process spawning"); return; }
    assert.equal(r.exit, 1, `expected chat-path network failure, got ${r.exit} (err: ${r.err.slice(0, 150)})`);
    assert.match(r.err, /✗ /);
    assert.match(r.err, /⤷ can't reach http:\/\/127\.0\.0\.1:9/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
