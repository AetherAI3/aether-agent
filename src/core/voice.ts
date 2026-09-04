import type { TerminalCapabilities } from "./terminal_capabilities.js";

/** Frozen against the portable Voice contract committed in AETHER-CLOUD at
 * f91d677ece3c76c21a09db071ce796c5b2e8c6ea. Agent owns host adapters only;
 * provider routing, credentials, and billing remain server-side. */
export const AETHER_VOICE_CONTRACT = "aether.voice.portable.v1" as const;
export const AETHER_VOICE_CLOUD_SHA = "f91d677ece3c76c21a09db071ce796c5b2e8c6ea" as const;
export const VOICE_STT_PATH = "/agent/transcribe" as const;
export const VOICE_TTS_PATH = "/agent/voice/speak" as const;

export type CloudVoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "processing"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "error";

export type VoiceMode = "idle" | "conversation" | "push";

export type VoiceErrorKind =
  | "gated"
  | "mic_denied"
  | "mic_lost"
  | "stt_failed"
  | "tts_failed"
  | "agent_failed"
  | "disconnected"
  | "unsupported";

export type TerminalVoiceState =
  | "off"
  | "ready"
  | "requesting_permission"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "degraded"
  | "error";

export type VoiceProfile = "auto" | "clear" | "warm" | "bright";
export type VoiceInteractionMode = "push-to-talk" | "toggle-to-talk" | "conversation";
export type VoiceLocalFallback = "disabled" | "system";

export interface VoiceSettings {
  enabled: boolean;
  interactionMode: VoiceInteractionMode;
  hotkey: string;
  voiceProfile: VoiceProfile;
  speechOutput: boolean;
  partialTranscript: boolean;
  endOfTurnSilenceMs: number;
  localFallback: VoiceLocalFallback;
  /** Browser partials may use the browser vendor. This is deliberately
   * separate from final STT, which always uses the Aether route. */
  browserPartials: boolean;
}

export const DEFAULT_VOICE_SETTINGS: Readonly<VoiceSettings> = Object.freeze({
  enabled: false,
  interactionMode: "toggle-to-talk",
  hotkey: "Ctrl+Space",
  voiceProfile: "auto",
  speechOutput: true,
  partialTranscript: true,
  endOfTurnSilenceMs: 900,
  localFallback: "system",
  browserPartials: true,
});

export interface VoiceValidationResult {
  ok: boolean;
  errors: string[];
  value?: VoiceSettings;
}

const profiles: ReadonlySet<string> = new Set(["auto", "clear", "warm", "bright"]);
const interactions: ReadonlySet<string> = new Set(["push-to-talk", "toggle-to-talk", "conversation"]);
const fallbacks: ReadonlySet<string> = new Set(["disabled", "system"]);

/** Validate user-controlled Voice settings without coercing bad values into a
 * plausible configuration. */
export function validateVoiceSettings(value: unknown): VoiceValidationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["voice settings must be an object"] };
  }
  const input = value as Record<string, unknown>;
  const errors: string[] = [];
  const bool = (key: keyof VoiceSettings): boolean => {
    if (typeof input[key] !== "boolean") errors.push(`${key} must be boolean`);
    return input[key] === true;
  };
  if (!interactions.has(String(input["interactionMode"]))) {
    errors.push("interactionMode must be push-to-talk, toggle-to-talk, or conversation");
  }
  if (typeof input["hotkey"] !== "string" || !input["hotkey"].trim() || input["hotkey"].length > 64) {
    errors.push("hotkey must be a non-empty string of at most 64 characters");
  }
  if (!profiles.has(String(input["voiceProfile"]))) {
    errors.push("voiceProfile must be auto, clear, warm, or bright");
  }
  const endOfTurnSilenceMs = input["endOfTurnSilenceMs"];
  if (
    typeof endOfTurnSilenceMs !== "number" ||
    !Number.isInteger(endOfTurnSilenceMs) ||
    endOfTurnSilenceMs < 400 ||
    endOfTurnSilenceMs > 3000
  ) {
    errors.push("endOfTurnSilenceMs must be an integer from 400 to 3000");
  }
  if (!fallbacks.has(String(input["localFallback"]))) {
    errors.push("localFallback must be disabled or system");
  }
  const enabled = bool("enabled");
  const speechOutput = bool("speechOutput");
  const partialTranscript = bool("partialTranscript");
  const browserPartials = bool("browserPartials");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    value: {
      enabled,
      interactionMode: input["interactionMode"] as VoiceInteractionMode,
      hotkey: (input["hotkey"] as string).trim(),
      voiceProfile: input["voiceProfile"] as VoiceProfile,
      speechOutput,
      partialTranscript,
      endOfTurnSilenceMs: endOfTurnSilenceMs as number,
      localFallback: input["localFallback"] as VoiceLocalFallback,
      browserPartials,
    },
  };
}

