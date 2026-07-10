// @aether/cli public API — the universal LLM route, for embedding.
//
// Desktop (Aether Agent), web (Aether AI), and the terminal all import this and
// route chat through the same client. The CLI binary (src/main.ts) is just the
// terminal frontend over this same core.

export { AetherClient, createClient } from "./core/client.js";
export type { ClientOptions, ChatOptions } from "./core/client.js";
export { decodeSse, normalizeFrame, parseEvent } from "./core/stream.js";
export type { StreamFrame } from "./core/stream.js";
export { buildChatRequest } from "./core/envelope.js";
export type { ChatWireRequest } from "./core/envelope.js";
export type { CatalogItem, CatalogResponse } from "./types.js";
// chatStream() can throw StreamTimeoutError (a quiet connection); hintFor() maps it
// (and other thrown errors) to the same recovery hint the terminal CLI shows.
export { StreamTimeoutError } from "./core/errors.js";
export { hintFor } from "./core/error_hints.js";

// ---- Embed surface: render the real agent terminal into a host (desktop/web) ----
export { createTerminalSession } from "./ui/terminal_session.js";
export type { TerminalSession, TerminalSessionOptions } from "./ui/terminal_session.js";
export { StdoutSink, StringSink } from "./ui/sink.js";
export type { RenderSink, StringSinkOptions } from "./ui/sink.js";
export { createTheme } from "./ui/theme.js";
export type { Theme } from "./ui/theme.js";
export { LocalAgentSource, mapBrainEvent } from "./core/agent_events.js";
export type { AgentSource, AgentEvent } from "./core/agent_events.js";
