import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deviceRuntimeEnabled } from "../src/core/device_runtime/enablement.js";
import { daemonStartRefusal, runDeviceDaemon } from "../src/core/device_runtime/daemon.js";
import { saveEnrollment, type EnrollmentRecord } from "../src/core/device_runtime/identity.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import type { AetherConfig } from "../src/types.js";

function cfg(overrides: Partial<AetherConfig> = {}): AetherConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

async function withEnv<T>(env: Record<string, string | undefined>, body: () => T | Promise<T>): Promise<T> {
  const prior: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prior[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await body();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("the runtime is OFF by default and by explicit false", async () => {
  await withEnv({ AETHER_DEVICE_RUNTIME: undefined }, () => {
    assert.equal(deviceRuntimeEnabled(cfg()), false);
    assert.equal(deviceRuntimeEnabled(cfg({ deviceRuntime: { enabled: false } })), false);
  });
});

test("either the config switch or the env override enables it", async () => {
  await withEnv({ AETHER_DEVICE_RUNTIME: undefined }, () => {
    assert.equal(deviceRuntimeEnabled(cfg({ deviceRuntime: { enabled: true } })), true);
  });
  await withEnv({ AETHER_DEVICE_RUNTIME: "1" }, () => {
    assert.equal(deviceRuntimeEnabled(cfg()), true);
  });
  // Any other env value is not the opt-in.
  await withEnv({ AETHER_DEVICE_RUNTIME: "true" }, () => {
    assert.equal(deviceRuntimeEnabled(cfg()), false);
  });
});

test("the daemon REFUSES to start when the runtime is disabled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-dev-daemon-"));
  await withEnv({ AETHER_CONFIG_DIR: dir, AETHER_DEVICE_RUNTIME: undefined }, async () => {
    const code = await runDeviceDaemon();
    assert.equal(code, 3, "a disabled runtime must exit with the disabled code");
    assert.match(daemonStartRefusal() ?? "", /disabled/);
  });
  rmSync(dir, { recursive: true, force: true });
});

test("the daemon refuses to start when enabled but not enrolled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-dev-daemon-"));
  await withEnv({ AETHER_CONFIG_DIR: dir, AETHER_DEVICE_RUNTIME: "1" }, async () => {
    const code = await runDeviceDaemon();
    assert.equal(code, 4, "an unenrolled device must exit with the not-enrolled code");
    assert.match(daemonStartRefusal() ?? "", /not enrolled/);
  });
  rmSync(dir, { recursive: true, force: true });
});

test("daemonStartRefusal returns null once enabled and enrolled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-dev-daemon-"));
  await withEnv({ AETHER_CONFIG_DIR: dir, AETHER_DEVICE_RUNTIME: "1" }, async () => {
    const record: EnrollmentRecord = {
      device_id: "dev-1",
      device_token: "tok",
      device_command_key: "key",
      display_name: "host",
      base_url: "https://api.example.test/cloud",
      enrolled_at: 0,
    };
    saveEnrollment(record);
    assert.equal(daemonStartRefusal(), null);
  });
  rmSync(dir, { recursive: true, force: true });
});
