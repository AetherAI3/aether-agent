// Bridge protocol — the FROZEN event seam between a headless brain and this TS
// host. Mirror of aether_agent/protocol.py; wire keys are snake_case (the
// Python side's keys) and are mapped to camelCase here. One schema, two
// transports: local NDJSON over stdio (brain_local) · cloud SSE (brain_cloud).
//
// The brain DECIDES and emits events; the host (this process) RENDERS every
// event and EXECUTES every tool_call, replying with a tool_result. One tool
// implementation, one path-guard — so local and cloud UX are identical by
// construction. Canonical spec: docs/BRIDGE_PROTOCOL.md.

// Bump on ANY breaking change to the message shapes below. The Python mirror
// (aether_agent/protocol.py) MUST carry the same number; the conformance fixture
// (test/fixtures/bridge_conformance.json) pins both. Canonical: docs/CONTRACTS.md.
export const PROTOCOL_VERSION = 1;

// --- brain -> host events --------------------------------------------------
export type BrainEvent =
  | { type: "stage"; name: string; face: string }
  | { type: "monologue"; text: string; depth: number }
  | { type: "skill"; name: string; reason: string } // a procedure packet was pinned
  // per-assistant-turn diagnostics (the §8 emission curve feed)
  | {
      type: "turn";
      n: number;
      toolCalls: number;
      malformed: number;
      invented: number;
      noCall: boolean;
      failCount: number | null;
    }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "telemetry"; tokens: number; tps: number; ctxUsed: number; ctxCap: number; vram: number }
  | { type: "status"; phase: string; poolUsed: number; poolCap: number }
  | { type: "checkpoint"; gitSha: string }
  // ok is derived from a real final test run; remaining = failing tests when not ok;
  // reason ∈ "" | "stalled" | "no-progress" | "max-turns" | "unverified".
  | { type: "done"; ok: boolean; result: string; remaining: number; reason: string }
  | { type: "error"; msg: string };

// --- host -> brain commands ------------------------------------------------
export type HostCommand =
  | { type: "task"; text: string; cwd: string; poolGb: number; effort?: string; model?: string; testCmd?: string }
  | { type: "tool_result"; id: string; output: string; exitCode: number }
  | { type: "control"; action: "pause" | "resume" | "steer"; note?: string };

// Canonical tool names — the ONE implementation lives in tool_executor.ts.
export const TOOLS = [
  "read_file",
  "write_file",
  "run_shell",
  "run_tests",
  "repo_search",
  "git_commit",
] as const;
export type ToolName = (typeof TOOLS)[number];

// --- decode (wire object -> BrainEvent) ------------------------------------
const num = (v: unknown, d = 0): number => (v == null ? d : Number(v));
const str = (v: unknown, d = ""): string => (v == null ? d : String(v));

/** Normalize one parsed wire object into a typed BrainEvent (null = ignore). */
export function decodeEvent(obj: Record<string, unknown>): BrainEvent | null {
  const t = obj["type"];
  if (typeof t !== "string") return null;
  switch (t) {
    case "stage":
      return { type: "stage", name: str(obj["name"]), face: str(obj["face"]) };
    case "monologue":
      return { type: "monologue", text: str(obj["text"]), depth: num(obj["depth"]) };
    case "skill":
      return { type: "skill", name: str(obj["name"]), reason: str(obj["reason"]) };
    case "turn":
      return {
        type: "turn",
        n: num(obj["n"]),
        toolCalls: num(obj["tool_calls"]),
        malformed: num(obj["malformed"]),
        invented: num(obj["invented"]),
        noCall: Boolean(obj["no_call"]),
        failCount: obj["fail_count"] == null ? null : num(obj["fail_count"]),
      };
    case "tool_call":
      return {
        type: "tool_call",
        id: str(obj["id"]),
        name: str(obj["name"]),
        args: (obj["args"] as Record<string, unknown>) ?? {},
      };
    case "telemetry":
      return {
        type: "telemetry",
        tokens: num(obj["tokens"]),
        tps: num(obj["tps"]),
        ctxUsed: num(obj["ctx_used"]),
        ctxCap: num(obj["ctx_cap"]),
        vram: num(obj["vram"]),
      };
    case "status":
      return {
        type: "status",
        phase: str(obj["phase"]),
        poolUsed: num(obj["pool_used"]),
        poolCap: num(obj["pool_cap"]),
      };
    case "checkpoint":
      return { type: "checkpoint", gitSha: str(obj["git_sha"]) };
    case "done":
      return {
        type: "done",
        ok: Boolean(obj["ok"]),
        result: str(obj["result"]),
        remaining: num(obj["remaining"]),
        reason: str(obj["reason"]),
      };
    case "error":
      return { type: "error", msg: str(obj["msg"]) };
    default:
      return null; // unknown event type — ignore per contract
  }
}

/** Parse one NDJSON line into a BrainEvent (null for blank / malformed). */
export function parseEventLine(line: string): BrainEvent | null {
  const s = line.trim();
  if (!s) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
  return decodeEvent(obj);
}

// --- encode (HostCommand -> NDJSON line) -----------------------------------
/** One command -> one NDJSON line (newline included), wire keys snake_case. */
export function encodeCommand(cmd: HostCommand): string {
  let wire: Record<string, unknown>;
  switch (cmd.type) {
    case "task":
      wire = {
        type: "task",
        text: cmd.text,
        cwd: cmd.cwd,
        pool_gb: cmd.poolGb,
        effort: cmd.effort ?? "",
        model: cmd.model ?? "",
        // default pytest -q on the brain side; pass through what the host has.
        test_cmd: cmd.testCmd ?? "pytest -q",
      };
      break;
    case "tool_result":
      wire = { type: "tool_result", id: cmd.id, output: cmd.output, exit_code: cmd.exitCode };
      break;
    case "control":
      wire = { type: "control", action: cmd.action, note: cmd.note ?? "" };
      break;
  }
  return JSON.stringify(wire) + "\n";
}

// --- NDJSON line buffer (partial-line safe stdout framing) -----------------
/** Accumulates byte chunks and yields complete lines. Robust to a JSON object
 * split across chunk boundaries — the LSP/DAP framing pattern. */
export class LineBuffer {
  private buf = "";
  /** Feed a decoded string chunk; return the complete lines it produced. */
  push(chunk: string): string[] {
    this.buf += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) !== -1) {
      lines.push(this.buf.slice(0, idx));
      this.buf = this.buf.slice(idx + 1);
    }
    return lines;
  }
  /** Any trailing partial line (no newline yet). */
  rest(): string {
    return this.buf;
  }
}
