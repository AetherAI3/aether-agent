// src/core/health.ts — the result model `aether doctor` reports against.
//
// v1 collapsed every check onto one axis: pass / warn / fail / skip. That made
// "the backend URL is well-formed" and "the backend answered just now" both
// read as a green `pass`, which is exactly the confusion a health command
// exists to remove. v2 splits the claim into three:
//
//   configured    the local setup names this thing
//   reachable     something answered at that address
//   verified now  the path was exercised end to end during THIS run
//
// A check that was not run reports `not-checked`, never a pass. Cached
// evidence carries the timestamp it was gathered at and is never rendered as
// current verification.

export const DOCTOR_SCHEMA_VERSION = 2;

export type DoctorMode = "fast" | "live" | "fix";

/**
 * `na` means the axis cannot apply here (there is no such surface in this
 * build). `not-checked` means it applies but this run did not test it.
 */
export type AxisState = "yes" | "no" | "unknown" | "na" | "not-checked";

export interface Axis {
  state: AxisState;
  /** Only ever set from the current run. */
  checkedAt?: string;
  latencyMs?: number;
  evidence?: string;
}

export type Severity = "info" | "warning" | "error";

export interface HealthCheck {
  id: string;
  category: string;
  title: string;
  configured: Axis;
  reachable: Axis;
  verified: Axis;
  severity: Severity;
  /** Names an allowlisted `doctor --fix` repair that addresses this check. */
  repairId?: string;
  remediation?: string;
}

export interface HealthSummary {
  error: number;
  warning: number;
  info: number;
  notChecked: number;
}

export interface HealthReport {
  schemaVersion: number;
  mode: DoctorMode;
  generatedAt: string;
  checks: HealthCheck[];
  summary: HealthSummary;
}

export function axis(state: AxisState, extra: Omit<Axis, "state"> = {}): Axis {
  return { state, ...extra };
}

/** An axis this build has no surface for. Never a pass, never a failure. */
export function notApplicable(evidence: string): Axis {
  return { state: "na", evidence };
}

/** An axis that applies but was not exercised by this run. */
export function notChecked(evidence: string): Axis {
  return { state: "not-checked", evidence };
}

// ═════════════════════════════════════════════════════════════════════
// Redaction
// ═════════════════════════════════════════════════════════════════════

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/**
 * Strip anything credential-shaped, plus the query string of any URL — signed
 * media and download URLs carry their authorisation there. Applied to every
 * evidence string before it reaches stdout, a log, or the JSON report.
 */
export function redact(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  out = out.replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@");
  out = out.replace(/(https?:\/\/[^\s?]*)\?[^\s]*/gi, "$1?[redacted]");
  return out;
}

function redactAxis(value: Axis): Axis {
  return value.evidence ? { ...value, evidence: redact(value.evidence) } : value;
}

/** Apply redaction across a whole check. Called once, at report assembly. */
export function redactCheck(check: HealthCheck): HealthCheck {
  return {
    ...check,
    configured: redactAxis(check.configured),
    reachable: redactAxis(check.reachable),
    verified: redactAxis(check.verified),
    ...(check.remediation ? { remediation: redact(check.remediation) } : {}),
  };
}

export function summarize(checks: readonly HealthCheck[]): HealthSummary {
  const summary: HealthSummary = { error: 0, warning: 0, info: 0, notChecked: 0 };
  for (const check of checks) {
    summary[check.severity] += 1;
    if (check.verified.state === "not-checked" || check.reachable.state === "not-checked") {
      summary.notChecked += 1;
    }
  }
  return summary;
}

export function buildReport(
  mode: DoctorMode,
  checks: readonly HealthCheck[],
  generatedAt: string,
): HealthReport {
  const redacted = checks.map(redactCheck);
  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    mode,
    generatedAt,
    checks: redacted,
    summary: summarize(redacted),
  };
}

// ═════════════════════════════════════════════════════════════════════
// Rendering
// ═════════════════════════════════════════════════════════════════════

const AXIS_LABEL: Record<AxisState, string> = {
  yes: "yes",
  no: "no",
  unknown: "unknown",
  na: "n/a",
  "not-checked": "not checked",
};

function axisLine(label: string, value: Axis): string {
  const parts = [AXIS_LABEL[value.state]];
  if (value.checkedAt) parts.push("· " + value.checkedAt.slice(11, 19));
  if (typeof value.latencyMs === "number") parts.push(`· ${Math.round(value.latencyMs)}ms`);
  const head = `  ${label.padEnd(14)}${parts.join(" ")}`;
  return value.evidence ? `${head}\n${" ".repeat(16)}${value.evidence}` : head;
}

export function renderHealthReport(report: HealthReport): string {
  const lines = [`Aether doctor v${report.schemaVersion} (${report.mode})`, ""];
  for (const check of report.checks) {
    const flag = check.severity === "error" ? "✗" : check.severity === "warning" ? "!" : " ";
    lines.push(`${flag} ${check.title}  [${check.id}]`);
    lines.push(axisLine("configured", check.configured));
    lines.push(axisLine("reachable", check.reachable));
    lines.push(axisLine("verified now", check.verified));
    if (check.remediation) lines.push(`  → ${check.remediation}`);
    if (check.repairId) lines.push(`  → repairable: aether doctor --fix --only ${check.repairId}`);
    lines.push("");
  }
  lines.push(
    `Summary: ${report.summary.error} error, ${report.summary.warning} warning, ` +
      `${report.summary.info} ok, ${report.summary.notChecked} not verified`,
  );
  if (report.mode === "fast") {
    lines.push("Remote reachability is not checked in fast mode — run: aether doctor --live");
  }
  return lines.join("\n") + "\n";
}
