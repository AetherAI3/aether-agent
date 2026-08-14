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

// ── Agent dev sessions (POST /agent/dev/sessions) ───────────────────────────

/** Wire shape bound by AETHER-CLOUD api/routes/agent_dev_session_routes.py. */
export interface DevSessionWireRequest {
  task: string;
  surface: "aether_agent";
  model: string | null;
  effort: string | null;
  /** Tool names this host supports — the client owns the allowlist; the
   *  server intersects with its own known set and never sends anything else. */
  capabilities: string[];
  max_uvt?: number;
  repo?: Record<string, unknown>;
  protocol_version: number;
  /** Additive Skills & Health context (contract v1). Absent = legacy request,
   *  byte-identical to pre-skills clients — old servers never see the keys. */
  capability_contract_version?: number;
  skill_context?: Record<string, unknown>;
  instruction_context?: Record<string, unknown>;
}

export interface BuildDevSessionArgs {
  task: string;
  model?: string;
  effort?: string;
  capabilities: readonly string[];
  maxUvt?: number;
  repo?: Record<string, unknown>;
  protocolVersion: number;
  /** Typed skill context packet (context_packet.ts) serialized for the wire. */
  skillContext?: Record<string, unknown>;
  /** Typed instruction context packet (instruction_resolver.ts). */
  instructionContext?: Record<string, unknown>;
  capabilityContractVersion?: number;
}

export function buildDevSessionRequest(args: BuildDevSessionArgs): DevSessionWireRequest {
  const req: DevSessionWireRequest = {
    task: args.task,
    surface: "aether_agent",
    model: args.model?.trim() || null,
    effort: args.effort?.trim() || null,
    capabilities: [...args.capabilities],
    protocol_version: args.protocolVersion,
  };
  if (args.maxUvt && args.maxUvt > 0) req.max_uvt = args.maxUvt;
  if (args.repo) req.repo = args.repo;
  if (args.skillContext || args.instructionContext) {
    req.capability_contract_version = args.capabilityContractVersion ?? 1;
    if (args.skillContext) req.skill_context = args.skillContext;
    if (args.instructionContext) req.instruction_context = args.instructionContext;
  }
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
