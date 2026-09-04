import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AETHER_VOICE_CLOUD_SHA,
  DEFAULT_VOICE_SETTINGS,
  VoicePlaybackQueue,
  initialVoiceMachine,
  reduceVoice,
  terminalVoiceState,
  validateVoiceSettings,
  type SynthesizedAudio,
  type VoicePlaybackPort,
} from "../src/core/voice.js";

const audio = (model: string): SynthesizedAudio => ({ bytes: new Uint8Array([1]), mime: "audio/wav", model });

test("voice contract is pinned to the inspected Cloud head", () => {
  assert.match(AETHER_VOICE_CLOUD_SHA, /^[0-9a-f]{40}$/);
});

test("voice is default-off and unsupported capture is rendered as degraded, never ready", () => {
  assert.equal(
    terminalVoiceState({ ...initialVoiceMachine }, DEFAULT_VOICE_SETTINGS, { audioInput: false, audioOutput: false }),
    "off",
  );
  assert.equal(
    terminalVoiceState(
      { ...initialVoiceMachine },
      { enabled: true },
      { audioInput: false, audioOutput: true },
    ),
    "degraded",
  );
});

test("Cloud-compatible reducer commits speech into thinking and ignores late partials", () => {
  let machine = reduceVoice({ ...initialVoiceMachine }, { type: "START", mode: "push" });
  machine = reduceVoice(machine, { type: "MIC_READY" });
  machine = reduceVoice(machine, { type: "SPEECH_START" });
  machine = reduceVoice(machine, { type: "PARTIAL", text: "hel" });
  machine = reduceVoice(machine, { type: "SPEECH_END" });
  machine = reduceVoice(machine, { type: "FINAL", text: " hello " });
  assert.equal(machine.state, "thinking");
  assert.equal(machine.committed, "hello");
  assert.equal(machine.turn, 1);
  assert.equal(reduceVoice(machine, { type: "PARTIAL", text: "late" }), machine);
});

test("STOP is unconditional and idempotent; TTS failure does not erase committed text", () => {
  const speaking = {
    ...initialVoiceMachine,
    state: "speaking" as const,
    mode: "conversation" as const,
    committed: "answer remains visible",
  };
  const degraded = reduceVoice(speaking, { type: "PROVIDER_ERROR", kind: "tts_failed", message: "audio unavailable" });
  assert.equal(degraded.state, "listening");
  assert.equal(degraded.committed, "answer remains visible");
  const stopped = reduceVoice(degraded, { type: "STOP" });
  assert.deepEqual(reduceVoice(stopped, { type: "STOP" }), stopped);
});

test("voice settings reject hidden coercion and enforce the Cloud EOT bounds", () => {
  const valid = validateVoiceSettings({ ...DEFAULT_VOICE_SETTINGS });
  assert.equal(valid.ok, true);
  assert.equal(valid.value?.endOfTurnSilenceMs, 900);
  const invalid = validateVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: "yes", endOfTurnSilenceMs: 399 });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join("; "), /enabled must be boolean/);
  assert.match(invalid.errors.join("; "), /400 to 3000/);
});

test("playback queue preserves allocation order and skip retires a self-playing slot", async () => {
  const played: string[] = [];
  const port: VoicePlaybackPort = {
    id: "fake",
    async play(item) {
      played.push(item.model);
    },
    stop() {},
    dispose() {},
  };
  const queue = new VoicePlaybackQueue(port);
  const first = queue.allocate();
  const selfPlaying = queue.allocate();
  const third = queue.allocate();
  queue.enqueue(third, audio("third"));
  queue.enqueue(first, audio("first"));
  queue.skip(selfPlaying);
  await queue.whenIdle();
  queue.assertSettled();
  assert.deepEqual(played, ["first", "third"]);
});

test("playback queue names an unretired gap and disposal is idempotent", async () => {
  let disposed = 0;
  const port: VoicePlaybackPort = {
    id: "fake",
    async play() {},
    stop() {},
    dispose() {
      disposed++;
    },
  };
  const queue = new VoicePlaybackQueue(port);
  queue.allocate();
  const second = queue.allocate();
  queue.enqueue(second, audio("second"));
  await queue.whenIdle();
  assert.throws(() => queue.assertSettled(), /retire index\(es\): 0/);
  queue.dispose();
  queue.dispose();
  assert.equal(disposed, 1);
});
