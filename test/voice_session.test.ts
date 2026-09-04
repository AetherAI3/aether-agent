import assert from "node:assert/strict";
import { test } from "node:test";

import { HttpError } from "../src/core/errors.js";
import {
  DEFAULT_VOICE_SETTINGS,
  type AgentVoiceCallbacks,
  type AgentVoiceBridge,
  type CapturedAudio,
  type SynthesizedAudio,
  type VoiceCapturePort,
  type VoiceContextHints,
  type VoicePlaybackPort,
  type VoiceTransport,
} from "../src/core/voice.js";
import {
  VoiceSessionController,
  VoiceSessionDisposedError,
  type VoiceSessionTimeouts,
  type VoiceSessionFailure,
} from "../src/core/voice_session.js";

const recordedAudio: CapturedAudio = {
  bytes: new Uint8Array([1, 2, 3]),
  mime: "audio/webm",
  durationSeconds: 0.8,
};
const spokenAudio: SynthesizedAudio = {
  bytes: new Uint8Array([9, 8]),
  mime: "audio/mpeg",
  model: "fake-voice",
};

const settings = (overrides: Partial<typeof DEFAULT_VOICE_SETTINGS> = {}) => ({
  ...DEFAULT_VOICE_SETTINGS,
  enabled: true,
  ...overrides,
});

class FakeCapture implements VoiceCapturePort {
  readonly id = "fake-capture";
  permissionCalls = 0;
  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;
  disposeCalls = 0;
  permissionError: unknown;
  permissionWait: Promise<void> | undefined;
  startWait: Promise<void> | undefined;
  stopWait: Promise<CapturedAudio> | undefined;
  startError: unknown;
  stopError: unknown;
  lastStoppedAudio: CapturedAudio | undefined;
  readonly starts: Array<{ signal: AbortSignal; hints?: VoiceContextHints }> = [];
  readonly allPartialCallbacks: Array<(text: string) => void> = [];
  readonly allLostCallbacks: Array<(message: string) => void> = [];
  private readonly partialCallbacks = new Set<(text: string) => void>();
  private readonly lostCallbacks = new Set<(message: string) => void>();

  constructor(private readonly events?: string[]) {}

  async requestPermission(): Promise<void> {
    this.permissionCalls++;
    if (this.permissionWait) await this.permissionWait;
    if (this.permissionError) throw this.permissionError;
  }

  async start(options: { signal: AbortSignal; hints?: VoiceContextHints }): Promise<void> {
    this.startCalls++;
    this.events?.push(`start-${this.startCalls}`);
    this.starts.push(options);
    if (this.startWait) await this.startWait;
    if (this.startError) throw this.startError;
  }

  async stop(): Promise<CapturedAudio> {
    this.stopCalls++;
    if (this.stopWait) return this.stopWait;
    if (this.stopError) throw this.stopError;
    this.lastStoppedAudio = { ...recordedAudio, bytes: recordedAudio.bytes.slice() };
    return this.lastStoppedAudio;
  }

  abort(): void {
    this.abortCalls++;
    this.events?.push("capture");
  }

  onPartial(callback: (text: string) => void): () => void {
    this.partialCallbacks.add(callback);
    this.allPartialCallbacks.push(callback);
    return () => this.partialCallbacks.delete(callback);
  }

  onLost(callback: (message: string) => void): () => void {
    this.lostCallbacks.add(callback);
    this.allLostCallbacks.push(callback);
    return () => this.lostCallbacks.delete(callback);
  }

  emitPartial(text: string): void {
    for (const callback of this.partialCallbacks) callback(text);
  }

  emitLost(message: string): void {
    for (const callback of this.lostCallbacks) callback(message);
  }

  dispose(): void {
    this.disposeCalls++;
  }
}

class FakePlayback implements VoicePlaybackPort {
  readonly id = "fake-playback";
  readonly played: SynthesizedAudio[] = [];
  stopCalls = 0;
  disposeCalls = 0;

  constructor(
    private readonly events?: string[],
    private readonly playImpl?: (audio: SynthesizedAudio, signal: AbortSignal) => Promise<void>,
  ) {}

  async play(audio: SynthesizedAudio, signal: AbortSignal): Promise<void> {
    this.played.push(audio);
    this.events?.push("playback-play");
    await this.playImpl?.(audio, signal);
  }