export interface VoiceMachine {
  state: CloudVoiceState;
  mode: VoiceMode;
  partial: string;
  committed: string;
  error: string | null;
  errorKind: VoiceErrorKind | null;
  interruptedPrevious: boolean;
  turn: number;
  reconnects: number;
}

export type VoiceEvent =
  | { type: "START"; mode: Exclude<VoiceMode, "idle"> }
  | { type: "MIC_READY" }
  | { type: "MIC_DENIED"; message: string }
  | { type: "MIC_LOST"; message: string }
  | { type: "BARGE_IN" }
  | { type: "SPEECH_START" }
  | { type: "SPEECH_END" }
  | { type: "PARTIAL"; text: string }
  | { type: "FINAL"; text: string }
  | { type: "AGENT_FIRST_TOKEN" }
  | { type: "AUDIO_START" }
  | { type: "TURN_DONE" }
  | { type: "PROVIDER_ERROR"; kind: VoiceErrorKind; message: string }
  | { type: "RECONNECT" }
  | { type: "RECOVERED" }
  | { type: "STOP" };

export const initialVoiceMachine: Readonly<VoiceMachine> = Object.freeze({
  state: "idle",
  mode: "idle",
  partial: "",
  committed: "",
  error: null,
  errorKind: null,
  interruptedPrevious: false,
  turn: 0,
  reconnects: 0,
});

const listeningStates: ReadonlySet<CloudVoiceState> = new Set([
  "listening",
  "processing",
  "thinking",
  "speaking",
  "interrupted",
]);
const recoverableErrors: ReadonlySet<VoiceErrorKind> = new Set([
  "stt_failed",
  "tts_failed",
  "agent_failed",
  "disconnected",
]);
const idleMachine = (): VoiceMachine => ({ ...initialVoiceMachine });

/** Pure reducer kept transition-compatible with the Cloud Voice machine. Late
 * async events are ignored; STOP is unconditional and idempotent. */
