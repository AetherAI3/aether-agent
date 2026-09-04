import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectTerminalCapabilities,
  terminalLayoutMode,
  voiceGesture,
} from "../src/core/terminal_capabilities.js";

test("non-TTY detection is headless and never invents audio/key-release support", () => {
  const capabilities = detectTerminalCapabilities({
    stdinIsTTY: false,
    stdoutIsTTY: false,
    columns: 0,
    rows: -2,
    env: {},
  });
  assert.deepEqual(capabilities, {
    host: "headless",
    columns: 80,
    rows: 24,
    color: false,
    unicode: true,
    mouse: false,
    keyReleaseEvents: false,
    audioInput: false,
    audioOutput: false,
  });
});

test("an embedder can prove xterm capabilities without platform guessing", () => {
  const capabilities = detectTerminalCapabilities({
    host: "xterm-web",
    columns: 120.9,
    rows: 40,
    mouse: true,
    keyReleaseEvents: true,
    audioInput: true,
    audioOutput: true,
    env: {},
  });
  assert.equal(capabilities.columns, 120);
  assert.equal(capabilities.keyReleaseEvents, true);
  assert.equal(capabilities.mouse, true);
  assert.equal(voiceGesture(capabilities, "Ctrl+Space"), "hold Ctrl+Space to talk");
});

test("an environment host label does not attest mouse or key-release support", () => {
  const capabilities = detectTerminalCapabilities({
    stdinIsTTY: true,
    stdoutIsTTY: true,
    audioInput: true,
    env: { AETHER_TERMINAL_HOST: "electron" },
  });
  assert.equal(capabilities.host, "electron");
  assert.equal(capabilities.mouse, false);
  assert.equal(capabilities.keyReleaseEvents, false);
  assert.equal(voiceGesture(capabilities, "Ctrl+Space"), "press Ctrl+Space to start/stop");
});

test("plain TTY copy says press-to-toggle, while missing audio advertises no gesture", () => {
  const tty = detectTerminalCapabilities({
    host: "tty",
    audioInput: true,
    stdinIsTTY: true,
    stdoutIsTTY: true,
    env: { NO_COLOR: "1", AETHER_ASCII: "1" },
  });
  assert.equal(tty.color, false);
  assert.equal(tty.unicode, false);
  assert.equal(voiceGesture(tty, "Ctrl+Space"), "press Ctrl+Space to start/stop");
  assert.equal(voiceGesture({ audioInput: false, keyReleaseEvents: true }, "Ctrl+Space"), null);
});

test("the required dimension matrix selects deliberate compact and wide modes", () => {
  assert.equal(terminalLayoutMode({ columns: 20, rows: 5 }), "emergency");
  assert.equal(terminalLayoutMode({ columns: 40, rows: 12 }), "narrow");
  assert.equal(terminalLayoutMode({ columns: 80, rows: 24 }), "normal");
  assert.equal(terminalLayoutMode({ columns: 120, rows: 40 }), "wide");
  assert.equal(terminalLayoutMode({ columns: 200, rows: 60 }), "wide");
});
