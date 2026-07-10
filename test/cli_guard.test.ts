import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Spawn-level pins for main.ts's dispatch wiring (untestable via import —
// main() runs at module load): the typo guard and the chat fallthrough + hint.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runCli(
  args: string[],
  cfgDir: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ exit: number | string; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, "dist", "src", "main.js"), ...args], {
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
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += String(d)));
    child.stderr.on("data", (d: Buffer) => (err += String(d)));
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

test("a lone near-miss token exits 2 with the suggestion + chat escape", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-guard-"));
  try {
    const r = await runCli(["recipt"], dir);
    assert.equal(r.exit, 2);
    assert.match(r.err, /did you mean: aether receipt\?/);
    assert.match(r.err, /aether chat recipt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-near-miss word flows to chat and fails with the network hint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-guard-"));
  try {
    // resolveBackend is local-first when unauthenticated ("auto" picks Ollama,
    // not cloud, unless a session is signed in — see chat.ts). Force the cloud
    // leg explicitly so this test still exercises what it's named for: a
    // chat-path network failure surfacing the /doctor-style connectivity hint.
    const r = await runCli(["hello"], dir, { AETHER_BACKEND: "cloud" });
    assert.equal(r.exit, 1, `expected chat-path network failure, got ${r.exit} (err: ${r.err.slice(0, 150)})`);
    assert.match(r.err, /✗ /);
    assert.match(r.err, /⤷ can't reach http:\/\/127\.0\.0\.1:9/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
