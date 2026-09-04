import assert from "node:assert/strict";
import { test } from "node:test";

import { detectTerminalCapabilities } from "../src/core/terminal_capabilities.js";
import { DEFAULT_VOICE_SETTINGS } from "../src/core/voice.js";
import { visibleWidth } from "../src/ui/text.js";
import { voicePromoLines } from "../src/ui/voice_promo.js";

for (const [columns, rows] of [
  [20, 5],
  [40, 12],
  [80, 24],
  [120, 40],
  [200, 60],
] as const) {
  test(`voice promotion fits ${columns}x${rows}`, () => {
    const capabilities = detectTerminalCapabilities({
      host: "tty",
      stdinIsTTY: true,
      stdoutIsTTY: true,
      columns,
      rows,
      env: {},
    });
    const lines = voicePromoLines({ capabilities, settings: { ...DEFAULT_VOICE_SETTINGS }, state: "off" });
    assert.ok(lines.length >= 1);
    for (const line of lines) assert.ok(visibleWidth(line) <= columns, `${visibleWidth(line)} > ${columns}: ${line}`);
  });
}

test("TTY promotion never says hold and names missing capture honestly", () => {
  const capabilities = detectTerminalCapabilities({
    host: "tty",
    stdinIsTTY: true,
    stdoutIsTTY: true,
    columns: 100,
    rows: 30,
    env: {},
  });
  const text = voicePromoLines({ capabilities, settings: { ...DEFAULT_VOICE_SETTINGS }, state: "off" }).join("\n");
  assert.doesNotMatch(text, /hold/i);
  assert.match(text, /capture adapter unavailable/);
  assert.match(text, /\/voice doctor/);
});

test("embedded promotion uses true hold copy only after audio and key release are proven", () => {
  const capabilities = detectTerminalCapabilities({
    host: "electron",
    columns: 100,
    rows: 30,
    audioInput: true,
    audioOutput: true,
    keyReleaseEvents: true,
    env: {},
  });
  const text = voicePromoLines({ capabilities, settings: { ...DEFAULT_VOICE_SETTINGS }, state: "ready" }).join("\n");
  assert.match(text, /hold Ctrl\+Space to talk/);
  assert.doesNotMatch(text, /unavailable/);
});

test("promotion strips hostile hotkey controls", () => {
  const capabilities = detectTerminalCapabilities({
    host: "electron",
    columns: 100,
    rows: 30,
    audioInput: true,
    env: {},
  });
  const settings = { ...DEFAULT_VOICE_SETTINGS, hotkey: "Ctrl+X\u001b]0;owned\u0007" };
  const text = voicePromoLines({ capabilities, settings, state: "ready" }).join("\n");
  assert.doesNotMatch(text, /\u001b|owned/);
});
