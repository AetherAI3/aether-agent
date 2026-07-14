import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { cloudMemoryEnabled, cmdMemory } from "../src/commands/memory.js";
import type { AppContext } from "../src/core/context.js";

const FACT = "11111111-1111-4111-8111-111111111111";

function sink(): { out: Writable; text: () => string } {
  let value = "";
  return {
    out: new Writable({
      write(chunk, _encoding, callback) {
        value += String(chunk);
        callback();
      },
    }),
    text: () => value,
  };
}

function context(
  deleteJson: (path: string) => Promise<unknown>,
  yes: boolean,
  confirm: () => Promise<boolean>,
  local = false,
): AppContext {
  return {
    api: { deleteJson } as AppContext["api"],
    cfg: { backend: "cloud" },
    tokens: { get: async () => "aek_test" },
    flags: { json: false, audit: false, yes, cwd: process.cwd(), local },
    confirm,
  } as unknown as AppContext;
}

test("memory forget requires confirmation before calling the QOPC backend", async () => {
  const paths: string[] = [];
  const capture = sink();
  const ctx = context(async (path) => {
    paths.push(path);
    return { deleted: true };
  }, false, async () => false);

  assert.equal(
    await cmdMemory(ctx, ["forget", "episodic", `qopc-episodic:${FACT}`], { out: capture.out }),
    0,
  );
  assert.deepEqual(paths, []);
  assert.match(capture.text(), /kept/);
});

test("memory forget dispatches the typed owner-scoped QOPC delete after confirmation", async () => {
  const paths: string[] = [];
  const capture = sink();
  const ctx = context(async (path) => {
    paths.push(path);
    return { deleted: true };
  }, true, async () => {
    throw new Error("confirmation should be bypassed by --yes");
  });

  assert.equal(
    await cmdMemory(ctx, ["forget", "semantic", `qopc-semantic:${FACT}`], { out: capture.out }),
    0,
  );
  assert.deepEqual(paths, [`/agent/memory/qopc/memory/${FACT}`]);
  assert.match(capture.text(), /forgot/);
});

test("memory forget rejects cross-tier QOPC ids before backend execution", async () => {
  let calls = 0;
  const capture = sink();
  const ctx = context(async () => {
    calls += 1;
    return { deleted: true };
  }, true, async () => true);

  assert.equal(
    await cmdMemory(ctx, ["forget", "procedural", `qopc-semantic:${FACT}`], { out: capture.out }),
    2,
  );
  assert.equal(calls, 0);
  assert.match(capture.text(), /does not match this tier/);
});

test("explicit local mode refuses QOPC memory before confirmation or network access", async () => {
  let calls = 0;
  const capture = sink();
  const ctx = context(async () => {
    calls += 1;
    return { deleted: true };
  }, true, async () => {
    throw new Error("local mode must reject before confirmation");
  }, true);

  assert.equal(
    await cmdMemory(ctx, ["forget", "episodic", `qopc-episodic:${FACT}`], { out: capture.out }),
    2,
  );
  assert.equal(calls, 0);
  assert.match(capture.text(), /cloud-only; local mode never queries it/);
});

test("cloud memory selection follows backend/auth and explicit local always wins", async () => {
  const base = {
    api: {},
    confirm: async () => true,
    flags: { json: false, audit: false, yes: false, cwd: process.cwd(), local: false },
  };
  const automaticOffline = {
    ...base,
    cfg: { backend: "auto" },
    tokens: { get: async () => "" },
  } as unknown as AppContext;
  const automaticOnline = {
    ...base,
    cfg: { backend: "auto" },
    tokens: { get: async () => "aek_test" },
  } as unknown as AppContext;
  const forcedLocal = {
    ...automaticOnline,
    cfg: { backend: "cloud" },
    flags: { ...automaticOnline.flags, local: true },
  } as unknown as AppContext;

  assert.equal(await cloudMemoryEnabled(automaticOffline), false);
  assert.equal(await cloudMemoryEnabled(automaticOnline), true);
  assert.equal(await cloudMemoryEnabled(forcedLocal), false);
});