  stop(): void {
    this.stopCalls++;
    this.events?.push("playback");
  }

  dispose(): void {
    this.disposeCalls++;
  }
}

class FakeBridge implements AgentVoiceBridge {
  readonly sends: Array<{ text: string; callbacks: AgentVoiceCallbacks }> = [];

  constructor(private readonly onSend?: (text: string, callbacks: AgentVoiceCallbacks) => void | Promise<void>) {}

  send(text: string, callbacks: AgentVoiceCallbacks): void | Promise<void> {
    this.sends.push({ text, callbacks });
    return this.onSend?.(text, callbacks);
  }
}

function transport(
  transcribe: VoiceTransport["transcribe"],
  synthesize: VoiceTransport["synthesize"] = async () => spokenAudio,
): VoiceTransport {
  return { transcribe, synthesize };
}

function aborted(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const fastTimeouts = (overrides: Partial<VoiceSessionTimeouts> = {}): Partial<VoiceSessionTimeouts> => ({
  permissionMs: 25,
  captureStartMs: 25,
  captureStopMs: 25,
  transcriptionMs: 25,
  agentMs: 25,
  synthesisMs: 25,
  playbackMs: 25,
  adapterDrainMs: 50,
  idleMs: 250,
  ...overrides,
});

test("capture starts only after explicit enable and permission", async () => {
  const disabledCapture = new FakeCapture();
  const disabled = new VoiceSessionController({
    capture: disabledCapture,
    transport: transport(async () => "unused"),
    playback: new FakePlayback(),
    bridge: new FakeBridge(),
    settings: settings({ enabled: false }),
  });
  assert.equal(disabledCapture.permissionCalls, 0);
  assert.equal(disabledCapture.startCalls, 0);
  assert.equal(await disabled.start(), false);
  assert.equal(disabledCapture.permissionCalls, 0);
  assert.equal(disabledCapture.startCalls, 0);
  assert.equal(disabled.snapshot.typedInputAvailable, true);
  assert.equal(disabled.snapshot.failure?.kind, "gated");

  const deniedCapture = new FakeCapture();
  deniedCapture.permissionError = new Error("permission denied");
  const failures: VoiceSessionFailure[] = [];
  const denied = new VoiceSessionController({
    capture: deniedCapture,
    transport: transport(async () => "unused"),
    playback: new FakePlayback(),
    bridge: new FakeBridge(),
    settings: settings(),
    callbacks: { onFailure: (failure) => failures.push(failure) },
  });
  assert.equal(deniedCapture.startCalls, 0, "construction is side-effect free");
  assert.equal(await denied.start(), false);
  assert.equal(deniedCapture.permissionCalls, 1);
  assert.equal(deniedCapture.startCalls, 0);
  assert.equal(failures.at(-1)?.kind, "mic_denied");
  assert.equal(denied.snapshot.typedInputAvailable, true);
});

test("partials and final recognition stay visible and final speech uses the injected send path exactly once", async () => {
  const capture = new FakeCapture();
  const playback = new FakePlayback();
  const bridge = new FakeBridge();
  const partials: string[] = [];
  const finals: string[] = [];
  const deltas: string[] = [];
  const synthesized: string[] = [];
  const session = new VoiceSessionController({
    capture,
    transport: transport(
      async () => " open the lifecycle file ",
      async (text) => {
        synthesized.push(text);
        return spokenAudio;
      },
    ),
    playback,
    bridge,
    settings: settings(),
    callbacks: {
      onPartialTranscript: (text) => partials.push(text),
      onFinalTranscript: (text) => finals.push(text),
      onAgentDelta: (text) => deltas.push(text),
    },
  });

  assert.equal(await session.start("push"), true);
  capture.emitPartial("open the life");
  assert.equal(await session.finishCapture(), "open the lifecycle file");
  assert.deepEqual(partials, ["open the life"]);
  assert.deepEqual(finals, ["open the lifecycle file"]);
  assert.equal(bridge.sends.length, 1);
  assert.equal(bridge.sends[0]?.text, "open the lifecycle file");
  bridge.sends[0]?.callbacks.onDelta("answer remains visible");
  bridge.sends[0]?.callbacks.onDone();
  await session.whenIdle();

  assert.deepEqual(deltas, ["answer remains visible"]);
  assert.deepEqual(synthesized, ["answer remains visible"]);
  assert.equal(playback.played.length, 1);
  assert.equal(session.snapshot.machine.state, "idle");
  assert.equal(session.snapshot.visibleTranscript, "open the lifecycle file");
  assert.equal(session.resources().total, 0);
  session.assertPlaybackSettled();
});

test("STT 402 preserves the last visible recognition and gives UVT guidance without a local switch", async () => {
  const capture = new FakeCapture();
  const playback = new FakePlayback();
  const bridge = new FakeBridge();
  const failures: VoiceSessionFailure[] = [];
  const session = new VoiceSessionController({
    capture,
    transport: transport(async () => {
      throw new HttpError(402, "HTTP 402: insufficient UVT\u001b]52;c;payload\u0007");
    }),
    playback,
    bridge,
    settings: settings(),
    callbacks: { onFailure: (failure) => failures.push(failure) },
  });

  await session.start("push");
  capture.emitPartial("preserve this request");
  assert.equal(await session.finishCapture(), null);
  const failure = failures.at(-1);
  assert.equal(failure?.stage, "stt");
  assert.equal(failure?.kind, "stt_failed");
  assert.equal(failure?.status, 402);
  assert.match(failure?.hint ?? "", /UVT.*typed input.*no local STT switch/i);
  assert.doesNotMatch(failure?.message ?? "", /\u001b|\u0007/);
  assert.equal(failure?.visibleTranscript, "preserve this request");
  assert.equal(session.snapshot.visibleTranscript, "preserve this request");
  assert.equal(session.snapshot.machine.state, "idle");
  assert.equal(session.snapshot.typedInputAvailable, true);
  assert.equal(bridge.sends.length, 0);
  assert.equal(playback.played.length, 0);
  assert.equal(session.resources().total, 0);
  session.assertPlaybackSettled();
});

test("TTS 503 degrades independently after the complete text answer", async () => {
  const capture = new FakeCapture();
  const playback = new FakePlayback();
  const bridge = new FakeBridge();
  const deltas: string[] = [];
  const failures: VoiceSessionFailure[] = [];
  const session = new VoiceSessionController({
    capture,
    transport: transport(
      async () => "run tests",
      async () => {
        throw new HttpError(503, "HTTP 503: voice provider unavailable");
      },
    ),
    playback,
    bridge,
    settings: settings(),
    callbacks: {
      onAgentDelta: (delta) => deltas.push(delta),
      onFailure: (failure) => failures.push(failure),
    },
  });

  await session.start("push");
  await session.finishCapture();
  bridge.sends[0]?.callbacks.onDelta("the tests passed");
  bridge.sends[0]?.callbacks.onDone();
  await session.whenIdle();

  assert.deepEqual(deltas, ["the tests passed"]);
  assert.equal(failures.at(-1)?.stage, "tts");
  assert.equal(failures.at(-1)?.kind, "tts_failed");
  assert.equal(failures.at(-1)?.status, 503);
  assert.match(failures.at(-1)?.hint ?? "", /answer remains available as text/i);
  assert.equal(session.snapshot.visibleTranscript, "run tests");
  assert.equal(session.snapshot.machine.state, "idle");
  assert.equal(playback.played.length, 0);
  assert.equal(session.resources().total, 0);
  session.assertPlaybackSettled();
});

test("playback rejection is degraded independently and its allocation is retired", async () => {
  const capture = new FakeCapture();
  const playback = new FakePlayback(undefined, async () => {
    throw new Error("audio device disappeared");
  });
  const bridge = new FakeBridge();
  const failures: VoiceSessionFailure[] = [];
  const session = new VoiceSessionController({
    capture,
    transport: transport(async () => "speak this"),
    playback,
    bridge,
    settings: settings(),
    callbacks: { onFailure: (failure) => failures.push(failure) },
  });

  await session.start("push");
  await session.finishCapture();
  bridge.sends[0]?.callbacks.onDelta("readable answer");
  bridge.sends[0]?.callbacks.onDone();
  await session.whenIdle();

  assert.equal(failures.at(-1)?.stage, "playback");
  assert.equal(failures.at(-1)?.kind, "tts_failed");
  assert.match(failures.at(-1)?.hint ?? "", /answer remains available as text/i);
  assert.equal(session.snapshot.visibleTranscript, "speak this");
  assert.equal(session.resources().total, 0);
  session.assertPlaybackSettled();
});

test("cancellation aborts capture then transcription then playback and ignores the late result", async () => {
  const events: string[] = [];
  const capture = new FakeCapture(events);
  const playback = new FakePlayback(events);
  let releaseTranscription: (() => void) | undefined;
  const session = new VoiceSessionController({
    capture,
    transport: transport((_audio, options) => new Promise<string>((resolve, reject) => {
      releaseTranscription = () => resolve("late transcript");
      options.signal.addEventListener("abort", () => {
        events.push("transcription");
        reject(aborted());
      }, { once: true });
    })),
    playback,
    bridge: new FakeBridge(),
    settings: settings(),
  });

  await session.start("push");
  const finishing = session.finishCapture();
  await nextTask();
  events.length = 0;
  session.cancel();
  releaseTranscription?.();
  assert.equal(await finishing, null);
  assert.deepEqual(events, ["capture", "transcription", "playback"]);
  assert.equal(session.snapshot.machine.state, "idle");
  assert.equal(session.snapshot.typedInputAvailable, true);
  await nextTask();
  assert.equal(session.resources().total, 0);
  session.assertPlaybackSettled();
});

test("barge-in stops playback, synthesis, the previous stream, and capture in order before the next capture", async () => {
  const events: string[] = [];
  const capture = new FakeCapture(events);
  const playback = new FakePlayback(events);
  const bridge = new FakeBridge();
  let transcription = 0;
  let synthesis = 0;
  const session = new VoiceSessionController({
    capture,
    transport: transport(
      async () => (++transcription === 1 ? "first request" : "second request"),
      async (_text, options) => {
        synthesis++;
        if (synthesis > 1) return spokenAudio;
        return new Promise<SynthesizedAudio>((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            events.push("synthesis");
            reject(aborted());
          }, { once: true });
        });
      },
    ),
    playback,
    bridge,
    settings: settings(),
  });

  await session.start("push");
  await session.finishCapture();
  bridge.sends[0]?.callbacks.signal.addEventListener("abort", () => events.push("agent"), { once: true });
  bridge.sends[0]?.callbacks.onDelta("first answer");
  bridge.sends[0]?.callbacks.onDone();
  await nextTask();

  events.length = 0;
  assert.equal(await session.bargeIn(), true);
  assert.deepEqual(events, ["playback", "synthesis", "agent", "capture", "start-2"]);
  assert.equal(capture.permissionCalls, 1, "barge-in reuses this mounted session's explicit permission");

  await session.finishCapture();
  assert.equal(bridge.sends[1]?.text, "second request");
  assert.equal(bridge.sends[1]?.callbacks.interruptedPrevious, true);
  bridge.sends[1]?.callbacks.onDelta("second answer");
  bridge.sends[1]?.callbacks.onDone();
  await session.whenIdle();
  assert.equal(session.snapshot.machine.state, "idle");
  assert.equal(session.resources().total, 0);
  session.assertPlaybackSettled();
});

