// remote_host.ts — the /rc host: the EXCLUSIVE host connection from a local
// Aether Agent session to the remote-session broker (AETHER-AGENT-LIVE-01 R2,
// frozen contract: AETHER-CLOUD ADR-0007 / PR #1321).
//
// Invariants, in order of importance:
//   1. Remote Control failure — broker down, network loss, revocation — must
//      NEVER stop, corrupt, or downgrade the local Agent session. Every broker
//      call in this file is fail-soft: it updates RC status and returns.
//   2. Outbound TLS only. This module opens no listener; it only POSTs through
//      the injected transport (production: core/transport.ts ApiClient, which
//      owns bearer handling and refuses credentials on insecure transports).
//   3. Durable local resume cursor: last acked seq + an outbox of unsent
//      events, persisted with the atomic writer. After a crash or reconnect
//      the host re-sends from the outbox; the broker dedupes by the
//      host-supplied host_event_id, so re-sending is always safe.
//   4. Every payload passes the remote_redaction allowlist before it is even
//      queued — nothing forbidden is ever at rest in the outbox.
//
// The broker endpoints are configuration, not code: the transport carries the
// base URL (config baseUrl / AETHER_BASE_URL); the paths below are the one
// place the wire layout is spelled, so aligning with the R1 broker is a
// one-constant diff. No production URL is hardcoded here.

import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { HttpError } from "./errors.js";
import { atomicWriteFile, readJsonFile } from "./durable_store.js";
import { sanitizeRemotePayload, type RcEventType } from "./remote_redaction.js";

export const RC_PROTOCOL_VERSION = 1;
// Reconciled against the R1 broker routes shipped in AETHER-CLOUD PR #1328:
// the base is `/remote/sessions` (register posts there), sub-resources hang off
// `/remote/sessions/{id}/...`, and grant redemption lives under `/remote/grants`.
export const RC_SESSIONS_PATH = "/remote/sessions";
export const rcAttachPath = (id: string): string => `${RC_SESSIONS_PATH}/${encodeURIComponent(id)}/host/attach`;
export const rcEventsPath = (id: string): string => `${RC_SESSIONS_PATH}/${encodeURIComponent(id)}/host/events`;
export const rcHeartbeatPath = (id: string): string => `${RC_SESSIONS_PATH}/${encodeURIComponent(id)}/host/heartbeat`;
export const rcRevokePath = (id: string): string => `${RC_SESSIONS_PATH}/${encodeURIComponent(id)}/revoke`;
export const rcGrantsPath = (id: string): string => `${RC_SESSIONS_PATH}/${encodeURIComponent(id)}/grants`;
export const RC_GRANT_REDEEM_PATH = "/remote/grants/redeem";

/** Host heartbeat cadence (ADR-0007 §4). */
export const RC_HEARTBEAT_MS = 15_000;
/** Events per append batch — bounded so one flush is one bounded request. */
const RC_BATCH_SIZE = 32;
/** Outbox bound: drop-oldest beyond this, never block or grow unbounded. */
const RC_MAX_OUTBOX = 1_000;

/** The slice of ApiClient this module needs — injected so tests can point a
 *  real or mock transport at a mock broker without touching auth. */
export interface RcTransport {
  postJson<T>(path: string, body: unknown): Promise<T>;
}

export interface RcRegisterResponse {
  session_id: string;
  /** Host connection secret for re-attach. Persisted 0600, never uploaded. */
  host_secret?: string;
  /** Aether Code viewer URL for this session. */
  viewer_url?: string;
  /** Single-use QR redemption URL — an id, never a reusable bearer token. */
  redemption_url?: string;
  /** R1 (#1328) returns a single-use grant token at register; it is redeemed
   *  via POST /remote/grants/redeem (a POST body, never a URL/log per ADR §2).
   *  Captured for forward-compat; the QR still targets the redemption/viewer
   *  URL, never the raw token. */
  grant_token?: string;
  expires_at?: string;
}
/** R1 (#1328) /host/events replies with a per-item receipt for each event in
 *  the batch. An accepted item carries its allocated `seq`; a `rejected` item
 *  (G4: the broker independently dropped that one payload as secret-shaped) is
 *  non-fatal — that single item is dropped and the batch continues. Only a
 *  top-level 409 EventConflictError (G2) aborts the whole request. */
