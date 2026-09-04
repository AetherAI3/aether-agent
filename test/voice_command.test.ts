import assert from "node:assert/strict";
import { test } from "node:test";

import { detectTerminalCapabilities } from "../src/core/terminal_capabilities.js";
import { AETHER_VOICE_CLOUD_SHA, AETHER_VOICE_CONTRACT } from "../src/core/voice.js";
import { voiceCommandReport } from "../src/commands/voice.js";

test("standalone Voice report is default-off and names exact missing ports", () => {
  const report = voiceCommandReport(detectTerminalCapabilities({
    host: "tty",
    stdinIsTTY: true,
    stdoutIsTTY: true,
    columns: 100,
    rows: 30,
    env: {},
  }));
  assert.equal(report.contract, AETHER_VOICE_CONTRACT);
  assert.equal(report.cloudCommit, AETHER_VOICE_CLOUD_SHA);
  assert.equal(report.state, "off");
  assert.equal(report.defaultOff, true);
  assert.equal(report.runtime, "unavailable");
  assert.equal(report.interaction, null);
  assert.equal(report.typedInputAvailable, true);
  assert.ok(report.missing.some((item) => item.includes("microphone capture adapter")));
  assert.ok(report.missing.some((item) => item.includes("audio playback adapter")));
});

test("a capability hint never pretends standalone ports are bound", () => {
  const report = voiceCommandReport(detectTerminalCapabilities({
    host: "electron",
    columns: 120,
    rows: 40,
    audioInput: true,
    audioOutput: true,
    keyReleaseEvents: true,
    env: {},
  }));
  assert.equal(report.runtime, "unavailable");
  assert.match(report.interaction ?? "", /hold Ctrl\+Space/);
  assert.ok(report.missing.some((item) => item.includes("embedded hosts must inject")));
});
