// Universal stream decoder.
//
// Frame vocabulary is the canonical AetherCloud UVT streaming wire contract:
//   AETHER-CLOUD docs/superpowers/specs/2026-05-31-uvt-stream-contract.md
//   the Aether streaming contract
//
// One vocabulary across every path: chat (/agent/chat/stream), orchestrator
// (/project/stream/{id}), and MCP agent (/agent/mcp-chat). Unknown `type`s MUST
// be ignored. The CF-flush preamble (`:<4096 spaces>`) and `ping` heartbeat are
// handled here (comment lines skipped; ping surfaced as a typed liveness frame).

export type StreamFrame =
  // shared
  | { type: "open" }
  | { type: "ping" }
  | { type: "reasoning"; text: string }
  | { type: "delta"; text: string }
  | { type: "usage"; uvt: number; cents: number }
  | { type: "done"; uvt: number; cents: number; inputTokens?: number; outputTokens?: number }
  | { type: "error"; msg: string; errorCode?: string; refId?: string }
  // The server-signed chain-of-custody for this turn (commitment + attestation).
  // The server signs but never stores it — the client decides whether to persist
  // (the CLI logs it locally; a web client may show-then-discard).
  | { type: "custody"; custody: Record<string, unknown> }
  // orchestrator-only (/project/stream)
  | { type: "connected" }
  | { type: "progress"; text?: string }
  | { type: "task_start"; taskId?: string; label?: string }
  | { type: "task_progress"; taskId: string; delta?: string; uvt?: number; cents?: number }
  | { type: "task_done"; taskId?: string }
  | { type: "task_failed"; taskId?: string; msg?: string }
  | { type: "task_blocked"; taskId?: string; msg?: string }
  | { type: "project_done" }
  // memory bridge — QOPC memory frames (subtype-discriminated, forward-compat)
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
    };

/** Normalize a parsed JSON object (snake_case wire → camelCase) into a frame. */
export function normalizeFrame(obj: Record<string, unknown>): StreamFrame | null {
  const type = obj["type"];
  if (typeof type !== "string") return null;
  switch (type) {
    case "open":
      return { type: "open" };
    case "ping":
      return { type: "ping" };
    case "reasoning":
      return { type: "reasoning", text: String(obj["text"] ?? "") };
    case "delta":
      return { type: "delta", text: String(obj["text"] ?? "") };
    case "usage":
      return { type: "usage", uvt: Number(obj["uvt"] ?? 0), cents: Number(obj["cents"] ?? 0) };
    case "done":
      return {
        type: "done",
        uvt: Number(obj["uvt"] ?? 0),
        cents: Number(obj["cents"] ?? 0),
        inputTokens: numOrUndef(obj["input_tokens"] ?? obj["inputTokens"]),
        outputTokens: numOrUndef(obj["output_tokens"] ?? obj["outputTokens"]),
      };
    case "error":
      return {
        type: "error",
        msg: String(obj["msg"] ?? obj["message"] ?? ""),
        errorCode: strOrUndef(obj["error_code"] ?? obj["errorCode"]),
        refId: strOrUndef(obj["ref_id"] ?? obj["refId"]),
      };
    case "custody":
      return {
        type: "custody",
        custody: (obj["custody"] as Record<string, unknown>) ?? {},
      };
    case "connected":
      return { type: "connected" };
    case "progress":
      return { type: "progress", text: strOrUndef(obj["text"]) };
    case "task_start":
      return {
        type: "task_start",
        taskId: strOrUndef(obj["task_id"] ?? obj["taskId"]),
        label: strOrUndef(obj["label"]),
      };
    case "task_progress":
      return {
        type: "task_progress",
        taskId: String(obj["task_id"] ?? obj["taskId"] ?? ""),
        delta: strOrUndef(obj["delta"]),
        uvt: numOrUndef(obj["uvt"]),
        cents: numOrUndef(obj["cents"]),
      };
    case "task_done":
      return { type: "task_done", taskId: strOrUndef(obj["task_id"] ?? obj["taskId"]) };
    case "task_failed":
      return {
        type: "task_failed",
        taskId: strOrUndef(obj["task_id"] ?? obj["taskId"]),
        msg: strOrUndef(obj["msg"]),
      };
    case "task_blocked":
      return {
        type: "task_blocked",
        taskId: strOrUndef(obj["task_id"] ?? obj["taskId"]),
        msg: strOrUndef(obj["msg"]),
      };
    case "project_done":
      return { type: "project_done" };
    case "memory": {
      const subtype = String(obj["subtype"] ?? "");
      return {
        type: "memory",
        subtype,
        text: strOrUndef(obj["text"]),
        kind: strOrUndef(obj["kind"]),
        confidence: numOrUndef(obj["confidence"]),
        skill: strOrUndef(obj["skill"]),
        narrative: strOrUndef(obj["narrative"]),
        factCount: numOrUndef(obj["fact_count"] ?? obj["factCount"]),
        beforeTokens: numOrUndef(obj["before_tokens"] ?? obj["beforeTokens"]),
        afterTokens: numOrUndef(obj["after_tokens"] ?? obj["afterTokens"]),
        freedPct: numOrUndef(obj["freed_pct"] ?? obj["freedPct"]),
        dimension: strOrUndef(obj["dimension"]),
        from: numOrUndef(obj["from"]),
        to: numOrUndef(obj["to"]),
        direction: strOrUndef(obj["direction"]),
        skill_name: strOrUndef(obj["skill_name"]),
        description: strOrUndef(obj["description"]),
        triggers: parseStrArray(obj["triggers"]),
        action: strOrUndef(obj["action"]),
        category: strOrUndef(obj["category"]),
      };
    }
    default:
      return null; // unknown type — ignore per contract
  }
}

/** Parse one raw SSE event block ("data: {...}" possibly multi-line). */
export function parseEvent(raw: string): StreamFrame | null {
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed.startsWith(":")) continue; // SSE comment / CF preamble / legacy keepalive
    if (trimmed.startsWith("data:")) {
      dataLines.push(trimmed.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n").trim();
  if (!payload || payload[0] === ":" || payload === "[DONE]") return null;
  try {
    const obj = JSON.parse(payload) as Record<string, unknown>;
    return normalizeFrame(obj);
  } catch {
    return null; // partial / malformed — drop without throwing
  }
}

/** Decode a byte stream of SSE into a sequence of typed frames. */
export async function* decodeSse(
  stream: AsyncIterable<Uint8Array>,
): AsyncGenerator<StreamFrame> {
  const td = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += td.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const frame = parseEvent(raw);
      if (frame) yield frame;
    }
  }
  const tail = parseEvent(buf);
  if (tail) yield tail;
}

function numOrUndef(v: unknown): number | undefined {
  return v == null ? undefined : Number(v);
}
function strOrUndef(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}
function parseStrArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((x) => String(x));
}
