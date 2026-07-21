// UVT /bench — performance profiling + optimization. Orchestrator-gated.

import type { ApiClient } from "./transport.js";
import { AGENT_BENCH_PATH, defaultStreamTimeoutMs } from "./transport.js";

export interface BenchRequest {
  agent: string;
  target: string;
}

export interface BenchResponse {
  complexity?: string;
  bottlenecks: string[];
  optimizations: Array<{ description: string; improvement: string }>;
  patches: Array<{ file: string; content: string }>;
  before_profile?: string;
  after_profile?: string;
}

export async function runBenchmark(
  api: ApiClient,
  agent: string,
  target: string,
): Promise<BenchResponse> {
  // Blocks server-side until the profiling + optimization pass completes
  // (returns patches/profiles, not a job handle) — same class of long-running
  // call as chat's non-streaming fallback, so it opts into stream()'s own
  // generous bound instead of request()'s 30s metadata-call default
  // (LOOP-01/LOOP-06 round-1).
  return api.postJson<BenchResponse>(
    AGENT_BENCH_PATH,
    { agent, target } as BenchRequest,
    undefined,
    defaultStreamTimeoutMs(),
  );
}
