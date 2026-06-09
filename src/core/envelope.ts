// Wire request for the chat/stream endpoints.
//
// The the Aether API's /agent/chat and /agent/chat/stream bind `ChatRequest`
// (the Aether API): { query, forced_model_key, agent_name, model_pick_source }.
// The CLI's coding concepts (workspace, permission mode, auto-apply) are NOT
// part of that contract yet — they stay local until a dedicated coding route
// exists. So the wire body is exactly ChatRequest; workspace context is gathered
// locally (see workspace.ts) and kept off the wire for now.

import type { PermissionMode } from "../types.js";

export interface WorkspaceContext {
  cwd: string;
  /** Relative path -> file contents the agent may read/edit. */
  files: Record<string, string>;
}

/** Exact wire shape bound by the the Aether API chat routes. */
export interface ChatWireRequest {
  query: string;
  /** Forced model id, or null to let the server smart-router pick. */
  forced_model_key: string | null;
  /** Named orchestrator/agent, or null for the default smart-router path. */
  agent_name: string | null;
  /** "manual" fires the per-model cap preflight; "auto" skips it. */
  model_pick_source: "manual" | "auto";
  /** Optional metadata for server-side directives (e.g. workflow_json). */
  meta?: Record<string, unknown> | null;
}

export interface BuildChatRequestArgs {
  prompt: string;
  model?: string;
  agent?: string;
  /** Did the user explicitly pick the model? Drives model_pick_source. */
  manualModel: boolean;
  /** Optional metadata forwarded to the server (workflow_json, etc.). */
  meta?: Record<string, unknown> | null;
}

export function buildChatRequest(args: BuildChatRequestArgs): ChatWireRequest {
  const model = args.model?.trim() || null;
  const agent = args.agent?.trim() || null;
  const req: ChatWireRequest = {
    query: args.prompt,
    forced_model_key: model,
    agent_name: agent,
    model_pick_source: args.manualModel && model ? "manual" : "auto",
  };
  if (args.meta) req.meta = args.meta;
  return req;
}

// Local-only coding envelope (kept for the future coding route + workspace).
export interface CodingEnvelope {
  prompt: string;
  model: string;
  agent: string;
  permissionMode: PermissionMode;
  autoApply: boolean;
  cwd: string;
  workspace?: WorkspaceContext;
}