export function reduceVoice(machine: VoiceMachine, event: VoiceEvent): VoiceMachine {
  if (event.type === "STOP") return idleMachine();
  switch (event.type) {
    case "START":
      if (machine.state !== "idle" && machine.state !== "error") return machine;
      return { ...idleMachine(), state: "connecting", mode: event.mode };
    case "MIC_READY":
      return machine.state === "connecting"
        ? { ...machine, state: "listening", error: null, errorKind: null }
        : machine;
    case "MIC_DENIED":
      return { ...machine, state: "error", mode: "idle", errorKind: "mic_denied", error: event.message };
    case "MIC_LOST":
      return { ...machine, state: "error", mode: "idle", errorKind: "mic_lost", error: event.message };
    case "BARGE_IN":
      return machine.state === "speaking" || machine.state === "thinking"
        ? { ...machine, state: "interrupted", partial: "", interruptedPrevious: true }
        : machine;
    case "SPEECH_START":
      return listeningStates.has(machine.state) ? { ...machine, state: "user_speaking", partial: "" } : machine;
    case "SPEECH_END":
      return machine.state === "user_speaking" ? { ...machine, state: "processing" } : machine;
    case "PARTIAL":
      return machine.state === "user_speaking" || machine.state === "processing"
        ? { ...machine, partial: event.text }
        : machine;
    case "FINAL": {
      if (machine.state !== "processing" && machine.state !== "user_speaking") return machine;
      const text = event.text.trim();
      if (!text) return machine.mode === "conversation" ? { ...machine, state: "listening", partial: "" } : idleMachine();
      return { ...machine, state: "thinking", partial: "", committed: text, turn: machine.turn + 1 };
    }
    case "AGENT_FIRST_TOKEN":
      return machine.state === "thinking" ? { ...machine, reconnects: 0 } : machine;
    case "AUDIO_START":
      return machine.state === "thinking" ? { ...machine, state: "speaking", interruptedPrevious: false } : machine;
    case "TURN_DONE":
      if (machine.state !== "speaking" && machine.state !== "thinking" && machine.state !== "interrupted") return machine;
      return machine.mode === "conversation"
        ? { ...machine, state: "listening", partial: "", interruptedPrevious: false }
        : idleMachine();
    case "PROVIDER_ERROR":
      if (recoverableErrors.has(event.kind)) {
        return machine.mode === "conversation"
          ? { ...machine, state: "listening", partial: "", error: event.message, errorKind: event.kind }
          : { ...idleMachine(), error: event.message, errorKind: event.kind };
      }
      return { ...machine, state: "error", mode: "idle", errorKind: event.kind, error: event.message };
    case "RECONNECT":
      return { ...machine, reconnects: machine.reconnects + 1 };
    case "RECOVERED":
      return { ...machine, reconnects: 0, error: null, errorKind: null };
  }
}

export function terminalVoiceState(
  machine: VoiceMachine,
  settings: Pick<VoiceSettings, "enabled">,
  capabilities: Pick<TerminalCapabilities, "audioInput" | "audioOutput">,
): TerminalVoiceState {
  if (!settings.enabled) return "off";
  if (!capabilities.audioInput) return "degraded";
  if (machine.errorKind === "tts_failed" && !capabilities.audioOutput) return "degraded";
  switch (machine.state) {
    case "idle":
      return machine.errorKind ? "degraded" : "ready";
    case "connecting":
      return "requesting_permission";
    case "listening":
    case "user_speaking":
      return "listening";
    case "processing":
      return "transcribing";
    case "thinking":
    case "speaking":
    case "interrupted":
    case "error":
      return machine.state;
  }
}

export interface VoiceContextHints {
  surface: string;
  terms: string[];
  pronunciations?: Readonly<Record<string, string>>;
  situation?: string;
}

export interface CapturedAudio {
  bytes: Uint8Array;
  mime: string;
  durationSeconds: number;
  filename?: string;
}

export interface VoiceCapturePort {
  readonly id: string;
  requestPermission(): Promise<void>;
  start(options: { signal: AbortSignal; hints?: VoiceContextHints }): Promise<void>;
  stop(): Promise<CapturedAudio>;
  abort(): void;
  onPartial(callback: (text: string) => void): () => void;
  onLost(callback: (message: string) => void): () => void;
  dispose(): void;
}

export interface SynthesizedAudio {
  bytes: Uint8Array;
  mime: string;
  model: string;
}

export interface VoiceTransport {
  transcribe(audio: CapturedAudio, options: { signal: AbortSignal; hints?: VoiceContextHints }): Promise<string>;
  synthesize(
    text: string,
    options: { signal: AbortSignal; voice: VoiceProfile; purpose: "conversation" | "chat" | "expressive" | "narration" },
  ): Promise<SynthesizedAudio>;
}

export interface VoicePlaybackPort {
  readonly id: string;
  play(audio: SynthesizedAudio, signal: AbortSignal): Promise<void>;
  stop(): void;
  dispose(): void;
}

export interface AgentVoiceCallbacks {
  signal: AbortSignal;
  interruptedPrevious: boolean;
  onDelta(text: string): void;
  onDone(): void;
  onError(message: string): void;
}

/** The host injects its existing send path so spoken text cannot fork the
 * conversation, transcript, tool, permission, memory, or billing policy. */