test("barge-in cannot duplicate an in-flight permission request", async () => {
  const capture = new FakeCapture();
  let allowPermission: (() => void) | undefined;
  capture.permissionWait = new Promise<void>((resolve) => { allowPermission = resolve; });
  const session = new VoiceSessionController({
    capture,
    transport: transport(async () => "request"),
    playback: new FakePlayback(),
    bridge: new FakeBridge(),
    settings: settings(),
  });
  const starting = session.start("push");
  await nextTask();
  assert.equal(session.snapshot.machine.state, "connecting");
  assert.equal(await session.bargeIn(), false);
  assert.equal(capture.permissionCalls, 1);
  assert.equal(session.resources().adapterOperations, 1);
  allowPermission?.();
  assert.equal(await starting, true);
  session.cancel();
  assert.equal(session.resources().total, 0);
});

test("permission and capture-start providers that never settle are bounded without hiding their ownership", async () => {
  for (const stage of ["permission", "capture-start"] as const) {
    const capture = new FakeCapture();
    let release: (() => void) | undefined;
    const ignored = new Promise<void>((resolve) => { release = resolve; });
    if (stage === "permission") capture.permissionWait = ignored;
    else capture.startWait = ignored;
    const failures: VoiceSessionFailure[] = [];
    const session = new VoiceSessionController({
      capture,
      transport: transport(async () => "unused"),
      playback: new FakePlayback(),
      bridge: new FakeBridge(),
      settings: settings(),
      timeouts: fastTimeouts(),
      callbacks: { onFailure: (failure) => failures.push(failure) },
    });

    assert.equal(await session.start("push"), false, `${stage} start did not settle at its bound`);
    assert.match(failures.at(-1)?.message ?? "", /stalled.*cancelled.*safe to retry/i);
    assert.equal(session.resources().lifecycleTimers, 1, "one bounded adapter-drain lease remains");
    assert.equal(session.resources().adapterOperations, 1, "the ignored provider remains truthfully owned");
    assert.ok(capture.abortCalls >= 1);
    release?.();
    await nextTask();
    assert.equal(session.resources().total, 0);
  }
});

