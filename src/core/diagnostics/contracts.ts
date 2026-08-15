// Doctor report contracts. v2 is the native shape (snake_case wire fields);
// v1 stays exported and derivable so `aether doctor --json` consumers and the
// original tests keep working unchanged.

export type DiagnosticStatus = "pass" | "warn" | "fail" | "skip";
export type DoctorMode = "fast" | "network" | "live" | "fix";
export type DoctorSeverity = "info" | "warning" | "critical";

export interface DoctorCheckV2 {
  id: string;
  category: string;
  status: DiagnosticStatus;
  severity: DoctorSeverity;
  configured: boolean;
  reachable: boolean;
  verified: boolean;
  detail: string;
  /** Structural promise: check details never carry file contents or secrets. */
  evidence: { metadata_only: true };
  repair_id: string | null;
  duration_ms: number;
}

export interface DoctorReportV2 {
  schema_version: 2;
  mode: DoctorMode;
  generated_at: string;
  capability_contract: { version: number; digest: string } | null;
  checks: DoctorCheckV2[];
  summary: Record<DiagnosticStatus, number>;
}

// ── v1 compatibility ─────────────────────────────────────────────────────────

export interface DiagnosticCheck {
  id: string;
  category: string;
  status: DiagnosticStatus;
  detail: string;
  durationMs: number;
}

export interface DiagnosticReport {
  schemaVersion: 1;
  generatedAt: string;
  deep: boolean;
  checks: DiagnosticCheck[];
  summary: Record<DiagnosticStatus, number>;
}

export function summarize(statuses: readonly DiagnosticStatus[]): Record<DiagnosticStatus, number> {
  const summary: Record<DiagnosticStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const status of statuses) summary[status] += 1;
  return summary;
}

/** Downgrade a v2 report to the v1 wire shape — the `--json` default. */
export function toV1Report(report: DoctorReportV2): DiagnosticReport {
  return {
    schemaVersion: 1,
    generatedAt: report.generated_at,
    deep: report.mode !== "fast",
    checks: report.checks.map((check) => ({
      id: check.id,
      category: check.category,
      status: check.status,
      detail: check.detail,
      durationMs: check.duration_ms,
    })),
    summary: { ...report.summary },
  };
}
