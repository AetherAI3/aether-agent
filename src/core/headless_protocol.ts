import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { redactForBundle, SENSITIVE_KEY } from "./redaction.js";

export const HEADLESS_PROTOCOL = "aether.exec/1";
export const HEADLESS_PROTOCOL_V2 = "aether.exec/2";
export const HEADLESS_CONTROL_PROTOCOL = "aether.exec.control/1";
export const HEADLESS_CONTROL_PROTOCOL_V2 = "aether.exec.control/2";
export const HEADLESS_MAX_LINE_BYTES = 16 * 1024;
export type HeadlessProtocol = typeof HEADLESS_PROTOCOL | typeof HEADLESS_PROTOCOL_V2;
export type HeadlessControlProtocol = typeof HEADLESS_CONTROL_PROTOCOL | typeof HEADLESS_CONTROL_PROTOCOL_V2;

export interface HeadlessFrame {
  protocol: HeadlessProtocol;
  sequence: number;
  correlation_id: string;
  type: string;
  [key: string]: unknown;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FRAME_TYPE = /^[a-z][a-z0-9_-]{0,63}$/;
const RESERVED = new Set(["protocol", "sequence", "correlation_id", "type"]);
const HEADLESS_SENSITIVE_KEY = /(?:token|secret|password|passwd|authorization|api[_-]?key|private[_-]?key|credential|pat|cookie|signature)/i;
const SECRET_VALUE = /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[opusr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,}|npm_[A-Za-z0-9]{8,}|pypi-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/gi;
const QUERY_SECRET = /([?&](?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|password|passwd|secret|signature|sig)=)[^&#\s]*/gi;
const FLAG_SECRET = /(--(?:password|passwd|token|api[_-]?key|secret)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const ASSIGNMENT_SECRET = /\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)[A-Za-z0-9_]*\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;"']+)/gi;
const AWS_SECRET = /\b(aws_secret_access_key\s*[=:]\s*)[A-Za-z0-9/+]{20,}/gi;

function redactHeadlessString(value: string): string {
  return redactForBundle(value)
    .replace(QUERY_SECRET, "$1[REDACTED]")
    .replace(FLAG_SECRET, "$1[REDACTED]")
    .replace(ASSIGNMENT_SECRET, "$1[REDACTED]")
    .replace(AWS_SECRET, "$1[REDACTED]")
    .replace(SECRET_VALUE, "[REDACTED]");
}

export function redactHeadless(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key) || HEADLESS_SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactHeadlessString(value);
  if (Array.isArray(value)) return value.map((item) => redactHeadless(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, redactHeadless(item, name)]),
    );
  }
  return value;
}

export class HeadlessWriter {
  private sequence = 0;
  private terminalWritten = false;
  readonly sessionId: string;

  private readonly root: string;

  constructor(
    root: string,
    private readonly write: (line: string) => void = (line) => process.stdout.write(line),
    sessionId: string = randomUUID(),
    private readonly protocol: HeadlessProtocol = HEADLESS_PROTOCOL,
  ) {
    if (!SAFE_ID.test(sessionId)) throw new Error("invalid headless session id");
    this.root = realpathSync(resolve(root));
    this.sessionId = sessionId;
  }

  emit(type: string, payload: Record<string, unknown> = {}, correlationId = this.sessionId): HeadlessFrame {
    if (this.terminalWritten) throw new Error("cannot emit after terminal frame");
    return this.writeFrame(type, payload, correlationId);
  }

  terminal(payload: Record<string, unknown>, correlationId = this.sessionId): HeadlessFrame | null {
    if (this.terminalWritten) return null;
    this.terminalWritten = true;
    return this.writeFrame("terminal", payload, correlationId);
  }

  private writeFrame(type: string, payload: Record<string, unknown>, correlationId: string): HeadlessFrame {
    if (!FRAME_TYPE.test(type)) throw new Error("invalid headless frame type");
    if (!SAFE_ID.test(correlationId)) throw new Error("invalid headless correlation id");
    const safePayload = Object.fromEntries(
      Object.entries(redactHeadless(payload) as Record<string, unknown>).filter(([key]) => !RESERVED.has(key)),
    );
    const base = {
      ...safePayload,
      protocol: this.protocol,
      sequence: this.sequence++,
      correlation_id: correlationId,
      type,
    } satisfies HeadlessFrame;
    let line = JSON.stringify(base);
    if (Buffer.byteLength(line, "utf8") > HEADLESS_MAX_LINE_BYTES) {
      const dir = this.containedArtifactPath(resolve(this.root, ".aether", "artifacts", this.sessionId));
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const name = `${base.sequence}-${type.replace(/[^a-z0-9_-]/gi, "_")}.json`;
      const absolute = this.containedArtifactPath(resolve(dir, name));
      const artifact = JSON.stringify(base, null, 2) + "\n";
      writeFileSync(absolute, artifact, { encoding: "utf8", mode: 0o600 });
      const bounded: HeadlessFrame = {
        protocol: this.protocol,
        sequence: base.sequence,
        correlation_id: correlationId,
        type,
        payload_bounded: true,
        artifact: {
          path: relative(this.root, absolute).replace(/\\/g, "/"),
          bytes: Buffer.byteLength(artifact),
          sha256: createHash("sha256").update(artifact).digest("hex"),
        },
      };
      line = JSON.stringify(bounded);
      this.write(line + "\n");
      return bounded;
    }
    this.write(line + "\n");
    return base;
  }