test("capture stop is bounded and late raw audio is wiped when the adapter eventually returns", async () => {
  const capture = new FakeCapture();
  let releaseStop: ((audio: CapturedAudio) => void) | undefined;
  capture.stopWait = new Promise<CapturedAudio>((resolve) => { releaseStop = resolve; });
  const failures: VoiceSessionFailure[] = [];
  const session = new VoiceSessionController({
    capture,
    transport: transport(async () => "must not transcribe"),
    playback: new FakePlayback(),
    bridge: new FakeBridge(),
    settings: settings(),
    timeouts: fastTimeouts(),
    callbacks: { onFailure: (failure) => failures.push(failure) },
  });

  await session.start("push");
  assert.equal(await session.finishCapture(), null);
  assert.equal(failures.at(-1)?.stage, "capture");
  assert.equal(session.resources().adapterOperations, 1);
  const lateAudio: CapturedAudio = { ...recordedAudio, bytes: recordedAudio.bytes.slice() };
  releaseStop?.(lateAudio);
  await nextTask();
  assert.deepEqual([...lateAudio.bytes], [0, 0, 0]);
  assert.equal(session.resources().total, 0);
});

test("ignored-abort transcription is bounded, preserves text UI, and wipes its captured bytes", async () => {
  const capture = new FakeCapture();
  let releaseTranscription: ((text: string) => void) | undefined;
  const failures: VoiceSessionFailure[] = [];
  const session = new VoiceSessionController({
    capture,
    transport: transport(() => new Promise<string>((resolve) => { releaseTranscription = resolve; })),
    playback: new FakePlayback(),
    bridge: new FakeBridge(),
    settings: settings(),
    timeouts: fastTimeouts(),
    callbacks: { onFailure: (failure) => failures.push(failure) },
  });

  await session.start("push");
  capture.emitPartial("keep this partial");
  assert.equal(await session.finishCapture(), null);
  assert.equal(failures.at(-1)?.stage, "stt");
  assert.equal(session.snapshot.visibleTranscript, "keep this partial");
  assert.deepEqual([...(capture.lastStoppedAudio?.bytes ?? [])], [0, 0, 0]);
  assert.equal(session.resources().adapterOperations, 1);
  assert.equal(session.resources().pendingTasks, 0);
  releaseTranscription?.("late transcript");
  await nextTask();
  assert.equal(session.resources().total, 0);
});