interface RcAppendReceipt {
  host_event_id: string;
  seq?: number;
  rejected?: boolean;
  reason?: string;
}
interface RcAppendResponse {
  receipts?: RcAppendReceipt[];
  acked_seq?: number;
}

export type RcPhase = "off" | "active" | "reconnecting" | "failed";

export interface RcStatus {
  phase: RcPhase;
  sessionId?: string;
  sessionName?: string;
  viewerUrl?: string;
  redemptionUrl?: string;
  expiresAt?: string;
  pendingEvents: number;
  lastAckedSeq: number;
  droppedEvents: number;
  detail?: string;
}

interface StoredRcEvent {
  host_event_id: string;
  event_type: RcEventType;
  payload: Record<string, unknown>;
  created_at: string;
}

interface RcHostState {
  version: 1;
  sessionId: string;
  /** The enrolled host device id, presented at register/attach/heartbeat.
   *  Persisted so a resumed session presents the SAME id the broker recorded. */
  deviceId: string;
  sessionName?: string;
  viewerUrl?: string;
  redemptionUrl?: string;
  expiresAt?: string;
  hostSecret?: string;
  /** `/rc off` was requested but the broker has not acknowledged revocation.
   *  Keep the session handle so a later `/rc off` can retry; never resume it. */
  revokePending?: boolean;
  lastAckedSeq: number;
  outbox: StoredRcEvent[];
}

/** Exponential reconnect delay: 1 s → 60 s with ±25 % jitter (ADR-0007 §11).
 *  Pure — the tests pin `random`. */
export function computeBackoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(60_000, 1_000 * 2 ** Math.max(0, Math.min(attempt, 6)));
  const jitter = (random() - 0.5) * 0.5 * base;
  return Math.max(250, Math.round(base + jitter));
}

export interface RemoteHostOptions {
  transport: RcTransport;
  /** Durable cursor + outbox file (created 0600 via the atomic writer). */
  statePath: string;
  /** Project root — payload paths are relativized against it. */
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
  heartbeatMs?: number;
  random?: () => number;
  maxOutbox?: number;
  /** The enrolled host device id. Generated + persisted when omitted; a resumed
   *  session always reuses the id stored with its cursor. */
  deviceId?: string;
}

export interface RcStartInput {
  sessionName?: string;
  repo?: { repo?: string; branch?: string; base_commit?: string; dirty_file_count?: number };
}

