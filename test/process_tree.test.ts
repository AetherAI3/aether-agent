// Process-tree teardown for run_shell / run_tests.
//
// The old path used spawnSync with a `timeout`. That signals the DIRECT child
// only — the shell — so the thing the user actually started (npm test, pytest,
// a compiler) is orphaned and keeps running, holding ports, files and CPU. On
// Windows the cmd.exe shell makes it near-certain.
//
// These assert survival by PID, not that the call returned promptly. A parent
// that exits while its grandchild keeps running looks identical to success from
// the caller's side, which is exactly how this went unnoticed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpWorkspace } from "./tmp_workspace.js";
import { ToolExecutor } from "../src/core/tool_executor.js";

/** True while a pid exists. Signal 0 tests for existence without delivering. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function settle(ms = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A child that prints its own pid, spawns a long-lived grandchild that prints
 * ITS pid, then sleeps. Both pids reach stdout before anything is killed, so a
 * test can look them up afterwards.
 */
function treeScript(dir: string): string {
  const grandchild = join(dir, "grandchild.js");
  writeFileSync(grandchild, "console.log('GRANDCHILD:' + process.pid); setInterval(() => {}, 1000);\n");
  const child = join(dir, "child.js");
  writeFileSync(
    child,
    "const { spawn } = require('node:child_process');\n" +
      "console.log('CHILD:' + process.pid);\n" +
      `const g = spawn(process.execPath, [${JSON.stringify(grandchild)}], { stdio: 'inherit' });\n` +
      "void g;\n" +
      "setInterval(() => {}, 1000);\n",
  );
  return child;
}

function pidsFrom(output: string): { child: number | null; grandchild: number | null } {
  const grab = (label: string): number | null => {
    const m = output.match(new RegExp(`${label}:(\\d+)`));
    return m ? Number(m[1]) : null;
  };
  return { child: grab("CHILD"), grandchild: grab("GRANDCHILD") };
}

test("a timed-out command kills its whole tree, not just the shell", async () => {
  const dir = tmpWorkspace("aether-tree-");
  const script = treeScript(dir);
  const exec = new ToolExecutor(dir);

  const result = await exec.executeAsync("run_shell", { command: `"${process.execPath}" "${script}"` }, { timeoutMs: 1500 });

  assert.equal(result.exitCode, 124, "a timeout must be distinguishable from an ordinary failure");
  assert.match(result.output, /timeout/i);

  const { child, grandchild } = pidsFrom(result.output);
  assert.ok(child, `no child pid in output: ${result.output.slice(0, 300)}`);
  assert.ok(grandchild, `no grandchild pid in output: ${result.output.slice(0, 300)}`);

  await settle();
  assert.equal(alive(child!), false, "the child survived the timeout");
  assert.equal(alive(grandchild!), false, "the GRANDCHILD survived — the tree was not reaped");
});

test("an aborted command kills its whole tree and reports aborted, not timed out", async () => {
  const dir = tmpWorkspace("aether-abort-");
  const script = treeScript(dir);
  const exec = new ToolExecutor(dir);
  const controller = new AbortController();

  const running = exec.executeAsync(
    "run_shell",
    { command: `"${process.execPath}" "${script}"` },
    { timeoutMs: 60_000, signal: controller.signal },
  );

  await settle(900); // let both pids print
  controller.abort();
  const result = await running;

  assert.equal(result.exitCode, 130, "an operator cancellation is not a timeout");
  assert.match(result.output, /abort/i);

  const { child, grandchild } = pidsFrom(result.output);
  assert.ok(child && grandchild, `missing pids: ${result.output.slice(0, 300)}`);
  await settle();
  assert.equal(alive(child!), false, "the child survived the abort");
  assert.equal(alive(grandchild!), false, "the GRANDCHILD survived the abort");
});

test("a normal command still returns its real exit code and output", async () => {
  const dir = tmpWorkspace("aether-ok-");
  const exec = new ToolExecutor(dir);

  const ok = await exec.executeAsync("run_shell", { command: `"${process.execPath}" -e "console.log('hi')"` });
  assert.equal(ok.exitCode, 0);
  assert.match(ok.output, /hi/);

  const bad = await exec.executeAsync("run_shell", { command: `"${process.execPath}" -e "process.exit(3)"` });
  assert.equal(bad.exitCode, 3, "a non-zero exit must survive unchanged");
});

test("the event loop keeps running while a command is in flight", async () => {
  // spawnSync blocked the loop outright, freezing heartbeats, renderers and any
  // AbortController for the duration. Proving a timer fires during the call is
  // what distinguishes async execution from a merely faster synchronous one.
  const dir = tmpWorkspace("aether-loop-");
  const exec = new ToolExecutor(dir);
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
  }, 50);

  await exec.executeAsync("run_shell", { command: `"${process.execPath}" -e "setTimeout(()=>{},700)"` });
  clearInterval(timer);

  assert.ok(ticks > 2, `the event loop was blocked during execution (ticks=${ticks})`);
});