export interface AgentVoiceBridge {
  /** Callback-based hosts may return void. Async hosts may return their
   * dispatch promise so lifecycle ownership and rejection stay observable. */
  send(text: string, callbacks: AgentVoiceCallbacks): void | Promise<void>;
}

type QueueSlot = { kind: "audio"; audio: SynthesizedAudio } | { kind: "skip" };

export interface VoicePlaybackQueueOptions {
  /** Maximum time one host playback call may own the queue. */
  timeoutMs?: number;
  /** Grace period for an aborted host promise to settle before ownership is detached. */
  operationDrainMs?: number;
}

export interface VoicePlaybackQueueResources {
  pendingOperations: number;
  timers: number;
}

export class VoicePlaybackTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(
      `voice playback stalled after ${timeoutMs}ms; playback was stopped, the text answer remains available, ` +
        "and `aether voice doctor` can inspect audio output",
    );
    this.name = "VoicePlaybackTimeoutError";
  }
}

const DEFAULT_PLAYBACK_TIMEOUT_MS = 60_000;
const DEFAULT_OPERATION_DRAIN_MS = 2_000;

interface PlaybackOperationLease {
  abandoned: boolean;
  done: Promise<void>;
  resolveDone(): void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Concurrent synthesis may finish out of order. Every allocate() index must be
 * enqueue()d or skip()ped; otherwise assertSettled() names the exact gap. */
export class VoicePlaybackQueue {
  private allocated = 0;
  private next = 0;
  private readonly slots = new Map<number, QueueSlot>();
  private draining: Promise<void> | null = null;
  private current: AbortController | null = null;
  private disposed = false;
  private readonly timeoutMs: number;
  private readonly operationDrainMs: number;
  private readonly operations = new Map<Promise<void>, PlaybackOperationLease>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly playback: VoicePlaybackPort,
    options: VoicePlaybackQueueOptions = {},
  ) {
    this.timeoutMs = boundedPositiveTimeout(options.timeoutMs, DEFAULT_PLAYBACK_TIMEOUT_MS, "playback timeout");
    this.operationDrainMs = boundedPositiveTimeout(
      options.operationDrainMs,
      DEFAULT_OPERATION_DRAIN_MS,
      "playback operation drain timeout",
    );
  }

  allocate(): number {
    if (this.disposed) throw new Error("voice playback queue is disposed");
    return this.allocated++;
  }

  enqueue(index: number, audio: SynthesizedAudio): void {
    this.retire(index, { kind: "audio", audio });
  }

  skip(index: number): void {
    this.retire(index, { kind: "skip" });
  }

  private retire(index: number, slot: QueueSlot): void {
    if (this.disposed) throw new Error("voice playback queue is disposed");
    if (!Number.isInteger(index) || index < this.next || index >= this.allocated || this.slots.has(index)) {
      throw new Error(`invalid or duplicate voice playback index ${index}`);
    }
    this.slots.set(index, slot);
    this.schedule();
  }

  private schedule(): void {
    if (this.draining || !this.slots.has(this.next)) return;
    this.draining = this.drain().finally(() => {
      this.draining = null;
      if (this.slots.has(this.next)) this.schedule();
    });
  }

  private async drain(): Promise<void> {
    while (!this.disposed) {
      const slot = this.slots.get(this.next);
      if (!slot) return;
      this.slots.delete(this.next++);
      if (slot.kind === "skip") continue;
      const current = new AbortController();
      this.current = current;
      try {
        const operation = this.observeOperation(
          Promise.resolve().then(() => this.playback.play(slot.audio, current.signal)),
        );
        try {
          await this.awaitPlayback(operation, current);
        } catch (error) {
          this.abandonOperation(operation);
          throw error;
        }
      } finally {
        if (this.current === current) this.current = null;
      }
    }
  }

  async whenIdle(): Promise<void> {
    for (;;) {
      while (this.draining) await this.draining;
      const abandoned = [...this.operations.values()].filter((lease) => lease.abandoned).map((lease) => lease.done);
      if (abandoned.length === 0) return;
      await Promise.allSettled(abandoned);
    }
  }