export class RemoteHostClient {
  private phase: RcPhase = "off";
  private state: RcHostState | null = null;
  /** The enrolled device id used for register/attach/heartbeat. Stable for the
   *  client's lifetime; a resumed session adopts the id from its stored state. */
  private deviceId: string;
  private detail: string | undefined;
  private attempt = 0;
  private dropped = 0;
  /** Serializes flushes: awaiting flush() always covers the queued work. */
  private flushChain: Promise<void> = Promise.resolve();
  private stopped = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: RemoteHostOptions) {
    this.deviceId = options.deviceId ?? `dev_${randomUUID()}`;
  }

  /** Register (or re-attach to) a remote session. Never throws — a failure is
   *  reported through status(); the local session is unaffected either way. */
  async start(input: RcStartInput = {}): Promise<RcStatus> {
    this.stopped = false;
    const resumed = this.loadState();
    if (resumed) {
      if (resumed.revokePending) {
        this.state = resumed;
        this.stopped = true;
        this.fail("remote revocation is still unconfirmed; retry `/rc off` when the broker is reachable");
        return this.status();
      }
      const attached = await this.attach(resumed);
      if (attached === "active" || attached === "failed") return this.status();
      // Session gone (expired/revoked server-side): fall through to register.
      this.clearState();
    }
    try {
      const response = await this.options.transport.postJson<RcRegisterResponse>(RC_SESSIONS_PATH, {
        protocol_version: RC_PROTOCOL_VERSION,
        device_id: this.deviceId,
        ...(input.sessionName ? { session_name: input.sessionName } : {}),
        ...(input.repo ? { repo: input.repo } : {}),
        execution: "local",
      });
      if (!response || typeof response.session_id !== "string" || !response.session_id) {
        this.fail("broker returned no session id");
        return this.status();
      }
      this.state = {
        version: 1,
        sessionId: response.session_id,
        deviceId: this.deviceId,
        ...(input.sessionName ? { sessionName: input.sessionName } : {}),
        ...(response.viewer_url ? { viewerUrl: response.viewer_url } : {}),
        ...(response.redemption_url ? { redemptionUrl: response.redemption_url } : {}),
        ...(response.expires_at ? { expiresAt: response.expires_at } : {}),
        ...(response.host_secret ? { hostSecret: response.host_secret } : {}),
        lastAckedSeq: 0,
        outbox: [],
      };
      this.persist();
      this.becomeActive();
      this.startHeartbeat();
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        this.fail("another host is already connected to this session (the broker enforces one exclusive host)");
      } else {
        this.fail(`could not reach the remote-session broker (${describe(error)})`);
      }
    }
    return this.status();
  }

  private async attach(state: RcHostState): Promise<RcPhase | "gone"> {
    // A resumed session presents the device id the broker recorded at register.
    this.deviceId = state.deviceId ?? this.deviceId;
    try {
      const response = await this.options.transport.postJson<RcRegisterResponse>(rcAttachPath(state.sessionId), {
        protocol_version: RC_PROTOCOL_VERSION,
        device_id: this.deviceId,
        ...(state.hostSecret ? { host_secret: state.hostSecret } : {}),
        last_acked_seq: state.lastAckedSeq,
      });
      this.state = {
        ...state,
        ...(response?.viewer_url ? { viewerUrl: response.viewer_url } : {}),
        ...(response?.expires_at ? { expiresAt: response.expires_at } : {}),
      };
      this.becomeActive();
      this.startHeartbeat();
      void this.flush();
      return "active";
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        this.fail("another host is already connected to this session (the broker enforces one exclusive host)");
        return "failed";
      }
      if (error instanceof HttpError && (error.status === 404 || error.status === 410)) return "gone";
      this.fail(`could not re-attach to the remote session (${describe(error)})`);
      return "failed";
    }
  }

  /**
   * Queue one event for upload. The payload is reduced to the allowlisted
   * shape BEFORE it is stored; a payload with nothing allowlisted is dropped.
   * Returns whether the event was queued. Never throws, never blocks the REPL.
   */
  publish(eventType: RcEventType, payload: Record<string, unknown>): boolean {
    if (this.stopped || !this.state || this.phase === "failed") return false;
    const safe = sanitizeRemotePayload(eventType, payload, {
      projectRoot: this.options.projectRoot,
      ...(this.options.env ? { env: this.options.env } : {}),
    });
    if (!safe) return false;
    const limit = this.options.maxOutbox ?? RC_MAX_OUTBOX;
    if (this.state.outbox.length >= limit) {
      this.state.outbox.shift();
      this.dropped += 1;
    }
    this.state.outbox.push({
      host_event_id: `he_${randomUUID()}`,
      event_type: eventType,
      payload: safe,
      created_at: new Date().toISOString(),
    });
    this.persist();
    void this.flush();
    return true;
  }

  /** Drain the outbox to the broker. Safe to call at any time; reentrant calls
   *  coalesce. Re-sent events are deduped broker-side by host_event_id. */
  async flush(): Promise<void> {
    const next = this.flushChain.then(() => this.drain());
    // The chain itself must never carry a rejection forward; drain() already
    // converts failures into status, but belt and braces.
    this.flushChain = next.catch(() => undefined);
    return next;
  }

  private async drain(): Promise<void> {
    if (this.stopped || !this.state || this.phase === "failed") return;
    while (this.state && this.state.outbox.length > 0 && !this.stopped) {
      const batch = this.state.outbox.slice(0, RC_BATCH_SIZE);
      let response: RcAppendResponse;
      try {
        // R1's /host/events handler (#1328) authenticates the append with the
        // host_secret and enforces G2 payload-bound idempotency: a re-sent
        // (host_event_id, payload) pair returns the original seq, but the SAME
        // id with a DIFFERENT payload is rejected 409 EventConflictError. We
        // never mutate a queued event's payload — each publish() mints a fresh
        // host_event_id over an already-sanitized, immutable payload — so a
        // replay after a flaky connection always re-sends identical content.
        response = await this.options.transport.postJson<RcAppendResponse>(
          rcEventsPath(this.state.sessionId),
          {
            ...(this.state.hostSecret ? { host_secret: this.state.hostSecret } : {}),
            events: batch,
          },
        );
      } catch (error) {
        // A 409 on the append is R1's EventConflictError (a host_event_id
        // re-used with a DIFFERENT payload) — NOT a host takeover, which only
        // 409s on register/attach. By construction we never re-send changed
        // content under an old id, so this means a single event in this batch
        // is poisoned. Drop it (rather than requeue it forever and wedge the
        // outbox) and keep the session; record it honestly.
        if (error instanceof HttpError && error.status === 409) {
          this.state.outbox.splice(0, batch.length);
          this.dropped += batch.length;
          this.persist();
          this.detail = "an event was rejected as a payload conflict (409) and dropped; the session continues";
          continue;
        }
        this.degrade(error);
        return;
      }
      // The whole request was accepted (2xx). Per-item receipts may still mark
      // individual events `rejected` — G4: the broker independently dropped that
      // one payload as secret-shaped. That is NOT a batch failure: drop those
      // items (they are already out of the outbox with the rest of the batch),
      // count them, and keep going. Everything else advanced.
      const receipts = Array.isArray(response?.receipts) ? response.receipts : [];
      const brokerRejected = receipts.filter((receipt) => receipt.rejected).length;
      const seqs = receipts.map((receipt) => receipt.seq).filter((seq): seq is number => typeof seq === "number");
      this.state.outbox.splice(0, batch.length);
      this.state.lastAckedSeq = seqs.length
        ? Math.max(this.state.lastAckedSeq, ...seqs)
        : typeof response?.acked_seq === "number"
          ? response.acked_seq
          : this.state.lastAckedSeq + (batch.length - brokerRejected);
      if (brokerRejected) this.dropped += brokerRejected;
      this.persist();
      this.becomeActive();
      if (brokerRejected) {
        this.detail = `${brokerRejected} event(s) dropped broker-side as secret-shaped (G4 redaction); the session continues`;
      }
    }
  }

  /**
   * `/rc off` — revoke ALL remote access (grants + observer streams) and tear
   * the relay down WITHOUT stopping the local Agent session. The broker revoke
   * is attempted but the local teardown happens regardless: revocation must
   * not depend on the network being up.
   */
  async off(): Promise<RcStatus> {
    // `/rc off` must work from a fresh process too: a session registered by an
    // earlier run left its durable state behind, and revoking it is exactly
    // what the user is asking for.
    if (!this.state) this.state = this.loadState();
    const sessionId = this.state?.sessionId;
    this.stopTimers();
    this.stopped = true;
    if (sessionId) {
      // Durable intent first: if the network request fails, retain the exact
      // server-side handle needed to retry. A later start refuses to re-attach
      // while this tombstone exists.
      this.state!.revokePending = true;
      this.persist();
      try {
        await this.options.transport.postJson(rcRevokePath(sessionId), {});
        this.detail = "remote access revoked";
      } catch (error) {
        this.phase = "failed";
        this.detail = `local relay stopped, but broker revocation is unconfirmed (${describe(error)}); retry \`/rc off\``;
        return this.status();
      }
    } else {
      this.detail = "remote control was not active";
    }
    this.clearState();
    this.phase = "off";
    return this.status();
  }

  /** End the host connection without revoking grants (process exit). The
   *  durable state stays so a later `/rc` can re-attach and resume. */
  stopLocal(): void {
    this.stopTimers();
    this.stopped = true;
    this.phase = "off";
    this.detail = "host disconnected; grants remain until they expire or `/rc off` revokes them";
  }

  status(): RcStatus {
    return {
      phase: this.phase,
      ...(this.state?.sessionId ? { sessionId: this.state.sessionId } : {}),
      ...(this.state?.sessionName ? { sessionName: this.state.sessionName } : {}),
      ...(this.state?.viewerUrl ? { viewerUrl: this.state.viewerUrl } : {}),
      ...(this.state?.redemptionUrl ? { redemptionUrl: this.state.redemptionUrl } : {}),
      ...(this.state?.expiresAt ? { expiresAt: this.state.expiresAt } : {}),
      pendingEvents: this.state?.outbox.length ?? 0,
      lastAckedSeq: this.state?.lastAckedSeq ?? 0,
      droppedEvents: this.dropped,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private becomeActive(): void {
    this.phase = "active";
    this.attempt = 0;
    this.detail = undefined;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private fail(detail: string): void {
    this.phase = "failed";
    this.detail = detail;
    this.stopTimers();
  }

  private degrade(error: unknown): void {
    if (error instanceof HttpError && error.status === 409) {
      this.fail("another host took over this session (409) — remote control stopped; the local session is unaffected");
      return;
    }
    this.phase = "reconnecting";
    this.detail = `broker unreachable (${describe(error)}); retrying with backoff — the local session is unaffected`;
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.stopped) return;
    const delay = computeBackoffMs(this.attempt, this.options.random ?? Math.random);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
    this.retryTimer.unref?.();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    const interval = this.options.heartbeatMs ?? RC_HEARTBEAT_MS;
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeatOnce();
    }, interval);
    this.heartbeatTimer.unref?.();
  }

  private async heartbeatOnce(): Promise<void> {
    if (!this.state || this.stopped || this.phase === "failed") return;
    try {
      // R1's /host/heartbeat reuses the RemoteHostAttach model (extra="forbid"),
      // so it requires the device_id — an empty body would 422.
      await this.options.transport.postJson(rcHeartbeatPath(this.state.sessionId), { device_id: this.deviceId });
      if (this.phase === "reconnecting" && this.state.outbox.length === 0) this.becomeActive();
    } catch (error) {
      this.degrade(error);
    }
  }

  private stopTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private loadState(): RcHostState | null {
    const read = readJsonFile<RcHostState>(this.options.statePath);
    if (!read.ok) return null;
    const value = read.value;
    if (!value || value.version !== 1 || typeof value.sessionId !== "string" || !value.sessionId) return null;
    if (!Array.isArray(value.outbox) || typeof value.lastAckedSeq !== "number") return null;
    // A cursor written before device ids were persisted has none; adopt this
    // client's id so attach/heartbeat still present one.
    if (typeof value.deviceId !== "string" || !value.deviceId) value.deviceId = this.deviceId;
    return value;
  }

  private persist(): void {
    if (!this.state) return;
    try {
      atomicWriteFile(this.options.statePath, JSON.stringify(this.state, null, 2) + "\n", { mode: 0o600 });
    } catch {
      // Durability is best-effort; losing the cursor only costs replay, and
      // replay is safe (broker dedupe). The live session must not care.
    }
  }

  private clearState(): void {
    this.state = null;
    try {
      unlinkSync(this.options.statePath);
    } catch {
      // Already gone, or unremovable — either way nothing here grants access
      // by itself: the state carries the host secret, not the auth token, and
      // revocation is enforced server-side.
    }
  }
}

// ── session-wide singleton ───────────────────────────────────────────────────
// The REPL owns one host at a time; commands reach it through this accessor so
// future producers (transcript, tests, diff summaries) can publish without
// threading the client through every call site.

let currentHost: RemoteHostClient | null = null;

export function getRemoteHost(): RemoteHostClient | null {
  return currentHost;
}

export function setRemoteHost(host: RemoteHostClient | null): void {
  currentHost = host;
}

function describe(error: unknown): string {
  if (error instanceof HttpError) return `HTTP ${error.status}`;
  if (error instanceof Error) return error.message.slice(0, 120);
  return String(error).slice(0, 120);
}