test("agent callback silence is a bounded visible failure and whenIdle cannot hang", async () => {
  const failures: VoiceSessionFailure[] = [];
  let releaseDispatch: (() => void) | undefined;
  const bridge = new FakeBridge(() => new Promise<void>((resolve) => { releaseDispatch = resolve; }));
  const session = new VoiceSessionController({
    capture: new FakeCapture(),
    transport: transport(async () => "wait for an answer"),
    playback: new FakePlayback(),
    bridge,
    settings: settings({ speechOutput: false }),
    timeouts: fastTimeouts(),
    callbacks: { onFailure: (failure) => failures.push(failure) },
  });

  await session.start("push");
  await session.finishCapture();
  assert.equal(session.resources().adapterOperations, 1, "the bridge dispatch is owned before its drain bound");
  // Cosmetic callback traffic must not postpone the meaningful-progress deadline.
  const cosmetic = setInterval(() => bridge.sends[0]?.callbacks.onDelta(" \u0000\u200b"), 5);
  try {
    await session.whenIdle();
  } finally {
    clearInterval(cosmetic);
  }
  assert.equal(failures.at(-1)?.stage, "agent");
  assert.match(failures.at(-1)?.message ?? "", /agent stream stalled/i);
  assert.equal(session.snapshot.machine.state, "idle");
  assert.equal(session.resources().adapterOperations, 0, "the ignored bridge dispatch detached at its bounded drain");
  releaseDispatch?.();
  await nextTask();
  assert.equal(session.resources().total, 0);
});