  private containedArtifactPath(target: string): string {
    const absolute = resolve(target);
    const rel = relative(this.root, absolute);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("artifact path escapes workspace");
    let ancestor = absolute;
    while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
    const realAncestor = existsSync(ancestor) ? realpathSync(ancestor) : ancestor;
    if (realAncestor !== this.root && !realAncestor.startsWith(this.root + sep)) {
      throw new Error("artifact path resolves outside workspace");
    }
    return absolute;
  }
}

export interface ControlFrame {
  protocol: HeadlessControlProtocol;
  sequence: number;
  correlation_id: string;
  action: "cancel" | "pause" | "resume" | "steer";
  note?: string;
}

export function parseControlFrame(
  line: string,
  expectedProtocol: HeadlessControlProtocol = HEADLESS_CONTROL_PROTOCOL,
): { ok: true; frame: ControlFrame } | { ok: false; error: string } {
  if (Buffer.byteLength(line, "utf8") > HEADLESS_MAX_LINE_BYTES) return { ok: false, error: "control frame exceeds 16384 bytes" };
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return { ok: false, error: "malformed JSON" }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "control frame must be an object" };
  const obj = raw as Record<string, unknown>;
  if (obj["protocol"] !== expectedProtocol) return { ok: false, error: "unsupported control protocol" };
  if (!Number.isSafeInteger(obj["sequence"]) || Number(obj["sequence"]) < 0) return { ok: false, error: "invalid control sequence" };
  if (typeof obj["correlation_id"] !== "string" || !SAFE_ID.test(obj["correlation_id"])) return { ok: false, error: "invalid correlation_id" };
  if (!["cancel", "pause", "resume", "steer"].includes(String(obj["action"]))) return { ok: false, error: "unsupported control action" };
  if (obj["note"] != null && (typeof obj["note"] !== "string" || Buffer.byteLength(obj["note"], "utf8") > 4096)) {
    return { ok: false, error: "invalid control note" };
  }
  return { ok: true, frame: obj as unknown as ControlFrame };
}

export class ControlLedger {
  private readonly seen = new Set<number>();
  private cancelled = false;
  private next = 0;

  accept(frame: ControlFrame): { accepted: true } | { accepted: false; error: string } {
    if (this.seen.has(frame.sequence)) return { accepted: false, error: "duplicate control sequence" };
    if (frame.sequence !== this.next) return { accepted: false, error: `expected control sequence ${this.next}` };
    this.seen.add(frame.sequence);
    this.next++;
    if (this.cancelled) return { accepted: false, error: "session cancelled" };
    if (frame.action === "cancel") this.cancelled = true;
    return { accepted: true };
  }
}

export const HEADLESS_V2_MAX_CONTROLS = 256;
export const HEADLESS_V2_MAX_STEERS = 16;
export const HEADLESS_V2_MAX_STEER_BYTES = 16 * 1024;

export interface V2ControlOutcome {
  accepted: boolean;
  action: ControlFrame["action"];
  state: "running" | "paused" | "cancelled";
  error?: string;
}

type V2ControlDecision =
  | { kind: "new" }
  | { kind: "duplicate"; outcome: V2ControlOutcome }
  | { kind: "rejected"; error: string };

interface V2ControlEntry {
  fingerprint: string;
  outcome: V2ControlOutcome | null;
}

/**
 * The v2 ledger is idempotent rather than fatal. An identical duplicate gets
 * its original outcome, a conflicting duplicate is refused, and a future
 * sequence is refused without consuming the missing slot. This lets a
 * controller retry after a lost acknowledgement without changing state.
 */
export class V2ControlLedger {
  private readonly entries = new Map<number, V2ControlEntry>();
  private next: number;
  private steerCount: number;
  private steerBytes: number;
  private cancelled = false;

