import { HttpError, errorMessage, isAbortError } from "./errors.js";
import { sanitizeServerText } from "./transport.js";
import {
  VoicePlaybackQueue,
  initialVoiceMachine,
  reduceVoice,
  type AgentVoiceBridge,
  type AgentVoiceCallbacks,
  type CapturedAudio,
  type VoiceCapturePort,
  type VoiceContextHints,
  type VoiceErrorKind,
  type VoiceEvent,
  type VoiceMachine,
  type VoiceMode,
  type VoicePlaybackPort,
  type VoiceSettings,
  type VoiceTransport,
} from "./voice.js";

export type VoiceSessionFailureStage =
  | "gate"
  | "permission"
  | "capture"
  | "stt"
  | "agent"
  | "tts"
  | "playback";

export interface VoiceSessionFailure {
  stage: VoiceSessionFailureStage;
  kind: VoiceErrorKind;
  message: string;
  hint: string;
  status?: number;
  recoverable: boolean;
  /** The last recognition text remains renderable when a provider fails. */
  visibleTranscript: string;
  /** Voice is additive. No failure is allowed to gate the normal input path. */
  typedInputAvailable: true;
}

export interface VoiceSessionSnapshot {
  machine: VoiceMachine;
  visibleTranscript: string;
  failure: VoiceSessionFailure | null;
  typedInputAvailable: true;
  disposed: boolean;
}

export interface VoiceSessionCallbacks {
  onState?(snapshot: VoiceSessionSnapshot): void;
  onPartialTranscript?(text: string): void;
  onFinalTranscript?(text: string): void;
  onAgentDelta?(text: string): void;
  onFailure?(failure: VoiceSessionFailure): void;
}

export interface VoiceSessionDependencies {
  capture: VoiceCapturePort;
  transport: VoiceTransport;
  playback: VoicePlaybackPort;
  bridge: AgentVoiceBridge;
  settings: VoiceSettings;
  hints?: VoiceContextHints | (() => VoiceContextHints | undefined);
  callbacks?: VoiceSessionCallbacks;
  /** Host lifecycle bounds. Defaults are conservative and every value remains bounded. */
  timeouts?: Partial<VoiceSessionTimeouts>;
}

export interface VoiceSessionTimeouts {
  permissionMs: number;
  captureStartMs: number;
  captureStopMs: number;
  transcriptionMs: number;
  agentMs: number;
  synthesisMs: number;
  playbackMs: number;
  adapterDrainMs: number;
  idleMs: number;
}

export const DEFAULT_VOICE_SESSION_TIMEOUTS: Readonly<VoiceSessionTimeouts> = Object.freeze({
  permissionMs: 30_000,
  captureStartMs: 15_000,
  captureStopMs: 15_000,
  transcriptionMs: 60_000,
  agentMs: 120_000,
  synthesisMs: 60_000,
  playbackMs: 120_000,
  adapterDrainMs: 2_000,
  idleMs: 360_000,
});

export interface VoiceSessionResourceSnapshot {
  captureListeners: number;
  permissionControllers: number;
  captureControllers: number;
  transcriptionControllers: number;
  agentControllers: number;
  synthesisControllers: number;
  playbackAllocations: number;
  pendingTasks: number;
  adapterOperations: number;
  lifecycleTimers: number;
  total: number;
}

export class VoiceSessionDisposedError extends Error {
  constructor() {
    super("voice session is disposed");
    this.name = "VoiceSessionDisposedError";
  }
}

export class VoiceSessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceSessionStateError";
  }
}

export class VoiceSessionTimeoutError extends Error {
  constructor(
    public readonly operation: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `voice ${operation} stalled after ${timeoutMs}ms; the operation was cancelled, typed input remains available, ` +
        "the action is safe to retry, and `aether voice doctor` can inspect the host and provider",
    );
    this.name = "VoiceSessionTimeoutError";
  }
}

type AgentTurnOutcome = { kind: "done" } | { kind: "error"; error: Error };

