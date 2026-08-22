import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Spawn-level proof that the dispatch table is the real front door. main()
// runs at module load, so the only honest way to assert "this command actually
// executed, with these flags" is to run the built CLI and read what came back.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runCli(args: string[], cfgDir: string): Promise<{ exit: number | string; out: string; err: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, [join(root, "dist", "src", "main.js"), ...args], {
        env: {
          ...process.env,
          // Closed port → instant ECONNREFUSED for anything that reaches out.
          AETHER_BASE_URL: "http://127.0.0.1:9",
          AETHER_CONFIG_DIR: cfgDir,
          AETHER_NO_ANIM: "1",
          NO_COLOR: "1",
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
    }, 60000);
    child.on("exit", (c) => {
      clearTimeout(to);
      resolve({ exit: c ?? -1, out, err });
    });
  });
}

async function withCli(
  t: { skip: (m: string) => void },
  args: string[],
  body: (r: { exit: number | string; out: string; err: string }) => void,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "aether-dispatch-"));
  try {
    const r = await runCli(args, dir);
    if (r.exit === "SPAWN_BLOCKED") {
      t.skip("sandbox blocks child process spawning");
      return;
    }
    body(r);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a dispatch-table command runs the command, not chat", async (t) => {
  await withCli(t, ["doctor", "--json"], (r) => {
    const report = JSON.parse(r.out);
    assert.equal(report.mode, "fast");
    assert.ok(Array.isArray(report.checks) && report.checks.length > 0);
  });
});

test("--live reaches the command and produces the live report", async (t) => {
  // Regression pin. main.ts parses non-strictly, so before the flag table
  // `--live` was captured as an undeclared global and stripped from the argv
  // doctor was handed: the end-to-end proof silently degraded to the fast
  // configured-only report while still exiting 0. Unknown rendered as verified.
  await withCli(t, ["doctor", "--live", "--no-ui", "--json"], (r) => {
    const report = JSON.parse(r.out);
    assert.equal(report.mode, "live");
  });
});

test("a declared boolean flag reaches the command it belongs to", async (t) => {
  await withCli(t, ["doctor", "--deep"], (r) => {
    assert.match(r.out, /--deep is the read-only report/);
  });
});

test("a repeatable flag's value reaches the command intact", async (t) => {
  await withCli(t, ["doctor", "--fix", "--only", "state.temp", "--only", "no-such-repair"], (r) => {
    assert.equal(r.exit, 2);
    assert.match(r.out, /unknown repair no-such-repair/);
    assert.equal(r.out.includes("state.temp"), true);
  });
});

test("a hostile flag value stays one argv element and reaches no shell", async (t) => {
  const hostile = '"; rm -rf / #';
  await withCli(t, ["doctor", "--fix", "--only", hostile], (r) => {
    assert.equal(r.exit, 2);
    // Echoed back verbatim as one unknown repair id — not split, not expanded.
    assert.ok(r.out.includes(`unknown repair ${hostile}`), r.out);
  });
});

test("a near-miss for a table command still hits the typo guard, not chat", async (t) => {
  await withCli(t, ["doctr"], (r) => {
    assert.equal(r.exit, 2);
    assert.match(r.err, /did you mean: aether doctor\?/);
  });
});