  constructor(snapshot: { nextSequence?: number; steerCount?: number; steerBytes?: number } = {}) {
    this.next = snapshot.nextSequence ?? 0;
    this.steerCount = snapshot.steerCount ?? 0;
    this.steerBytes = snapshot.steerBytes ?? 0;
  }

  begin(frame: ControlFrame): V2ControlDecision {
    const fingerprint = JSON.stringify({ action: frame.action, note: frame.note ?? null });
    if (frame.sequence < this.next) {
      const prior = this.entries.get(frame.sequence);
      if (!prior) return { kind: "rejected", error: "stale control sequence" };
      if (prior.fingerprint !== fingerprint) return { kind: "rejected", error: "conflicting duplicate control sequence" };
      if (!prior.outcome) return { kind: "rejected", error: "control sequence is still pending" };
      return { kind: "duplicate", outcome: prior.outcome };
    }
    if (frame.sequence > this.next) return { kind: "rejected", error: `expected control sequence ${this.next}` };
    if (this.next >= HEADLESS_V2_MAX_CONTROLS) return { kind: "rejected", error: "control limit reached" };
    if (this.cancelled) return { kind: "rejected", error: "session cancelled" };
    if (frame.action === "steer") {
      const bytes = Buffer.byteLength(frame.note ?? "", "utf8");
      if (!frame.note?.trim()) return { kind: "rejected", error: "steer requires a non-empty note" };
      if (this.steerCount + 1 > HEADLESS_V2_MAX_STEERS || this.steerBytes + bytes > HEADLESS_V2_MAX_STEER_BYTES) {
        return { kind: "rejected", error: "steer budget exceeded" };
      }
      this.steerCount += 1;
      this.steerBytes += bytes;
    }
    this.entries.set(frame.sequence, { fingerprint, outcome: null });
    this.next += 1;
    return { kind: "new" };
  }

  complete(frame: ControlFrame, outcome: V2ControlOutcome): void {
    const entry = this.entries.get(frame.sequence);
    if (!entry || entry.outcome) throw new Error("control sequence was not pending");
    entry.outcome = { ...outcome };
    if (frame.action === "cancel" && outcome.accepted) this.cancelled = true;
  }

  snapshot(): { nextSequence: number; steerCount: number; steerBytes: number } {
    return { nextSequence: this.next, steerCount: this.steerCount, steerBytes: this.steerBytes };
  }
}

export function validateHeadlessFrames(lines: readonly string[], expectedProtocol: HeadlessProtocol = HEADLESS_PROTOCOL): string[] {
  const errors: string[] = [];
  let expected = 0;
  let terminal = false;
  let sessionId: string | null = null;
  let validSession = false;
  for (const [index, line] of lines.entries()) {
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(line) as Record<string, unknown>; }
    catch { errors.push(`line ${index + 1}: malformed JSON`); continue; }
    if (frame["protocol"] !== expectedProtocol) errors.push(`line ${index + 1}: wrong protocol`);
    if (!Number.isSafeInteger(frame["sequence"]) || frame["sequence"] !== expected) errors.push(`line ${index + 1}: expected sequence ${expected}`);
    if (typeof frame["type"] !== "string" || !FRAME_TYPE.test(frame["type"])) errors.push(`line ${index + 1}: invalid frame type`);
    if (typeof frame["correlation_id"] !== "string" || !SAFE_ID.test(frame["correlation_id"])) errors.push(`line ${index + 1}: invalid correlation_id`);
    if (index === 0) {
      if (frame["type"] !== "session") errors.push("first frame must be session");
      if (typeof frame["session"] !== "string" || frame["session"] !== frame["correlation_id"]) {
        errors.push("session frame identity must match correlation_id");
      } else if (frame["type"] === "session") validSession = true;
      if (typeof frame["session"] === "string") sessionId = frame["session"];
    }
    if (terminal) errors.push(`line ${index + 1}: frame after terminal`);
    if (frame["type"] === "terminal") {
      if (terminal) errors.push(`line ${index + 1}: duplicate terminal frame`);
      terminal = true;
      if (sessionId && frame["correlation_id"] !== sessionId) errors.push("terminal correlation_id must match session");
      if (typeof frame["ok"] !== "boolean") errors.push("terminal ok must be boolean");
      if (!Number.isSafeInteger(frame["exit_code"])) errors.push("terminal exit_code must be an integer");
      if (index !== lines.length - 1) errors.push("terminal frame must be last");
    }
    expected++;
  }
  if (!validSession) errors.push("missing valid session frame");
  if (!terminal) errors.push("missing terminal frame");
  return errors;
}
