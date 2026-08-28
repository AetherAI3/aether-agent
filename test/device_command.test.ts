import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdDevice, DEVICE_EXIT } from "../src/commands/device.js";
import { findDispatchedCliCommand } from "../src/commands/cli_registry.js";
import { loadEnrollment } from "../src/core/device_runtime/identity.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import type { AppContext } from "../src/core/context.js";
import type { CommandFlags } from "../src/core/command_dispatch.js";

const NOOP_FLAGS: CommandFlags = {
  bool: () => false,
  str: () => undefined,
  list: () => [],
};

function fakeCtx(overrides: Partial<AppContext> = {}): AppContext {
  return {
    cfg: { ...DEFAULT_CONFIG },
    api: { postJson: async () => ({}) } as unknown as AppContext["api"],
    tokens: {
      get: async () => "sess-token",
      set: async () => {},
      clear: async () => {},
    },
    flags: { json: true, audit: false, yes: false, cwd: process.cwd() } as AppContext["flags"],
    confirm: async () => false,
    ...overrides,
  };
}

async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const original = process.stdout.write.bind(process.stdout);
  let out = "";
  (process.stdout.write as unknown) = (chunk: string | Uint8Array): boolean => {
    out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  };
  try {
    const code = await fn();
    return { code, out };
  } finally {
    (process.stdout.write as unknown) = original;
  }
}

function withConfigDir<T>(body: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "aether-dev-cmd2-"));
  const prior = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = dir;
  return body().finally(() => {
    if (prior === undefined) delete process.env["AETHER_CONFIG_DIR"];
    else process.env["AETHER_CONFIG_DIR"] = prior;
    rmSync(dir, { recursive: true, force: true });
  });
}

test("device is wired into the dispatch table", () => {
  const dispatched = findDispatchedCliCommand("device");
  assert.ok(dispatched, "aether device must resolve to a dispatched command");
});

test("device status reports unenrolled + not running as JSON", async () => {
  await withConfigDir(async () => {
    const { code, out } = await capture(() => cmdDevice(fakeCtx(), ["status"], NOOP_FLAGS));
    assert.equal(code, DEVICE_EXIT.ok);
    const summary = JSON.parse(out) as { enrolled: boolean; running: boolean; enabled: boolean };
    assert.equal(summary.enrolled, false);
    assert.equal(summary.running, false);
    assert.equal(summary.enabled, false);
  });
});

test("device groups reports an empty list", async () => {
  await withConfigDir(async () => {
    const { out } = await capture(() => cmdDevice(fakeCtx(), ["groups"], NOOP_FLAGS));
    assert.deepEqual(JSON.parse(out), { groups: [] });
  });
});

test("device last reports unenrolled without leaking secrets", async () => {
  await withConfigDir(async () => {
    const { out } = await capture(() => cmdDevice(fakeCtx(), ["last"], NOOP_FLAGS));
    assert.deepEqual(JSON.parse(out), { enrolled: false });
  });
});

test("device enroll saves the enrollment record", async () => {
  await withConfigDir(async () => {
    const ctx = fakeCtx({
      api: {
        postJson: async () => ({
          device_id: "dev-99",
          device_token: "dtok",
          device_command_key: "dkey",
          display_name: "host",
        }),
      } as unknown as AppContext["api"],
    });
    const { code, out } = await capture(() => cmdDevice(ctx, ["enroll"], NOOP_FLAGS));
    assert.equal(code, DEVICE_EXIT.ok);
    assert.match(out, /dev-99/);
    const record = loadEnrollment();
    assert.equal(record?.device_id, "dev-99");
    assert.equal(record?.device_command_key, "dkey");
  });
});

test("device enroll refuses without a session token", async () => {
  await withConfigDir(async () => {
    const ctx = fakeCtx({
      tokens: { get: async () => null, set: async () => {}, clear: async () => {} },
    });
    const code = await capture(() => cmdDevice(ctx, ["enroll"], NOOP_FLAGS));
    assert.equal(code.code, DEVICE_EXIT.notEnrolled);
  });
});

test("device start refuses when the runtime is disabled", async () => {
  await withConfigDir(async () => {
    const prior = process.env["AETHER_DEVICE_RUNTIME"];
    delete process.env["AETHER_DEVICE_RUNTIME"];
    try {
      const code = await capture(() => cmdDevice(fakeCtx(), ["start"], NOOP_FLAGS));
      assert.equal(code.code, DEVICE_EXIT.disabled);
    } finally {
      if (prior !== undefined) process.env["AETHER_DEVICE_RUNTIME"] = prior;
    }
  });
});

test("an unknown subcommand returns a usage error", async () => {
  const code = await capture(() => cmdDevice(fakeCtx(), ["frobnicate"], NOOP_FLAGS));
  assert.equal(code.code, DEVICE_EXIT.usage);
});