interface OwnedDeadline<T> {
  promise: Promise<T>;
  touch(): void;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface AdapterOperationLease {
  abandoned: boolean;
  done: Promise<void>;
  resolveDone(): void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface ActiveAgentTurn {
  token: number;
  controller: AbortController;
  text: string;
  firstTokenSeen: boolean;
  settled: boolean;
  outcome: OwnedDeadline<AgentTurnOutcome>;
  bridgeOperation?: Promise<unknown>;
}

/**
 * Host-neutral Voice controller. It deliberately has no transcript store,
 * analytics port, provider selection, or alternate agent implementation. The
 * only path for recognized speech is the injected AgentVoiceBridge.
 */
export class VoiceSessionController {
  readonly typedInputAvailable = true as const;

  private readonly capture: VoiceCapturePort;
  private readonly transport: VoiceTransport;
  private readonly bridge: AgentVoiceBridge;
  private readonly settings: Readonly<VoiceSettings>;
  private readonly hints: VoiceSessionDependencies["hints"];
  private readonly callbacks: VoiceSessionCallbacks;
  private readonly playbackQueue: VoicePlaybackQueue;
  private readonly timeouts: Readonly<VoiceSessionTimeouts>;

  private machineValue: VoiceMachine = { ...initialVoiceMachine };
  private visibleTranscriptValue = "";
  private failureValue: VoiceSessionFailure | null = null;
  private generation = 0;
  private disposedValue = false;
  private permissionGranted = false;
  private interruptedPreviousForNextTurn = false;

  private captureActive = false;
  private permissionController: AbortController | null = null;
  private captureController: AbortController | null = null;
  private transcriptionController: AbortController | null = null;
  private agentController: AbortController | null = null;
  private synthesisController: AbortController | null = null;
  private activeAgent: ActiveAgentTurn | null = null;
  private captureUnsubscribers: Array<() => void> = [];
  private readonly playbackAllocations = new Set<number>();
  private readonly pendingTasks = new Set<Promise<void>>();
  private readonly adapterOperations = new Map<Promise<unknown>, AdapterOperationLease>();
  private readonly lifecycleTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(deps: VoiceSessionDependencies) {
    this.capture = deps.capture;
    this.transport = deps.transport;
    this.bridge = deps.bridge;
    this.settings = Object.freeze({ ...deps.settings });
    this.hints = deps.hints;
    this.callbacks = deps.callbacks ?? {};
    this.timeouts = resolveVoiceTimeouts(deps.timeouts);
    this.playbackQueue = new VoicePlaybackQueue(deps.playback, {
      timeoutMs: this.timeouts.playbackMs,
      operationDrainMs: this.timeouts.adapterDrainMs,
    });
  }

  get snapshot(): VoiceSessionSnapshot {
    return {
      machine: { ...this.machineValue },
      visibleTranscript: this.visibleTranscriptValue,
      failure: this.failureValue ? { ...this.failureValue } : null,
      typedInputAvailable: true,
      disposed: this.disposedValue,
    };
  }

  resources(): VoiceSessionResourceSnapshot {
    const playbackResources = this.playbackQueue.resources();
    const captureListeners = this.captureUnsubscribers.length;
    const permissionControllers = this.permissionController ? 1 : 0;
    const captureControllers = this.captureController ? 1 : 0;
    const transcriptionControllers = this.transcriptionController ? 1 : 0;
    const agentControllers = this.agentController ? 1 : 0;
    const synthesisControllers = this.synthesisController ? 1 : 0;
    const playbackAllocations = this.playbackAllocations.size;
    const pendingTasks = this.pendingTasks.size;
    const adapterOperations = this.adapterOperations.size + playbackResources.pendingOperations;
    const lifecycleTimers = this.lifecycleTimers.size + playbackResources.timers;
    return {
      captureListeners,
      permissionControllers,
      captureControllers,
      transcriptionControllers,
      agentControllers,
      synthesisControllers,
      playbackAllocations,
      pendingTasks,
      adapterOperations,
      lifecycleTimers,
      total:
        captureListeners +
        permissionControllers +
        captureControllers +
        transcriptionControllers +
        agentControllers +
        synthesisControllers +
        playbackAllocations +
        pendingTasks +
        adapterOperations +
        lifecycleTimers,
    };
  }

  /** Explicit user gesture. Construction never requests permission or starts capture. */
  async start(mode: Exclude<VoiceMode, "idle"> = modeFor(this.settings)): Promise<boolean> {
    this.assertNotDisposed();
    if (!this.settings.enabled) {
      const failure = describeVoiceSessionFailure("gate", new Error("voice is disabled"), this.visibleTranscriptValue);
      this.failureValue = failure;
      this.dispatch({ type: "PROVIDER_ERROR", kind: failure.kind, message: failure.message });
      this.notifyFailure(failure);
      return false;
    }
    if (this.machineValue.state !== "idle" && this.machineValue.state !== "error") {
      throw new VoiceSessionStateError(`cannot start voice while ${this.machineValue.state}`);
    }
    return this.startExplicit(mode);
  }

  /** Stop the current recording, transcribe it, and submit the final text once. */
  async finishCapture(): Promise<string | null> {
    this.assertNotDisposed();
    if (!this.captureActive || !this.captureController) {
      throw new VoiceSessionStateError("voice capture is not active");
    }
    const token = this.generation;
    if (this.machineValue.state === "listening") this.dispatch({ type: "SPEECH_START" });
    this.dispatch({ type: "SPEECH_END" });

    this.captureActive = false;
    const capture = this.captureController;
    let audio: CapturedAudio | undefined;
    try {
      const stopOperation = Promise.resolve()
        .then(() => this.capture.stop())
        .then((candidate) => {
          if (!this.isLive(token)) {
            retireCapturedAudio(candidate);
            throw abortError();
          }
          return candidate;
        });
      audio = await this.awaitAdapter(
        stopOperation,
        "capture stop",
        this.timeouts.captureStopMs,
        capture.signal,
        () => {
          capture.abort();
          safely(() => this.capture.abort());
        },
      );
    } catch (error) {
      if (this.isLive(token)) this.failCurrent("capture", error, token);
      return null;
    } finally {
      this.captureController = null;
      this.clearCaptureListeners();
    }
    if (!this.isLive(token)) return null;

    const transcription = new AbortController();
    this.transcriptionController = transcription;
    const captured = audio;
    let recognized: string;
    try {
      const hints = this.currentHints();
      recognized = await this.awaitAdapter(
        Promise.resolve().then(() => this.transport.transcribe(captured, {
          signal: transcription.signal,
          ...(hints ? { hints } : {}),
        })),
        "transcription",
        this.timeouts.transcriptionMs,
        transcription.signal,
        () => transcription.abort(),
      );
    } catch (error) {
      if (this.isLive(token)) this.failCurrent("stt", error, token);
      return null;
    } finally {
      if (this.transcriptionController === transcription) this.transcriptionController = null;
      retireCapturedAudio(audio);
      audio = undefined;
    }
    if (!this.isLive(token)) return null;

    const text = cleanTranscript(recognized);
    this.visibleTranscriptValue = text;
    this.safeCallback(() => this.callbacks.onFinalTranscript?.(text));
    this.dispatch({ type: "FINAL", text });
    if (!text) {
      this.resumeConversationIfNeeded(token);
      return null;
    }

    this.submitRecognizedText(text, token);
    return text;
  }

  /** Alias for hosts whose interaction copy calls the action "finish". */
  async finish(): Promise<string | null> {
    return this.finishCapture();
  }

  /** Cancel is synchronous so all abort signals fire before terminal repaint. */
  cancel(): void {
    if (this.disposedValue) return;
    this.invalidateAndAbort("cancel");
    this.dispatch({ type: "STOP" });
  }

  /**
   * An explicit barge gesture interrupts the old turn, retires its playback,
   * then starts a fresh capture. Previously granted permission is reused only
   * within this mounted controller.
   */
  async bargeIn(): Promise<boolean> {
    this.assertNotDisposed();
    if (this.machineValue.state !== "thinking" && this.machineValue.state !== "speaking") return false;
    const mode = this.machineValue.mode === "idle" ? modeFor(this.settings) : this.machineValue.mode;
    this.dispatch({ type: "BARGE_IN" });
    this.invalidateAndAbort("cancel", "barge");
    this.interruptedPreviousForNextTurn = true;
    this.dispatch({ type: "STOP" });
    return this.startInternal(mode, !this.permissionGranted);
  }

  /** Await controller-owned synthesis/playback continuations, not an open mic. */
  async whenIdle(): Promise<void> {
    const deadline = this.createDeadline<void>(
      "session idle wait",
      this.timeouts.idleMs,
      undefined,
      () => {
        this.invalidateAndAbort("cancel");
        this.dispatch({ type: "STOP" });
      },
    );
    void this.drainOwnedTasks().then(deadline.resolve, deadline.reject);
    return deadline.promise;
  }

  private async drainOwnedTasks(): Promise<void> {
    for (;;) {
      const pending = [...this.pendingTasks];
      if (pending.length === 0) {
        await this.playbackQueue.whenIdle();
        const abandonedAdapters = [...this.adapterOperations.values()]
          .filter((lease) => lease.abandoned)
          .map((lease) => lease.done);
        if (abandonedAdapters.length > 0) {
          await Promise.allSettled(abandonedAdapters);
          continue;
        }
        if (this.pendingTasks.size === 0) return;
        continue;
      }
      await Promise.allSettled(pending);
    }
  }

  /** Test/host invariant: every playback index is enqueued, skipped, or cancelled. */
  assertPlaybackSettled(): void {
    this.playbackQueue.assertSettled();
  }

  /** Idempotent unmount. Late capture, bridge, and provider completions are stale. */
  dispose(): void {
    if (this.disposedValue) return;
    this.disposedValue = true;
    this.invalidateAndAbort("dispose");
    this.machineValue = reduceVoice(this.machineValue, { type: "STOP" });
    this.visibleTranscriptValue = "";
    this.failureValue = null;
    this.safeCallback(() => this.callbacks.onState?.(this.snapshot));
    safely(() => this.capture.dispose());
  }

  private async startExplicit(mode: Exclude<VoiceMode, "idle">): Promise<boolean> {
    this.interruptedPreviousForNextTurn = false;
    return this.startInternal(mode, true);
  }

  private async startInternal(mode: Exclude<VoiceMode, "idle">, requestPermission: boolean): Promise<boolean> {
    const token = ++this.generation;
    this.failureValue = null;
    this.dispatch({ type: "START", mode });
    if (requestPermission) {
      const permission = new AbortController();
      this.permissionController = permission;
      try {
        await this.awaitAdapter(
          Promise.resolve().then(() => this.capture.requestPermission()),
          "microphone permission",
          this.timeouts.permissionMs,
          permission.signal,
          () => permission.abort(),
        );
      } catch (error) {
        if (this.isLive(token)) this.failCurrent("permission", error, token);
        return false;
      } finally {
        if (this.permissionController === permission) this.permissionController = null;
      }
      if (!this.isLive(token)) return false;
      this.permissionGranted = true;
    }
    return this.beginCapture(token);
  }

  private async beginCapture(token: number): Promise<boolean> {
    if (!this.isLive(token)) return false;
    const controller = new AbortController();
    this.captureController = controller;
    this.captureActive = true;
    try {
      this.installCaptureListeners(token);
      const hints = this.currentHints();
      await this.awaitAdapter(
        Promise.resolve().then(() => this.capture.start({
          signal: controller.signal,
          ...(hints ? { hints } : {}),
        })),
        "capture start",
        this.timeouts.captureStartMs,
        controller.signal,
        () => {
          controller.abort();
          safely(() => this.capture.abort());
        },
      );
    } catch (error) {
      if (this.isLive(token)) this.failCurrent("capture", error, token);
      return false;
    }
    if (!this.isLive(token)) return false;
    this.dispatch({ type: "MIC_READY" });
    return true;
  }

  private installCaptureListeners(token: number): void {
    this.clearCaptureListeners();
    this.captureUnsubscribers.push(
      this.capture.onPartial((raw) => {
        if (!this.isLive(token) || !this.captureActive || !this.settings.partialTranscript) return;
        const text = cleanTranscript(raw);
        if (this.machineValue.state === "listening") this.dispatch({ type: "SPEECH_START" });
        this.visibleTranscriptValue = text;
        this.dispatch({ type: "PARTIAL", text });
        this.safeCallback(() => this.callbacks.onPartialTranscript?.(text));
      }),
      this.capture.onLost((message) => {
        if (!this.isLive(token)) return;
        this.failCurrent("capture", new Error(message), token);
      }),
    );
  }

  private submitRecognizedText(text: string, token: number): void {
    const controller = new AbortController();
    const turn = {
      token,
      controller,
      text: "",
      firstTokenSeen: false,
      settled: false,
    } as ActiveAgentTurn;
    turn.outcome = this.createDeadline<AgentTurnOutcome>(
      "agent stream",
      this.timeouts.agentMs,
      controller.signal,
      () => controller.abort(),
    );
    this.agentController = controller;
    this.activeAgent = turn;
    const sessionRef = new WeakRef(this);
    const activeTurn = (): { session: VoiceSessionController; turn: ActiveAgentTurn } | null => {
      const session = sessionRef.deref();
      const active = session?.activeAgent;
      if (!session || !active || active.token !== token || !session.isActiveTurn(active)) return null;
      return { session, turn: active };
    };
    const callbacks: AgentVoiceCallbacks = {
      signal: controller.signal,
      interruptedPrevious: this.interruptedPreviousForNextTurn,
      onDelta: (delta) => {
        const current = activeTurn();
        if (!current || current.turn.settled) return;
        if (hasMeaningfulVoiceDelta(delta)) {
          if (!current.turn.firstTokenSeen) {
            current.turn.firstTokenSeen = true;
            current.session.dispatch({ type: "AGENT_FIRST_TOKEN" });
          }
          current.turn.outcome.touch();
        }
        current.turn.text += delta;
        current.session.safeCallback(() => current.session.callbacks.onAgentDelta?.(delta));
      },
      onDone: () => {
        const current = activeTurn();
        if (!current || current.turn.settled) return;
        current.turn.settled = true;
        current.turn.outcome.resolve({ kind: "done" });
      },
      onError: (message) => {
        const current = activeTurn();
        if (!current || current.turn.settled) return;
        current.turn.settled = true;
        current.turn.outcome.resolve({ kind: "error", error: new Error(message) });
      },
    };
    this.interruptedPreviousForNextTurn = false;
    try {
      const dispatch = this.bridge.send(text, callbacks);
      if (dispatch) {
        const observed = this.observeAdapter(Promise.resolve(dispatch));
        turn.bridgeOperation = observed;
        if (turn.settled) this.abandonAdapter(observed);
        const bridgeToken = token;
        void observed.catch((error: unknown) => {
          const session = sessionRef.deref();
          const active = session?.activeAgent;
          if (!session || !active || active.token !== bridgeToken || active.settled || !session.isActiveTurn(active)) return;
          active.settled = true;
          active.outcome.resolve({ kind: "error", error: toError(error) });
        });
      }
    } catch (error) {
      if (this.isActiveTurn(turn)) {
        turn.settled = true;
        turn.outcome.resolve({ kind: "error", error: toError(error) });
      }
    }
    this.track(this.runAgentTurn(turn));
  }

  private async runAgentTurn(turn: ActiveAgentTurn): Promise<void> {
    try {
      const outcome = await turn.outcome.promise;
      if (!this.isActiveTurn(turn)) return;
      if (outcome.kind === "error") {
        this.failCurrent("agent", outcome.error, turn.token);
        return;
      }
      await this.completeAgentTurn(turn);
    } catch (error) {
      if (this.isActiveTurn(turn) && !isAbortError(error)) this.failCurrent("agent", error, turn.token);
    } finally {
      if (turn.bridgeOperation) this.abandonAdapter(turn.bridgeOperation);
    }
  }

  private async completeAgentTurn(turn: ActiveAgentTurn): Promise<void> {
    if (!this.isActiveTurn(turn)) return;
    const speakable = turn.text.trim();
    if (!this.settings.speechOutput || !speakable) {
      this.completeTurn(turn);
      return;
    }

    let allocation: number;
    try {
      allocation = this.playbackQueue.allocate();
      this.playbackAllocations.add(allocation);
    } catch (error) {
      if (this.isActiveTurn(turn)) this.failCurrent("playback", error, turn.token);
      return;
    }

    const synthesis = new AbortController();
    this.synthesisController = synthesis;
    let audio;
    try {
      audio = await this.awaitAdapter(
        Promise.resolve().then(() => this.transport.synthesize(speakable, {
          signal: synthesis.signal,
          voice: this.settings.voiceProfile,
          purpose: this.machineValue.mode === "conversation" ? "conversation" : "chat",
        })),
        "speech synthesis",
        this.timeouts.synthesisMs,
        synthesis.signal,
        () => synthesis.abort(),
      );
    } catch (error) {
      safely(() => this.playbackQueue.skip(allocation));
      this.playbackAllocations.delete(allocation);
      if (this.isActiveTurn(turn)) this.failCurrent("tts", error, turn.token);
      return;
    } finally {
      if (this.synthesisController === synthesis) this.synthesisController = null;
    }
    if (!this.isActiveTurn(turn)) {
      safely(() => this.playbackQueue.skip(allocation));
      this.playbackAllocations.delete(allocation);
      return;
    }

    try {
      this.playbackQueue.enqueue(allocation, audio);
      this.dispatch({ type: "AUDIO_START" });
      await this.playbackQueue.whenIdle();
    } catch (error) {
      if (this.isActiveTurn(turn)) this.failCurrent("playback", error, turn.token);
      return;
    } finally {
      this.playbackAllocations.delete(allocation);
    }
    if (this.isActiveTurn(turn)) this.completeTurn(turn);
  }

  private completeTurn(turn: ActiveAgentTurn): void {
    if (!this.isActiveTurn(turn)) return;
    this.activeAgent = null;
    this.agentController = null;
    this.dispatch({ type: "TURN_DONE" });
    this.resumeConversationIfNeeded(turn.token);
  }

  private failCurrent(stage: VoiceSessionFailureStage, error: unknown, token: number): void {
    if (!this.isLive(token)) return;
    const mode = this.machineValue.mode;
    const failure = describeVoiceSessionFailure(stage, error, this.visibleTranscriptValue);

    // Invalidate before aborting: an adapter is allowed to synchronously invoke
    // old callbacks from abort/stop, and those callbacks must be harmless.
    this.invalidateAndAbort("cancel");
    this.failureValue = failure;
    if (stage === "permission") {
      this.dispatch({ type: "MIC_DENIED", message: failure.message });
    } else if (stage === "capture") {
      this.dispatch({ type: "MIC_LOST", message: failure.message });
    } else {
      this.dispatch({ type: "PROVIDER_ERROR", kind: failure.kind, message: failure.message });
    }
    this.notifyFailure(failure);
    if (mode === "conversation" && failure.recoverable && !this.disposedValue) {
      this.track(this.resumeConversation(mode));
    }
  }

  private notifyFailure(failure: VoiceSessionFailure): void {
    this.safeCallback(() => this.callbacks.onFailure?.({ ...failure }));
  }

  private resumeConversationIfNeeded(token: number): void {
    if (!this.isLive(token) || this.machineValue.mode !== "conversation" || this.machineValue.state !== "listening") {
      return;
    }
    this.track(this.resumeConversation("conversation"));
  }

  private async resumeConversation(mode: Exclude<VoiceMode, "idle">): Promise<void> {
    if (this.disposedValue || mode !== "conversation" || !this.settings.enabled) return;
    const token = ++this.generation;
    await this.beginCapture(token);
  }

  private dispatch(event: VoiceEvent): void {
    const next = reduceVoice(this.machineValue, event);
    if (next === this.machineValue) return;
    this.machineValue = next;
    this.safeCallback(() => this.callbacks.onState?.(this.snapshot));
  }

  private invalidateAndAbort(
    playback: "cancel" | "dispose",
    order: "standard" | "barge" = "standard",
  ): void {
    ++this.generation;
    this.permissionController?.abort();
    if (order === "barge") {
      // Cross-lane scenario 9 is intentionally reverse-output order: stop
      // audible output first, then pending TTS, then the old agent stream, and
      // only then retire input capture before opening the next microphone.
      safely(() => this.playbackQueue.cancel());
      this.synthesisController?.abort();
      this.agentController?.abort();
      this.transcriptionController?.abort();
      safely(() => this.capture.abort());
      this.captureController?.abort();
    } else {
      // Normal cancellation follows the input-to-output data flow.
      safely(() => this.capture.abort());
      this.captureController?.abort();
      this.transcriptionController?.abort();
      this.agentController?.abort();
      this.synthesisController?.abort();
      if (playback === "dispose") safely(() => this.playbackQueue.dispose());
      else safely(() => this.playbackQueue.cancel());
    }
    this.abandonAllAdapters();

    this.captureActive = false;
    this.permissionController = null;
    this.captureController = null;
    this.transcriptionController = null;
    this.agentController = null;
    this.synthesisController = null;
    this.activeAgent = null;
    this.clearCaptureListeners();
  }

  private clearCaptureListeners(): void {
    const unsubscribers = this.captureUnsubscribers.splice(0);
    for (const unsubscribe of unsubscribers) safely(unsubscribe);
  }

  private currentHints(): VoiceContextHints | undefined {
    return typeof this.hints === "function" ? this.hints() : this.hints;
  }

  private isLive(token: number): boolean {
    return !this.disposedValue && token === this.generation;
  }

  private isActiveTurn(turn: ActiveAgentTurn): boolean {
    return this.isLive(turn.token) && this.activeAgent === turn;
  }

  private track(task: Promise<void>): void {
    let tracked: Promise<void>;
    tracked = task
      .catch((error: unknown) => {
        if (!this.disposedValue) {
          const token = this.generation;
          this.failCurrent("agent", error, token);
        }
      })
      .finally(() => this.pendingTasks.delete(tracked));
    this.pendingTasks.add(tracked);
  }

  private awaitAdapter<T>(
    task: Promise<T>,
    operation: string,
    timeoutMs: number,
    signal?: AbortSignal,
    onTimeout?: () => void,
  ): Promise<T> {
    const observed = this.observeAdapter(task);
    const deadline = this.createDeadline<T>(operation, timeoutMs, signal, onTimeout);
    const deadlineRef = new WeakRef(deadline);
    void observed.then(
      (value) => deadlineRef.deref()?.resolve(value),
      (error: unknown) => deadlineRef.deref()?.reject(error),
    );
    return deadline.promise.catch((error: unknown) => {
      this.abandonAdapter(observed);
      throw error;
    });
  }

  private createDeadline<T>(
    operation: string,
    timeoutMs: number,
    signal?: AbortSignal,
    onTimeout?: () => void,
  ): OwnedDeadline<T> {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let deadline!: OwnedDeadline<T>;
    let resolvePromise!: (value: T | PromiseLike<T>) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const cleanupTimer = (): void => {
      if (!timer) return;
      clearTimeout(timer);
      this.lifecycleTimers.delete(timer);
      timer = null;
    };
    const cleanup = (): void => {
      cleanupTimer();
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (kind: "resolve" | "reject", value: T | unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (kind === "resolve") resolvePromise(value as T);
      else rejectPromise(value);
    };
    const onAbort = (): void => deadline.reject(abortError());
    const arm = (): void => {
      if (settled) return;
      cleanupTimer();
      timer = setTimeout(() => {
        const error = new VoiceSessionTimeoutError(operation, timeoutMs);
        // Own the terminal result first. Aborting afterward cannot turn a
        // watchdog into a misleading user-cancelled result.
        deadline.reject(error);
        safely(() => onTimeout?.());
      }, timeoutMs);
      timer.unref?.();
      this.lifecycleTimers.add(timer);
    };

    deadline = {
      promise,
      touch: arm,
      resolve: (value) => finish("resolve", value),
      reject: (error) => finish("reject", error),
    };
    if (signal?.aborted) {
      deadline.reject(abortError());
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
      arm();
    }
    return deadline;
  }

  /** Keep ownership visible even when an injected adapter ignores AbortSignal. */
  private observeAdapter<T>(task: Promise<T>): Promise<T> {
    let resolveDone!: () => void;
    const lease: AdapterOperationLease = {
      abandoned: false,
      done: new Promise<void>((resolve) => { resolveDone = resolve; }),
      resolveDone: () => resolveDone(),
      timer: null,
    };
    this.adapterOperations.set(task, lease);
    const operations = new WeakRef(this.adapterOperations);
    const timers = new WeakRef(this.lifecycleTimers);
    void task.then(
      () => releaseAdapterOperation(operations, timers, task),
      () => releaseAdapterOperation(operations, timers, task),
    );
    return task;
  }

  private abandonAdapter(task: Promise<unknown>): void {
    const lease = this.adapterOperations.get(task);
    if (!lease || lease.abandoned) return;
    lease.abandoned = true;
    const operations = new WeakRef(this.adapterOperations);
    const timers = new WeakRef(this.lifecycleTimers);
    const timer = setTimeout(
      () => releaseAdapterOperation(operations, timers, task),
      this.timeouts.adapterDrainMs,
    );
    timer.unref?.();
    lease.timer = timer;
    this.lifecycleTimers.add(timer);
  }

  private abandonAllAdapters(): void {
    for (const operation of this.adapterOperations.keys()) this.abandonAdapter(operation);
  }

  private safeCallback(callback: () => void): void {
    safely(callback);
  }

  private assertNotDisposed(): void {
    if (this.disposedValue) throw new VoiceSessionDisposedError();
  }
}

function releaseAdapterOperation(
  operationsRef: WeakRef<Map<Promise<unknown>, AdapterOperationLease>>,
  timersRef: WeakRef<Set<ReturnType<typeof setTimeout>>>,
  operation: Promise<unknown>,
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

/** Describes provider failures without exposing response bodies or control bytes. */
export function describeVoiceSessionFailure(
  stage: VoiceSessionFailureStage,
  error: unknown,
  visibleTranscript = "",
): VoiceSessionFailure {
  const status = error instanceof HttpError ? error.status : undefined;
  const raw = sanitizeServerText(errorMessage(error)) || defaultFailureMessage(stage);
  const kind = failureKind(stage);
  const recoverable = kind === "stt_failed" || kind === "tts_failed" || kind === "agent_failed" || kind === "disconnected";
  const failure: VoiceSessionFailure = {
    stage,
    kind,
    message: raw,
    hint: failureHint(stage, status),
    recoverable,
    visibleTranscript,
    typedInputAvailable: true,
  };
  if (status !== undefined) failure.status = status;
  return failure;
}

function failureKind(stage: VoiceSessionFailureStage): VoiceErrorKind {
  switch (stage) {
    case "gate":
      return "gated";
    case "permission":
      return "mic_denied";
    case "capture":
      return "mic_lost";
    case "stt":
      return "stt_failed";
    case "agent":
      return "agent_failed";
    case "tts":
    case "playback":
      return "tts_failed";
  }
}

function failureHint(stage: VoiceSessionFailureStage, status: number | undefined): string {
  if (stage === "gate") return "enable Voice explicitly; typed input remains available";
  if (stage === "permission") return "allow microphone access, or continue with typed input";
  if (stage === "capture") return "check the microphone/recorder, or continue with typed input";
  if (stage === "agent") return "retry the turn or continue with typed input";
  if (stage === "playback") return "the completed answer remains available as text; check audio output";
  if (stage === "tts") {
    if (status !== undefined && status >= 500) {
      return "speech output is temporarily unavailable; the completed answer remains available as text";
    }
    if (status === 402) {
      return "speech output needs UVT; the completed answer remains available as text and typed mode is unchanged";
    }
    return "speech output failed independently; the completed answer remains available as text";
  }
  if (status === 401) return "sign in again, or continue with typed input";
  if (status === 402) {
    return "out of UVT balance — top up or check your plan; typed input remains available and no local STT switch was made";
  }
  if (status === 403) return "your plan may not include transcription; check the plan or continue with typed input";
  if (status === 429) return "transcription is rate limited; wait briefly or continue with typed input";
  if (status !== undefined && status >= 500) return "transcription is temporarily unavailable; retry or continue with typed input";
  return "retry transcription or continue with typed input";
}

function defaultFailureMessage(stage: VoiceSessionFailureStage): string {
  switch (stage) {
    case "gate":
      return "voice is unavailable";
    case "permission":
      return "microphone permission was denied";
    case "capture":
      return "microphone capture failed";
    case "stt":
      return "transcription failed";
    case "agent":
      return "agent turn failed";
    case "tts":
      return "speech synthesis failed";
    case "playback":
      return "audio playback failed";
  }
}

function cleanTranscript(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f]+/g, " ").replace(/\s+/g, " ").trim();
}

function hasMeaningfulVoiceDelta(text: string): boolean {
  return text.replace(/[\x00-\x20\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+/g, "").length > 0;
}

function modeFor(settings: Readonly<VoiceSettings>): Exclude<VoiceMode, "idle"> {
  return settings.interactionMode === "conversation" ? "conversation" : "push";
}

function resolveVoiceTimeouts(input: Partial<VoiceSessionTimeouts> | undefined): Readonly<VoiceSessionTimeouts> {
  const resolved: VoiceSessionTimeouts = { ...DEFAULT_VOICE_SESSION_TIMEOUTS, ...input };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 3_600_000) {
      throw new RangeError(`voice ${name} must be an integer from 1 to 3600000ms`);
    }
  }
  return Object.freeze(resolved);
}

/** Raw capture belongs to one transcription attempt and is retired even when a provider ignores abort. */
function retireCapturedAudio(audio: CapturedAudio | undefined): void {
  if (!audio) return;
  safely(() => audio.bytes.fill(0));
}

function abortError(): Error {
  const error = new Error("voice operation was aborted");
  error.name = "AbortError";
  return error;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function safely(action: () => void): void {
  try {
    action();
  } catch {
    // UI/host cleanup failures cannot widen authority or strand later aborts.
  }
}

export { VoiceSessionController as AetherVoiceSession };
