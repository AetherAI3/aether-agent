// Direct Ollama client (OpenAI-compatible /v1/chat/completions, stream:false).
//
// This is the inference seam for the LOCAL brain when it runs entirely in TS
// (no Python). It mirrors the spirit of the sibling aether_agent reference:
//  - per-model sampling (profiles.py): coder models want low-temp determinism;
//    the Gemma family wants Google's sampling (temp 1.0 / top_k 64 / top_p 0.95).
//  - tool-call RECOVERY (toolparse.py): many small local models emit the tool
//    call as JSON TEXT in `content` instead of the structured `tool_calls` field.
//    extractToolCalls() recovers them so the loop never stalls on "no call".
//  - clear, actionable errors when Ollama is down or the model is not pulled.
//
// No new deps: Node's global fetch only.

export const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:7b";
const DEFAULT_TIMEOUT_MS = 600_000;

// --- wire types (OpenAI-compatible) ----------------------------------------
export interface ToolFunction {
  readonly name: string;
  /** JSON STRING (the OpenAI tool_call contract; the caller json-parses it). */
  readonly arguments: string;
}

export interface ToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: ToolFunction;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  /** present on assistant turns that called tools (or recovered from content). */
  readonly tool_calls?: readonly ToolCall[];
  /** present on role:"tool" replies — correlates to a tool_call id. */
  readonly tool_call_id?: string;
  readonly name?: string;
}

/** A tool advertised to the model (OpenAI function-tool schema, opaque here). */
export interface ToolSchema {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: Record<string, unknown>;
  };
}

export interface Sampling {
  readonly temperature: number;
  readonly top_p: number;
  readonly top_k: number;
}

export interface ChatOptions {
  readonly host?: string;
  readonly model?: string;
  readonly tools?: readonly ToolSchema[];
  /** Explicit temperature override; wins over the per-model profile default. */
  readonly temperature?: number;
  readonly timeoutMs?: number;
}

export interface ChatReply {
  readonly role: ChatRole;
  readonly content: string;
  readonly tool_calls?: readonly ToolCall[];
}

// --- per-model sampling (port of profiles.py spirit) ------------------------
interface Profile {
  readonly match: string; // lowercased substring that selects this profile
  readonly sampling: Sampling;
}

// Order matters: first substring match wins. Specific before generic.
const PROFILES: readonly Profile[] = [
  { match: "gemma", sampling: { temperature: 1.0, top_p: 0.95, top_k: 64 } },
  { match: "qwen", sampling: { temperature: 0.2, top_p: 0.9, top_k: 40 } },
  { match: "devstral", sampling: { temperature: 0.2, top_p: 0.9, top_k: 40 } },
  { match: "deepseek", sampling: { temperature: 0.3, top_p: 0.95, top_k: 40 } },
  { match: "coder", sampling: { temperature: 0.2, top_p: 0.9, top_k: 40 } },
];

// Safe default for an unknown tag: deterministic, like Qwen coding.
const DEFAULT_SAMPLING: Sampling = { temperature: 0.2, top_p: 0.9, top_k: 40 };

/** The sampling knobs for a model tag (first substring match; safe default). */
export function samplingFor(model: string): Sampling {
  const low = (model || "").toLowerCase();
  for (const p of PROFILES) {
    if (low.includes(p.match)) return p.sampling;
  }
  return DEFAULT_SAMPLING;
}

// --- tool-call recovery from content (port of toolparse.py) -----------------
/** Every top-level balanced {...} substring (string/escape aware). */
function balancedJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Normalize a parsed object to {name, args} if it looks like a tool call. */
function asCall(input: unknown): { name: string; args: Record<string, unknown> } | null {
  let obj = input;
  if (isRecord(obj) && isRecord(obj["tool_call"])) obj = obj["tool_call"];
  if (isRecord(obj) && isRecord(obj["function"])) obj = obj["function"];
  if (!isRecord(obj)) return null;
  const name = obj["name"];
  if (typeof name !== "string" || !name) return null;
  if (!("arguments" in obj) && !("parameters" in obj)) return null;
  let raw: unknown = "arguments" in obj ? obj["arguments"] : obj["parameters"];
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  const args = isRecord(raw) ? raw : {};
  return { name, args };
}