test("ignored-abort synthesis times out logically while its provider operation stays accounted", async () => {
  let releaseSynthesis: ((audio: SynthesizedAudio) => void) | undefined;
  const bridge = new FakeBridge();
  const failures: VoiceSessionFailure[] = [];
  const session = new VoiceSessionController({
    capture: new FakeCapture(),
    transport: transport(
      async () => "speak",
      () => new Promise<SynthesizedAudio>((resolve) => { releaseSynthesis = resolve; }),
    ),
    playback: new FakePlayback(),
    bridge,
    settings: settings(),
    timeouts: fastTimeouts(),
    callbacks: { onFailure: (failure) => failures.push(failure) },
  });

  await session.start("push");
  await session.finishCapture();
  bridge.sends[0]?.callbacks.onDelta("complete text answer");
  bridge.sends[0]?.callbacks.onDone();
  await nextTask();
  assert.equal(session.resources().adapterOperations, 1, "the live synthesis provider is accounted");
  await session.whenIdle();
  assert.equal(failures.at(-1)?.stage, "tts");
  assert.equal(session.resources().pendingTasks, 0);
  assert.equal(session.resources().playbackAllocations, 0);
  assert.equal(session.resources().lifecycleTimers, 0);
  assert.equal(session.resources().adapterOperations, 0, "whenIdle waits through the bounded adapter drain");
  releaseSynthesis?.(spokenAudio);
  await nextTask();
  assert.equal(session.resources().total, 0);
  session.assertPlaybackSettled();
});

test("ignored-abort playback is bounded, stopped, and cannot strand the queue", async () => {
  let releasePlayback: (() => void) | undefined;
  const playback = new FakePlayback(undefined, () => new Promise<void>((resolve) => { releasePlayback = resolve; }));
  const bridge = new FakeBridge();
  const failures: VoiceSessionFailure[] = [];
  const session = new VoiceSessionController({
    capture: new FakeCapture(),
    transport: transport(async () => "play this"),
    playback,
    bridge,
    settings: settings(),
    timeouts: fastTimeouts(),
    callbacks: { onFailure: (failure) => failures.push(failure) },
  });

  await session.start("push");
  await session.finishCapture();
  bridge.sends[0]?.callbacks.onDelta("complete text answer");
  bridge.sends[0]?.callbacks.onDone();
  await nextTask();
  assert.equal(session.resources().adapterOperations, 1, "the live playback provider is accounted");
  await session.whenIdle();
  assert.equal(failures.at(-1)?.stage, "playback");
  assert.ok(playback.stopCalls >= 1);
  assert.equal(session.resources().pendingTasks, 0);
  assert.equal(session.resources().playbackAllocations, 0);
  assert.equal(session.resources().adapterOperations, 0);
  session.assertPlaybackSettled();
  releasePlayback?.();
  await nextTask();
  assert.equal(session.resources().total, 0);
});

test("cancel accounts for ignored-abort synthesis until it settles or reaches the bounded drain", async () => {
  const capture = new FakeCapture();
  const playback = new FakePlayback();
  const bridge = new FakeBridge();
  let releaseSynthesis: ((audio: SynthesizedAudio) => void) | undefined;
  const session = new VoiceSessionController({
    capture,
    transport: transport(
      async () => "speak",
      async () => new Promise<SynthesizedAudio>((resolve) => { releaseSynthesis = resolve; }),
    ),
    playback,
    bridge,
    settings: settings(),
    timeouts: fastTimeouts(),
  });
  await session.start("push");
  await session.finishCapture();
  bridge.sends[0]?.callbacks.onDelta("answer");
  bridge.sends[0]?.callbacks.onDone();
  await nextTask();
  session.cancel();
  assert.ok(session.resources().adapterOperations > 0);
  await session.whenIdle();
  assert.equal(session.resources().pendingTasks, 0);
  assert.equal(session.resources().adapterOperations, 0);
  assert.equal(session.resources().playbackAllocations, 0);
  assert.equal(playback.played.length, 0);
  releaseSynthesis?.(spokenAudio);
  await nextTask();
  assert.equal(session.resources().total, 0);
  session.assertPlaybackSettled();
});

