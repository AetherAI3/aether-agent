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
export const PROTOCOL_VERSION = 3;

// --- workflow swarm frame interfaces ---------------------------------------
export interface WorkflowStartFrame {
  type: "workflow_start";
  workflowId: string;
  phases: Array<{ n: number; type: string; agents: number }>;
  totalAgents: number;
}
export interface PhaseStartFrame {
  type: "phase_start";
  phaseN: number;
  phaseType: string;
  agentCount: number;
}
export interface PhaseDoneFrame {
  type: "phase_done";
  phaseN: number;
  artifactSummary: string;
}
export interface AgentSpawnFrame {
  type: "agent_spawn";
  agentId: string;
  phaseN: number;
  brief: string;
}
export interface AgentProgressFrame {
  type: "agent_progress";
  agentId: string;
  delta: string;
}
export interface AgentDoneFrame {
  type: "agent_done";
  agentId: string;
  phaseN: number;
  summary: string;
  // Tier-2/3 metrics (docs/specs/2026-07-10-workflow-viewer-agent-panel-design.md,
  // Finding E) — additive optional fields per CONTRACTS.md's versioning rule, so
  // a brain that doesn't send them yet never breaks old (or new) consumers.
  // undefined (not 0) when absent — the UI renders "—", never a fabricated number.
  tokens?: number;
  toolCalls?: number;
  durationMs?: number;
}
export interface WorkflowDoneFrame {
  type: "workflow_done";
  synthesis: string;
  totalPhases: number;
  totalAgents: number;
}

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
  | { type: "error"; msg: string }
  // memory bridge — QOPC memory frames forwarded as events
  | {
      type: "memory";
      subtype: string;
      text?: string;
      kind?: string;
      confidence?: number;
      skill?: string;
      narrative?: string;
      factCount?: number;
      beforeTokens?: number;
      afterTokens?: number;
      freedPct?: number;
      dimension?: string;
      from?: number;
      to?: number;
      direction?: string;
      // behavioral skill fields (subtype "behavioral")
      skill_name?: string;
      description?: string;
      triggers?: string[];
      action?: string;
      category?: string;
    }
  | WorkflowStartFrame
  | PhaseStartFrame
  | PhaseDoneFrame
  | AgentSpawnFrame
  | AgentProgressFrame
  | AgentDoneFrame
  | WorkflowDoneFrame;

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
  "web_search",
  "web_fetch",
] as const;
export type ToolName = (typeof TOOLS)[number];

// --- decode (wire object -> BrainEvent) ------------------------------------
const num = (v: unknown, d = 0): number => (v == null ? d : Number(v));
const str = (v: unknown, d = ""): string => (v == null ? d : String(v));
// Absent optional wire field -> undefined (not 0/false) — a missing Tier-2/3
// metric must never be indistinguishable from a real zero (Finding E). A
// non-numeric garbage value (e.g. tokens:"abc") must also decode as absent,
// not NaN — NaN != null is true in JS, so a naive version would let it slip
// through as "present" and render the literal string "NaN".
const numOrUndef = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

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
    case "workflow_start":
      return {
        type: "workflow_start",
        workflowId: str(obj["workflow_id"]),
        phases: (Array.isArray(obj["phases"]) ? obj["phases"] : []) as Array<{ n: number; type: string; agents: number }>,
        totalAgents: num(obj["total_agents"]),
      };
    case "phase_start":
      return {
        type: "phase_start",
        phaseN: num(obj["phase_n"]),
        phaseType: str(obj["phase_type"]),
        agentCount: num(obj["agent_count"]),
      };
    case "phase_done":
      return {
        type: "phase_done",
        phaseN: num(obj["phase_n"]),
        artifactSummary: str(obj["artifact_summary"]),
      };
    case "agent_spawn":
      return {
        type: "agent_spawn",
        agentId: str(obj["agent_id"]),
        phaseN: num(obj["phase_n"]),
        brief: str(obj["brief"]),
      };
    case "agent_progress":
      return {
        type: "agent_progress",
        agentId: str(obj["agent_id"]),
        delta: str(obj["delta"]),
      };
    case "agent_done":
      return {
        type: "agent_done",
        agentId: str(obj["agent_id"]),
        phaseN: num(obj["phase_n"]),
        summary: str(obj["summary"]),
        tokens: numOrUndef(obj["tokens"]),
        toolCalls: numOrUndef(obj["tool_calls"]),
        durationMs: numOrUndef(obj["duration_ms"]),
      };
    case "workflow_done":
      return {
        type: "workflow_done",
        synthesis: str(obj["synthesis"]),
        totalPhases: num(obj["total_phases"]),
        totalAgents: num(obj["total_agents"]),
      };
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
        // CONTRACTS.md: test_cmd="" means unverifiable — must match the
        // host's own default (code.ts only runs its final gate when
        // --test-cmd is explicit). Defaulting to "pytest -q" here made the
        // brain self-verify Python repos while the host still reported
        // "unverified", and made it grind pytest pointlessly in JS/Go/Rust
        // repos when the user simply forgot the flag.
        test_cmd: cmd.testCmd ?? "",
      };
      break;
    case "tool_result":
      wire = { type: "tool_result", id: cmd.id, output: cmd.output, exit_code: cmd.exitCode };
      break;
    case "control":
      wire = { type: "control", action: cmd.action, note: cmd.note ?? "" };
      break;
  }
  // CONTRACTS.md invariant 3: the wire is ASCII-escaped (ensure_ascii) so it
  // survives a Windows cp1252 pipe. Raw UTF-8 here corrupts (…→â€¦) or
  // crashes (UnicodeDecodeError on bytes undefined in cp1252) the Python
  // brain — capped tool_results inject '…' on every truncation.
  return asciiEscape(JSON.stringify(wire)) + "\n";
}

/** \uXXXX-escape every non-ASCII char (JSON-semantically identical). */
export function asciiEscape(json: string): string {
  return json.replace(/[\u0080-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
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
