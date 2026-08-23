import test from "node:test";
import assert from "node:assert/strict";
import { terminateProcessTree } from "../src/core/process_tree_kill.js";

test("Windows cancellation uses taskkill /T semantics through the tree operation", () => {
  const calls: number[] = [];
  terminateProcessTree({ pid: 42, killed: false, kill: () => true }, {
    platform: "win32", taskkill: (pid) => calls.push(pid),
  });
  assert.deepEqual(calls, [42]);
});

test("POSIX cancellation signals the detached process group and escalates", async () => {
  const calls: Array<[number, NodeJS.Signals]> = [];
  terminateProcessTree({ pid: 43, killed: false, kill: () => true }, {
    platform: "linux", signalGroup: (pid, signal) => calls.push([pid, signal]), escalateMs: 0,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(calls, [[43, "SIGTERM"], [43, "SIGKILL"]]);
});