/** Pull the most-likely JSON-bearing fragments, best signal first. */
function candidates(content: string): string[] {
  const frags: string[] = [];
  const tag = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
  for (const m of content.matchAll(tag)) if (m[1]) frags.push(m[1]);
  const fence = /```(?:json|tool_code)?\s*(\{[\s\S]*?\})\s*```/g;
  for (const m of content.matchAll(fence)) if (m[1]) frags.push(m[1]);
  frags.push(...balancedJsonObjects(content));
  return frags;
}

/**
 * Recover OpenAI-shaped tool_calls from message content. Empty if none.
 * Deduplicates identical (name,args) and assigns stable ids call-1, call-2, …
 * `arguments` is a JSON STRING (matches the OpenAI tool_call contract).
 */
export function extractToolCalls(content: string | null | undefined): ToolCall[] {
  if (!content) return [];
  const seen = new Set<string>();
  const calls: ToolCall[] = [];
  for (const frag of candidates(content)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frag);
    } catch {
      continue;
    }
    const nc = asCall(parsed);
    if (!nc) continue;
    const key = nc.name + " " + stableStringify(nc.args);
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({
      id: `call-${calls.length + 1}`,
      type: "function",
      function: { name: nc.name, arguments: JSON.stringify(nc.args) },
    });
  }
  return calls;
}

/** Deterministic JSON (sorted keys) for dedupe — mirrors json.dumps(sort_keys). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

// --- response normalization -------------------------------------------------
function normalizeToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (!isRecord(c)) continue;
    const fn = c["function"];
    if (!isRecord(fn) || typeof fn["name"] !== "string") continue;
    const argsRaw = fn["arguments"];
    const args = typeof argsRaw === "string" ? argsRaw : JSON.stringify(argsRaw ?? {});
    const id = typeof c["id"] === "string" && c["id"] ? c["id"] : `call-${i + 1}`;
    out.push({ id, type: "function", function: { name: fn["name"], arguments: args } });
  }
  return out;
}

// --- the client -------------------------------------------------------------
/**
 * One non-streaming chat turn against an Ollama OpenAI-compatible endpoint.
 * Throws an Error with an actionable hint when Ollama is unreachable or the
 * model is not pulled. On success returns {role, content, tool_calls?}, where
 * tool_calls is taken from the structured field when present, else RECOVERED
 * from JSON emitted in the content (the small-model stall fix).
 */
export async function ollamaChat(
  messages: readonly ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatReply> {
  const host = (opts.host || process.env["OLLAMA_HOST"] || DEFAULT_OLLAMA_HOST).replace(/\/+$/, "");
  const model = opts.model || DEFAULT_OLLAMA_MODEL;
  const sampling = samplingFor(model);
  const temperature = opts.temperature ?? sampling.temperature;
  const url = `${host}/v1/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    temperature,
    top_p: sampling.top_p,
    top_k: sampling.top_k,
  };
  if (opts.tools && opts.tools.length > 0) body["tools"] = opts.tools;

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if ((err instanceof Error && err.name === "AbortError") || msg.includes("aborted")) {
      throw new Error(`Ollama request timed out after ${Math.round(timeoutMs / 1000)}s (${url}).`);
    }
    throw new Error(
      `Cannot reach Ollama at ${host}. Is it running? Start it with 'ollama serve' ` +
        `(default port 11434), or set OLLAMA_HOST. Underlying error: ${msg}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 404) {
      throw new Error(
        `Ollama model '${model}' not found (404). Pull it first: 'ollama pull ${model}'. ` +
          `Server said: ${text.slice(0, 300)}`,
      );
    }
    throw new Error(`Ollama error ${res.status} at ${url}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const choices = json["choices"];
  const first = Array.isArray(choices) && isRecord(choices[0]) ? (choices[0] as Record<string, unknown>) : {};
  const message = isRecord(first["message"]) ? (first["message"] as Record<string, unknown>) : {};
  const content = typeof message["content"] === "string" ? message["content"] : "";

  const structured = normalizeToolCalls(message["tool_calls"]);
  const toolCalls = structured.length > 0 ? structured : extractToolCalls(content);

  const reply: ChatReply = {
    role: "assistant",
    content,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
  return reply;
}
