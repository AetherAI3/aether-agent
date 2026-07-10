import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// End-to-end one-shot: fixture server → CLI child process. Pins three things:
// the fail-soft stream→postJson fallback works, the process exits PROMPTLY
// and CLEANLY (no libuv UV_HANDLE_CLOSING assertion, the pre-existing Windows
// crash the sweep fixed), and a piped run writes zero animation bytes.
test("one-shot turn exits 0 promptly with the response on stdout", async () => {
  const server = createServer((req, res) => {
    if (req.url?.endsWith("/agent/chat/stream")) {
      // Contract fail-soft: plain JSON body → client falls back to /agent/chat.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ stream: false }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ response: "fixture says hi" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const cfgDir = mkdtempSync(join(tmpdir(), "aether-oneshot-"));
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

  try {
    const t0 = Date.now();
    const child = spawn(process.execPath, [join(root, "dist", "src", "main.js"), "hello fixture"], {
      env: {
        ...process.env,
        AETHER_BASE_URL: `http://127.0.0.1:${port}`,
        AETHER_CONFIG_DIR: cfgDir,
        AETHER_NO_ANIM: "1",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += String(d)));
    child.stderr.on("data", (d: Buffer) => (err += String(d)));
    const exit = await new Promise<number | string>((resolve) => {
      const to = setTimeout(() => {
        child.kill();
        resolve("TIMEOUT");
      }, 8000);
      child.on("exit", (c) => {
        clearTimeout(to);
        resolve(c ?? -1);
      });
    });
    const ms = Date.now() - t0;

    assert.equal(exit, 0, `expected clean exit 0, got ${exit} (stderr: ${err.slice(0, 200)})`);
    assert.ok(ms < 6000, `exit took ${ms}ms — the loop is being held open`);
    assert.ok(out.includes("fixture says hi"), `stdout missing response: ${out.slice(0, 120)}`);
    assert.ok(!err.includes("Assertion failed"), `libuv assertion resurfaced: ${err.slice(0, 200)}`);
    assert.ok(!err.includes("thinking"), "thinking pulse leaked into a piped run");
  } finally {
    server.close();
    rmSync(cfgDir, { recursive: true, force: true });
  }
});