  /** Logical idle is bounded; ignored host promises remain visible here until they really settle. */
  resources(): VoicePlaybackQueueResources {
    return { pendingOperations: this.operations.size, timers: this.timers.size };
  }

  assertSettled(): void {
    if (this.next !== this.allocated) {
      const missing: number[] = [];
      for (let index = this.next; index < this.allocated; index++) {
        if (!this.slots.has(index)) missing.push(index);
      }
      throw new Error(`voice playback sequence is incomplete; retire index(es): ${missing.join(", ")}`);
    }
  }

  cancel(): void {
    this.current?.abort();
    try {
      this.playback.stop();
    } catch {
      // Abort and logical queue retirement remain authoritative.
    }
    this.slots.clear();
    this.next = this.allocated;
    this.abandonAllOperations();
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    this.playback.dispose();
  }


  private awaitPlayback(operation: Promise<void>, current: AbortController): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let owner!: { finish(error?: unknown): void };
      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(timer);
          timer = null;
        }
        current.signal.removeEventListener("abort", onAbort);
      };
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error === undefined) resolve();
        else reject(error);
      };
      const onAbort = (): void => owner.finish(abortError());
      owner = { finish };

      if (current.signal.aborted) {
        finish(abortError());
        return;
      }
      current.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        const error = new VoicePlaybackTimeoutError(this.timeoutMs);
        // Reject the owned lifecycle before aborting so the timeout cannot be
        // misclassified as a user cancellation by the signal listener.
        owner.finish(error);
        current.abort();
        try {
          this.playback.stop();
        } catch {
          // The timeout is already authoritative; cleanup failures stay local.
        }
      }, this.timeoutMs);
      timer.unref?.();
      this.timers.add(timer);
      const ownerRef = new WeakRef(owner);
      void operation.then(
        () => ownerRef.deref()?.finish(),
        (error: unknown) => ownerRef.deref()?.finish(error),
      );
    });
  }

  private observeOperation(operation: Promise<void>): Promise<void> {
    let resolveDone!: () => void;
    const lease: PlaybackOperationLease = {
      abandoned: false,
      done: new Promise<void>((resolve) => { resolveDone = resolve; }),
      resolveDone: () => resolveDone(),
      timer: null,
    };
    this.operations.set(operation, lease);
    const operations = new WeakRef(this.operations);
    const timers = new WeakRef(this.timers);
    void operation.then(
      () => releasePlaybackOperation(operations, timers, operation),
      () => releasePlaybackOperation(operations, timers, operation),
    );
    return operation;
  }

  private abandonOperation(operation: Promise<void>): void {
    const lease = this.operations.get(operation);
    if (!lease || lease.abandoned) return;
    lease.abandoned = true;
    const operations = new WeakRef(this.operations);
    const timers = new WeakRef(this.timers);
    const timer = setTimeout(
      () => releasePlaybackOperation(operations, timers, operation),
      this.operationDrainMs,
    );
    timer.unref?.();
    lease.timer = timer;
    this.timers.add(timer);
  }

  private abandonAllOperations(): void {
    for (const operation of this.operations.keys()) this.abandonOperation(operation);
  }
}

function releasePlaybackOperation(
  operationsRef: WeakRef<Map<Promise<void>, PlaybackOperationLease>>,
  timersRef: WeakRef<Set<ReturnType<typeof setTimeout>>>,
  operation: Promise<void>,
): void {
  const operations = operationsRef.deref();
  const lease = operations?.get(operation);
  if (!operations || !lease) return;
  operations.delete(operation);
  if (lease.timer) {
    clearTimeout(lease.timer);
    timersRef.deref()?.delete(lease.timer);
    lease.timer = null;
  }
  lease.resolveDone();
}

function boundedPositiveTimeout(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > 3_600_000) {
    throw new RangeError(`${label} must be an integer from 1 to 3600000ms`);
  }
  return resolved;
}

function abortError(): Error {
  const error = new Error("voice operation was aborted");
  error.name = "AbortError";
  return error;
}
