// Doctor check registry and report runner.
//
// Fast contract: mode "fast" (and "fix") performs NO network calls, NO
// mutations, NO model calls — checks above the mode rank are emitted as skip
// without running. "network" (alias --deep) adds bounded backend probes.

import type { AppContext } from "../context.js";
import type { MemoryRoots } from "../memory.js";
import type { McpClient } from "../mcp.js";
import { LocalMcpStore } from "../mcp_store.js";
import { McpClient as McpClientImpl } from "../mcp.js";
import { discoverSkills } from "../skills/skill_discovery.js";
import type { SkillIndex } from "../skills/skill_types.js";
import { resolveInstructionGraph } from "../instructions/instruction_resolver.js";
import type { InstructionGraph } from "../instructions/instruction_types.js";
import {
  summarize,
  toV1Report,
  type DiagnosticReport,
  type DoctorCheckV2,
  type DoctorMode,
  type DoctorReportV2,
  type DoctorSeverity,
} from "./contracts.js";
import { clampDiagnosticTimeout, executeDiagnosticChecks, type CheckOutcome } from "./executor.js";
import { runtimeChecks } from "./runtime.js";
import { workspaceChecks } from "./workspace.js";
import { transportChecks } from "./transport.js";
import { authChecks } from "./auth.js";
import { backendChecks } from "./backend.js";
import { toolsChecks } from "./tools.js";
import { memoryChecks } from "./memory.js";
import { mcpChecks } from "./mcp.js";
import { persistenceChecks } from "./persistence.js";
import { skillsChecks } from "./skills.js";
import { instructionsChecks } from "./instructions.js";

export interface CapabilityProbeResult {
  version: number;
  digest: string;
}

export interface DiagnosticDependencies {
  now?: string;
  mcpClient?: McpClient;
  mcpStore?: LocalMcpStore;
  memoryRoots?: MemoryRoots;
  timeoutMs?: number;
  /** Injected capability-manifest probe (GET /agent/capabilities); absent → skip. */
  apiProbe?: () => Promise<CapabilityProbeResult>;
}

export interface CheckDeps {
  ctx: AppContext;
  mode: DoctorMode;
  timeoutMs: number;
  mcpStore: LocalMcpStore;
  mcpClient: McpClient;
  memoryRoots?: MemoryRoots;
  now?: string;
  apiProbe?: () => Promise<CapabilityProbeResult>;
  /** Memoized per run so several checks share one filesystem scan. */
  skillIndex(): SkillIndex;
  instructionGraph(): InstructionGraph;
  capability: { value: CapabilityProbeResult | null };
}

export type CheckMode = "fast" | "network" | "live";

export interface CheckSpec {
  id: string;
  category: string;
  /** Minimum report mode that actually runs the check. */
  mode: CheckMode;
  severity: DoctorSeverity;
  /** Repair action offered when the check does not pass. */
  repairId?: string;
  run(deps: CheckDeps): Promise<CheckOutcome> | CheckOutcome;
}

export function registerChecks(): CheckSpec[] {
  return [
    ...runtimeChecks(),
    ...workspaceChecks(),
    ...transportChecks(),
    ...authChecks(),
    ...backendChecks(),
    ...toolsChecks(),
    ...memoryChecks(),
    ...mcpChecks(),
    ...persistenceChecks(),
    ...skillsChecks(),
    ...instructionsChecks(),
  ];
}

export const REGISTRY: readonly CheckSpec[] = registerChecks();

const MODE_RANK: Record<CheckMode, number> = { fast: 0, network: 1, live: 2 };

function reportRank(mode: DoctorMode): number {
  // "fix" plans repairs over the fast baseline: same zero-network contract.
  return mode === "fix" ? MODE_RANK.fast : MODE_RANK[mode];
}

export interface DoctorRunOptions {
  mode: DoctorMode;
  /** Category filter (--category a,b); empty/absent runs everything. */
  categories?: readonly string[];
}

function memoize<T>(compute: () => T): () => T {
  let cached: { value: T } | null = null;
  return () => (cached ??= { value: compute() }).value;
}

export async function doctorReportV2(
  ctx: AppContext,
  options: DoctorRunOptions,
  dependencies: DiagnosticDependencies = {},
): Promise<DoctorReportV2> {
  const deps: CheckDeps = {
    ctx,
    mode: options.mode,
    timeoutMs: clampDiagnosticTimeout(dependencies.timeoutMs),
    mcpStore: dependencies.mcpStore ?? new LocalMcpStore(),
    mcpClient: dependencies.mcpClient ?? new McpClientImpl(ctx.api),
    ...(dependencies.memoryRoots != null ? { memoryRoots: dependencies.memoryRoots } : {}),
    ...(dependencies.now != null ? { now: dependencies.now } : {}),
    ...(dependencies.apiProbe != null ? { apiProbe: dependencies.apiProbe } : {}),
    skillIndex: memoize(() => discoverSkills({ projectRoot: ctx.flags.cwd })),
    instructionGraph: memoize(() => resolveInstructionGraph(ctx.flags.cwd)),
    capability: { value: null },
  };

  const wanted = options.categories?.length
    ? REGISTRY.filter((spec) => options.categories!.includes(spec.category))
    : [...REGISTRY];
  const rank = reportRank(options.mode);
  const executed = await executeDiagnosticChecks(
    wanted.map((spec) => ({
      id: spec.id,
      category: spec.category,
      run: () =>
        MODE_RANK[spec.mode] > rank
          ? { status: "skip" as const, detail: "requires --network", configured: false, verified: false }
          : spec.run(deps),
    })),
  );

  const checks: DoctorCheckV2[] = executed.map((check, index) => {
    const spec = wanted[index]!;
    return {
      id: check.id,
      category: check.category,
      status: check.status,
      severity: spec.severity,
      configured: check.configured,
      reachable: check.reachable,
      verified: check.verified,
      detail: check.detail,
      evidence: { metadata_only: true },
      repair_id: spec.repairId != null && check.status !== "pass" && check.status !== "skip" ? spec.repairId : null,
      duration_ms: check.durationMs,
    };
  });

  return {
    schema_version: 2,
    mode: options.mode,
    generated_at: deps.now ?? new Date().toISOString(),
    capability_contract: deps.capability.value,
    checks,
    summary: summarize(checks.map((check) => check.status)),
  };
}

/** v1 entrypoint — unchanged signature and wire shape for existing consumers. */
export async function diagnosticReport(
  ctx: AppContext,
  deep: boolean,
  dependencies: DiagnosticDependencies = {},
): Promise<DiagnosticReport> {
  return toV1Report(await doctorReportV2(ctx, { mode: deep ? "network" : "fast" }, dependencies));
}
