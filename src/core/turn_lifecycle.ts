// One typed lifecycle for every terminal chat turn. Transport and renderer
// code may observe many frames, but a turn owns exactly one terminal outcome.

import { randomUUID } from "node:crypto";
import { httpStatusHint } from "./errors.js";
import { sanitizeServerText } from "./transport.js";

export const TURN_STATES = [
  "idle",
  "submitted",
  "connecting",
  "streaming",
  "waiting_for_tool",
  "completing",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "incomplete",
] as const;

export type TurnState = (typeof TURN_STATES)[number];
export type TurnTerminalState = Extract<
  TurnState,
  "succeeded" | "failed" | "cancelled" | "timed_out" | "incomplete"
>;
type TurnActiveState = Exclude<TurnState, TurnTerminalState>;

const TERMINAL_STATES = new Set<TurnState>([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "incomplete",
]);

const TRANSITIONS: Readonly<Record<TurnActiveState, readonly TurnState[]>> = {
  idle: ["submitted"],
  submitted: ["connecting", "failed", "cancelled", "timed_out", "incomplete"],
  connecting: ["streaming", "waiting_for_tool", "completing", "failed", "cancelled", "timed_out", "incomplete"],
  streaming: ["waiting_for_tool", "completing", "failed", "cancelled", "timed_out", "incomplete"],
  waiting_for_tool: ["streaming", "completing", "failed", "cancelled", "timed_out", "incomplete"],
  completing: ["succeeded", "failed", "cancelled", "timed_out", "incomplete"],
};

export interface TurnOutcome {
  turnId: string;
  state: TurnTerminalState;
  exitCode: number;
  prompt: string;
  message: string;
  hint: string | null;
  retryable: boolean;
  partialOutput: boolean;
  startedAt: number;
  finishedAt: number;
  lastMeaningfulActivityAt: number;
}

export interface TurnSnapshot {
  turnId: string;
  state: TurnState;
  prompt: string;
  startedAt: number;
  lastMeaningfulActivityAt: number;
  outcome: TurnOutcome | null;
}

export interface TurnLifecycleOptions {
  /** Injectable for deterministic tests and externally-correlated turns. */
  id?: string;
  now?: () => number;
  /**
   * Restore an immutable snapshot after a recoverable embed remount. The
   * snapshot is validated before any state is adopted; callers cannot use it
   * to change a prompt, correlation id, or terminal outcome.
   */
  resume?: TurnSnapshot;
}

export interface TurnFinalization {
  message?: string;
  hint?: string | null;
  retryable?: boolean;
  partialOutput?: boolean;
  at?: number;
}

export class TurnTransitionError extends Error {
  constructor(from: TurnState, to: TurnState) {
    super(`invalid turn transition: ${from} -> ${to}`);
    this.name = "TurnTransitionError";
  }
}

export class TurnAlreadyFinalizedError extends Error {
  constructor(turnId: string, state: TurnTerminalState) {
    super(`turn ${turnId} already finalized as ${state}`);
    this.name = "TurnAlreadyFinalizedError";
  }
}

/** Mutable state machine with immutable snapshots/outcomes at its boundary. */
export class TurnLifecycle {
  readonly id: string;
  readonly prompt: string;
  readonly startedAt: number;

  private readonly now: () => number;
  private currentState: TurnState = "idle";
  private activityAt: number;
  private terminalOutcome: TurnOutcome | null = null;

  constructor(prompt: string, opts: TurnLifecycleOptions = {}) {
    this.now = opts.now ?? Date.now;
    if (opts.resume) {
      const restored = validateResumeSnapshot(prompt, opts.id, opts.resume);
      this.id = restored.turnId;
      this.prompt = restored.prompt;
      this.startedAt = restored.startedAt;
      this.activityAt = restored.lastMeaningfulActivityAt;
      this.currentState = restored.state;
      this.terminalOutcome = restored.outcome ? Object.freeze({ ...restored.outcome }) : null;
      return;
    }
    this.id = opts.id?.trim() || `turn-${randomUUID()}`;
    this.prompt = prompt;
    this.startedAt = this.now();
    this.activityAt = this.startedAt;
  }

