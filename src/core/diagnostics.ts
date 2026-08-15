// Thin re-export shim — the doctor engine now lives in src/core/diagnostics/.
// Existing imports of "./diagnostics.js" keep working unchanged.

export {
  summarize,
  toV1Report,
  type DiagnosticCheck,
  type DiagnosticReport,
  type DiagnosticStatus,
  type DoctorCheckV2,
  type DoctorMode,
  type DoctorReportV2,
  type DoctorSeverity,
} from "./diagnostics/contracts.js";
export {
  DIAGNOSTIC_CONCURRENCY,
  clampDiagnosticTimeout,
  executeDiagnosticChecks,
  type CheckOutcome,
  type DiagnosticCheckSpec,
  type ExecutedCheck,
} from "./diagnostics/executor.js";
export {
  diagnosticReport,
  doctorReportV2,
  registerChecks,
  REGISTRY,
  type CapabilityProbeResult,
  type CheckDeps,
  type CheckMode,
  type CheckSpec,
  type DiagnosticDependencies,
  type DoctorRunOptions,
} from "./diagnostics/registry.js";
export { renderDiagnosticReport, renderDoctorJUnit, renderDoctorReport } from "./diagnostics/render.js";
