// UVT /bench — performance profiling + optimization. Orchestrator-gated.

import type { ApiClient } from "./transport.js";
import { AGENT_BENCH_PATH } from "./transport.js";

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
  return api.postJson<BenchResponse>(AGENT_BENCH_PATH, {
    agent,
    target,
  } as BenchRequest);
}
