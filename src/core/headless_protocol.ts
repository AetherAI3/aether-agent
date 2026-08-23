import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export const HEADLESS_PROTOCOL = "aether.exec/1";
export const HEADLESS_CONTROL_PROTOCOL = "aether.exec.control/1";
export const HEADLESS_MAX_LINE_BYTES = 16 * 1024;

export interface HeadlessFrame {
  protocol: typeof HEADLESS_PROTOCOL;
  sequence: number;
  correlation_id: string;
  type: string;
  [key: string]: unknown;
}

const SECRET_KEY = /(?:authorization|api[-_]?key|(?:access[-_]?|refresh[-_]?)?token|password|secret|cookie)/i;
const SECRET_VALUE = /\b(?:Bearer\s+[A-Za-z0-9._~+\/-]{8,}|sk-[A-Za-z0-9_-]{8,}|gh[opusr]_[A-Za-z0-9_]{8,})\b/gi;

export function redactHeadless(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[REDACTED]");
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

  constructor(
    private readonly root: string,
    private readonly write: (line: string) => void = (line) => process.stdout.write(line),
    sessionId: string = randomUUID(),
  ) {
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
    const base = {
      protocol: HEADLESS_PROTOCOL,
      sequence: this.sequence++,
      correlation_id: correlationId,
      type,
      ...redactHeadless(payload) as Record<string, unknown>,
    } satisfies HeadlessFrame;
    let line = JSON.stringify(base);
    if (Buffer.byteLength(line, "utf8") > HEADLESS_MAX_LINE_BYTES) {
      const dir = resolve(this.root, ".aether", "artifacts", this.sessionId);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const name = `${base.sequence}-${type.replace(/[^a-z0-9_-]/gi, "_")}.json`;
      const absolute = resolve(dir, name);
      const artifact = JSON.stringify(base, null, 2) + "\n";
      writeFileSync(absolute, artifact, { encoding: "utf8", mode: 0o600 });
      const bounded: HeadlessFrame = {
        protocol: HEADLESS_PROTOCOL,
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
}

export interface ControlFrame {
  protocol: typeof HEADLESS_CONTROL_PROTOCOL;
  sequence: number;
  correlation_id: string;
  action: "cancel" | "pause" | "resume" | "steer";
  note?: string;
}

export function parseControlFrame(line: string): { ok: true; frame: ControlFrame } | { ok: false; error: string } {
  if (Buffer.byteLength(line, "utf8") > HEADLESS_MAX_LINE_BYTES) return { ok: false, error: "control frame exceeds 16384 bytes" };
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return { ok: false, error: "malformed JSON" }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "control frame must be an object" };
  const obj = raw as Record<string, unknown>;
  if (obj["protocol"] !== HEADLESS_CONTROL_PROTOCOL) return { ok: false, error: "unsupported control protocol" };
  if (!Number.isSafeInteger(obj["sequence"]) || Number(obj["sequence"]) < 0) return { ok: false, error: "invalid control sequence" };
  if (typeof obj["correlation_id"] !== "string" || !obj["correlation_id"]) return { ok: false, error: "missing correlation_id" };
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

export function validateHeadlessFrames(lines: readonly string[]): string[] {
  const errors: string[] = [];
  let expected = 0;
  let terminal = false;
  for (const [index, line] of lines.entries()) {
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(line) as Record<string, unknown>; }
    catch { errors.push(`line ${index + 1}: malformed JSON`); continue; }
    if (frame["protocol"] !== HEADLESS_PROTOCOL) errors.push(`line ${index + 1}: wrong protocol`);
    if (frame["sequence"] !== expected) errors.push(`line ${index + 1}: expected sequence ${expected}`);
    if (terminal) errors.push(`line ${index + 1}: frame after terminal`);
    if (frame["type"] === "terminal") {
      if (terminal) errors.push(`line ${index + 1}: duplicate terminal frame`);
      terminal = true;
    }
    expected++;
  }
  if (!terminal) errors.push("missing terminal frame");
  return errors;
}
