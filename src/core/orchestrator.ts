import type { ApiClient } from "./transport.js";
import { AGENT_DELEGATE_PATH, AGENT_TREE_PATH, AGENT_BROADCAST_PATH, AGENT_GATHER_PATH } from "./transport.js";
import type { AppContext } from "./context.js";
import type { Writable } from "node:stream";

export interface DelegateRequest {
  model: string;
  task: string;
}

export interface DelegateResponse {
  worker_id: string;
  status: string;
}

export interface TreeWorker {
  id: string;
  model: string;
  step: string;
  tokens: number;
  uvt: number;
}

export interface TreeResponse {
  orchestrator: string;
  workers: TreeWorker[];
}

export interface BroadcastRequest {
  message: string;
}

export interface BroadcastResponse {
  delivered_to: number;
}

export interface GatherResult {
  worker_id: string;
  files: string[];
  diffs: string[];
  patches: string[];
}

export interface GatherResponse {
  results: GatherResult[];
}

export async function delegateWorker(api: ApiClient, agent: string, model: string, task: string): Promise<DelegateResponse> {
  return api.postJson<DelegateResponse>(AGENT_DELEGATE_PATH, { agent, model, task });
}

export async function getOrchTree(api: ApiClient, agent: string): Promise<TreeResponse> {
  return api.getJson<TreeResponse>(AGENT_TREE_PATH + "?agent=" + encodeURIComponent(agent));
}

export async function broadcastToAgents(api: ApiClient, agent: string, message: string): Promise<BroadcastResponse> {
  return api.postJson<BroadcastResponse>(AGENT_BROADCAST_PATH, { agent, message });
}

export async function gatherResults(api: ApiClient, agent: string, workerId: string): Promise<GatherResponse> {
  return api.postJson<GatherResponse>(AGENT_GATHER_PATH, { agent, worker_id: workerId });
}

/** Returns true if an orchestrator is active. Writes rejection and returns false if not. */
export function requireOrchestrator(ctx: AppContext, out: Writable): boolean {
  if (!ctx.flags.agent) {
    out.write("This command requires an active orchestrator. Use /agent to select Neo or Kronus.\n");
    return false;
  }
  return true;
}