test("an explicitly started conversation resumes capture after a turn and cancel returns it to idle", async () => {
  const capture = new FakeCapture();
  const bridge = new FakeBridge((_text, callbacks) => callbacks.onDone());
  const session = new VoiceSessionController({
    capture,
    transport: transport(async () => "conversation request"),
    playback: new FakePlayback(),
    bridge,
    settings: settings({ interactionMode: "conversation", speechOutput: false }),
  });

  assert.equal(await session.start(), true);
  assert.equal(capture.permissionCalls, 1);
  await session.finishCapture();
  await session.whenIdle();
  assert.equal(session.snapshot.machine.state, "listening");
  assert.equal(capture.startCalls, 2, "the granted conversation session resumed capture");
  assert.equal(capture.permissionCalls, 1, "continuous conversation did not reopen the permission prompt");

  session.cancel();
  assert.equal(session.snapshot.machine.state, "idle");
  assert.equal(session.resources().total, 0);
  session.assertPlaybackSettled();
});

test("dispose is idempotent and stale capture/agent callbacks cannot remount state", async () => {
  const capture = new FakeCapture();
  const playback = new FakePlayback();
  const bridge = new FakeBridge();
  const partials: string[] = [];
  const deltas: string[] = [];
  const failures: VoiceSessionFailure[] = [];
  const session = new VoiceSessionController({
    capture,
    transport: transport(async () => "dispose me"),
    playback,
    bridge,
    settings: settings(),
    callbacks: {
      onPartialTranscript: (text) => partials.push(text),
      onAgentDelta: (text) => deltas.push(text),
      onFailure: (failure) => failures.push(failure),
    },
  });

  await session.start("push");
  const stalePartial = capture.allPartialCallbacks[0];
  await session.finishCapture();
  const staleAgent = bridge.sends[0]?.callbacks;
  session.dispose();
  session.dispose();
  stalePartial?.("late partial");
  staleAgent?.onDelta("late delta");
  staleAgent?.onDone();
  staleAgent?.onError("late error");
  await nextTask();

  assert.deepEqual(partials, []);
  assert.deepEqual(deltas, []);
  assert.deepEqual(failures, []);
  assert.equal(capture.disposeCalls, 1);
  assert.equal(playback.disposeCalls, 1);
  assert.equal(session.snapshot.disposed, true);
  assert.equal(session.snapshot.typedInputAvailable, true);
  assert.equal(session.resources().total, 0);
  await assert.rejects(() => session.start(), VoiceSessionDisposedError);
});

test("100 deterministic start/cancel-or-complete cycles leave zero ephemeral controller resources", async () => {
  const capture = new FakeCapture();
  const playback = new FakePlayback();
  const bridge = new FakeBridge((_text, callbacks) => {
    callbacks.onDelta("ok");
    callbacks.onDone();
  });
  const session = new VoiceSessionController({
    capture,
    transport: transport(async () => "cycle request"),
    playback,
    bridge,
    settings: settings({ speechOutput: false }),
  });
  const baseline = session.resources();

  for (let index = 0; index < 100; index++) {
    assert.equal(await session.start("push"), true);
    if (index % 2 === 0) {
      capture.emitPartial(`cycle ${index}`);
      await session.finishCapture();
      await session.whenIdle();
    } else {
      session.cancel();
    }
    assert.equal(session.snapshot.machine.state, "idle", `cycle ${index} did not return to idle`);
    assert.deepEqual(session.resources(), baseline, `cycle ${index} leaked an ephemeral resource`);
    session.assertPlaybackSettled();
  }

  assert.equal(capture.permissionCalls, 100);
  assert.equal(capture.startCalls, 100);
  assert.equal(capture.stopCalls, 50);
  assert.equal(bridge.sends.length, 50);
});
