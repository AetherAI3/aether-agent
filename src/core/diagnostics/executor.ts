// Bounded worker pool for diagnostic checks. Results keep declaration order
// regardless of completion order; every check is individually fail-soft.

import type { DiagnosticCheck, DiagnosticStatus } from "./contracts.js";

export const DIAGNOSTIC_CONCURRENCY = 8;

export interface CheckOutcome {
  status: DiagnosticStatus;
  detail: string;
  configured?: boolean;
  reachable?: boolean;
  verified?: boolean;
}

export interface DiagnosticCheckSpec {
  id: string;
  category: string;
  run(): Promise<CheckOutcome> | CheckOutcome;
}

export interface ExecutedCheck extends DiagnosticCheck {
  configured: boolean;
  reachable: boolean;
  verified: boolean;
}

/** Per-check network/API budget: 100ms..10s, default 2s. */
export function clampDiagnosticTimeout(timeoutMs?: number): number {
  return Math.max(100, Math.min(timeoutMs ?? 2000, 10000));
}

function monotonicMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

export async function executeDiagnosticChecks(
  specs: DiagnosticCheckSpec[],
  concurrency = DIAGNOSTIC_CONCURRENCY,
): Promise<ExecutedCheck[]> {
  const width = Math.max(1, Math.min(Math.floor(concurrency), 32));
  const results: ExecutedCheck[] = new Array(specs.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= specs.length) return;
      const spec = specs[index]!;
      const started = monotonicMs();
      try {
        const result = await spec.run();
        results[index] = {
          id: spec.id,
          category: spec.category,
          status: result.status,
          detail: result.detail,
          configured: result.configured ?? result.status !== "skip",
          reachable: result.reachable ?? false,
          verified: result.verified ?? result.status === "pass",
          durationMs: Math.max(0, monotonicMs() - started),
        };
      } catch {
        results[index] = {
          id: spec.id,
          category: spec.category,
          status: "fail",
          detail: "check failed safely",
          configured: false,
          reachable: false,
          verified: false,
          durationMs: Math.max(0, monotonicMs() - started),
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, specs.length) }, () => worker()));
  return results;
}