  get state(): TurnState {
    return this.currentState;
  }

  get lastMeaningfulActivityAt(): number {
    return this.activityAt;
  }

  get outcome(): TurnOutcome | null {
    return this.terminalOutcome ? { ...this.terminalOutcome } : null;
  }

  snapshot(): TurnSnapshot {
    return {
      turnId: this.id,
      state: this.currentState,
      prompt: this.prompt,
      startedAt: this.startedAt,
      lastMeaningfulActivityAt: this.activityAt,
      outcome: this.outcome,
    };
  }

  /** Move between non-terminal phases. Terminal states must use finalize(). */
  transition(next: TurnActiveState, at = this.now()): TurnSnapshot {
    this.assertOpen();
    if (!TRANSITIONS[this.currentState as TurnActiveState]?.includes(next)) {
      throw new TurnTransitionError(this.currentState, next);
    }
    this.currentState = next;
    this.bumpActivity(at);
    return this.snapshot();
  }

  /** Record actual progress. Heartbeats/presentation repaint must not call this. */
  meaningfulActivity(at = this.now()): TurnSnapshot {
    this.assertOpen();
    this.bumpActivity(at);
    return this.snapshot();
  }

  finalize(state: TurnTerminalState, details: TurnFinalization = {}): TurnOutcome {
    this.assertOpen();
    if (!TRANSITIONS[this.currentState as TurnActiveState]?.includes(state)) {
      throw new TurnTransitionError(this.currentState, state);
    }
    const finishedAt = Math.max(this.activityAt, details.at ?? this.now());
    this.currentState = state;
    const outcome: TurnOutcome = Object.freeze({
      turnId: this.id,
      state,
      exitCode: exitCodeFor(state),
      prompt: this.prompt,
      message: details.message?.trim() || defaultMessageFor(state),
      hint: details.hint ?? null,
      retryable: details.retryable ?? defaultRetryableFor(state),
      partialOutput: details.partialOutput ?? false,
      startedAt: this.startedAt,
      finishedAt,
      lastMeaningfulActivityAt: this.activityAt,
    });
    this.terminalOutcome = outcome;
    return { ...outcome };
  }

  private assertOpen(): void {
    if (this.terminalOutcome) {
      throw new TurnAlreadyFinalizedError(this.id, this.terminalOutcome.state);
    }
  }

  private bumpActivity(at: number): void {
    this.activityAt = Math.max(this.activityAt, at);
  }
}

function validateResumeSnapshot(
  prompt: string,
  requestedId: string | undefined,
  snapshot: TurnSnapshot,
): TurnSnapshot {
  if (!snapshot || typeof snapshot !== "object") {
    throw new TypeError("invalid turn resume snapshot");
  }
  if (typeof snapshot.turnId !== "string" || snapshot.turnId.trim().length === 0) {
    throw new TypeError("turn resume snapshot requires a non-empty turnId");
  }
  if (requestedId != null && requestedId.trim() !== snapshot.turnId) {
    throw new TypeError("turn resume snapshot does not match the requested correlation id");
  }
  if (snapshot.prompt !== prompt) {
    throw new TypeError("turn resume snapshot does not match the submitted prompt");
  }
  if (!TURN_STATES.includes(snapshot.state)) {
    throw new TypeError("turn resume snapshot has an invalid state");
  }
  if (!isFiniteTimestamp(snapshot.startedAt) || !isFiniteTimestamp(snapshot.lastMeaningfulActivityAt)) {
    throw new TypeError("turn resume snapshot has invalid timestamps");
  }
  if (snapshot.lastMeaningfulActivityAt < snapshot.startedAt) {
    throw new TypeError("turn resume activity precedes its start time");
  }

  const terminal = isTerminalTurnState(snapshot.state);
  if (terminal !== (snapshot.outcome != null)) {
    throw new TypeError("turn resume snapshot state/outcome are inconsistent");
  }
  if (snapshot.outcome) validateResumeOutcome(snapshot, snapshot.outcome);
  return {
    ...snapshot,
    outcome: snapshot.outcome ? { ...snapshot.outcome } : null,
  };
}

