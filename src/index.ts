// @aether/cli public API — the universal LLM route, for embedding.
//
// Desktop (Aether Code), web (Aether AI), and the terminal all import this and
// route chat through the same client. The CLI binary (src/main.ts) is just the
// terminal frontend over this same core.

export { AetherClient, createClient } from "./core/client.js";
export type { ClientOptions, ChatOptions } from "./core/client.js";
export { decodeSse, normalizeFrame, parseEvent } from "./core/stream.js";
export type { StreamFrame } from "./core/stream.js";
export { buildChatRequest } from "./core/envelope.js";
export type { ChatWireRequest } from "./core/envelope.js";
export type { CatalogItem, CatalogResponse } from "./types.js";