function validateResumeOutcome(snapshot: TurnSnapshot, outcome: TurnOutcome): void {
  if (
    outcome.turnId !== snapshot.turnId ||
    outcome.prompt !== snapshot.prompt ||
    outcome.state !== snapshot.state ||
    outcome.startedAt !== snapshot.startedAt ||
    outcome.lastMeaningfulActivityAt !== snapshot.lastMeaningfulActivityAt
  ) {
    throw new TypeError("turn resume outcome does not match its snapshot");
  }
  if (
    !isFiniteTimestamp(outcome.finishedAt) ||
    outcome.finishedAt < outcome.lastMeaningfulActivityAt ||
    outcome.exitCode !== exitCodeFor(outcome.state) ||
    typeof outcome.message !== "string" ||
    (outcome.hint !== null && typeof outcome.hint !== "string") ||
    typeof outcome.retryable !== "boolean" ||
    typeof outcome.partialOutput !== "boolean"
  ) {
    throw new TypeError("turn resume outcome is malformed");
  }
}

function isFiniteTimestamp(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export interface StreamFailureInput {
  message?: string;
  errorCode?: string;
}

export interface StreamFailureDescription {
  message: string;
  errorCode?: string;
  status?: number;
  hint: string | null;
  retryable: boolean;
}

/**
 * Turn an untrusted streamed error frame into safe, actionable terminal copy.
 * HTTP failures thrown before the stream use errorHint(); this covers the same
 * status when it arrives inside an already-open SSE response.
 */
export function describeStreamFailure(input: StreamFailureInput): StreamFailureDescription {
  const message = sanitizeServerText(input.message ?? "");
  const errorCode = sanitizeServerText(input.errorCode ?? "") || undefined;
  const status = statusFromStreamFailure(message, errorCode);
  const hint = status == null ? null : httpStatusHint(status);
  return {
    message: message || (status === 402 ? "Out of UVT balance" : status == null ? "turn failed" : `HTTP ${status}`),
    ...(errorCode ? { errorCode } : {}),
    ...(status == null ? {} : { status }),
    hint,
    retryable: status === 402 || status === 429 || (status != null && status >= 500),
  };
}

/** Keep type-ahead intact; otherwise put the failed submission back to edit. */
export function recoverSubmittedPrompt(submitted: string, currentDraft: string): string {
  return currentDraft.length > 0 ? currentDraft : submitted;
}

export function isTerminalTurnState(state: TurnState): state is TurnTerminalState {
  return TERMINAL_STATES.has(state);
}

function statusFromStreamFailure(message: string, errorCode?: string): number | undefined {
  const combined = `${errorCode ?? ""} ${message}`;
  const explicit = /(?:^|[^0-9])(401|402|403|429|5[0-9]{2})(?:[^0-9]|$)/i.exec(combined);
  if (explicit?.[1]) return Number(explicit[1]);
  if (/(?:insufficient|empty|exhausted|depleted|zero|out[ -]?of).{0,24}(?:uvt|balance|credit)|(?:uvt|balance|credit).{0,24}(?:insufficient|empty|exhausted|depleted|zero|out[ -]?of)|payment_required/i.test(combined)) {
    return 402;
  }
  return undefined;
}

function exitCodeFor(state: TurnTerminalState): number {
  if (state === "succeeded") return 0;
  if (state === "cancelled") return 130;
  return 1;
}

function defaultRetryableFor(state: TurnTerminalState): boolean {
  return state === "cancelled" || state === "timed_out" || state === "incomplete";
}

function defaultMessageFor(state: TurnTerminalState): string {
  switch (state) {
    case "succeeded":
      return "turn completed";
    case "failed":
      return "turn failed";
    case "cancelled":
      return "turn cancelled";
    case "timed_out":
      return "turn timed out";
    case "incomplete":
      return "turn incomplete";
  }
}
