// Human and CI renderers for doctor reports. v1 rendering is preserved
// verbatim for compatibility; v2 groups by category with state words.

import type { DiagnosticReport, DoctorCheckV2, DoctorReportV2 } from "./contracts.js";

const STATUS_MARK: Record<DoctorCheckV2["status"], string> = {
  pass: "✓",
  warn: "!",
  fail: "✗",
  skip: "—",
};

function stateWords(check: DoctorCheckV2): string {
  if (check.status === "skip") return "skipped";
  const parts = [check.configured ? "configured" : "not configured"];
  if (check.reachable) parts.push("reachable");
  if (check.verified) parts.push("verified now");
  return parts.join(" · ");
}

export function renderDoctorReport(report: DoctorReportV2): string {
  const lines = ["Aether doctor v" + report.schema_version + " (" + report.mode + ")"];
  if (report.capability_contract) {
    lines.push(
      "capability contract v" +
        report.capability_contract.version +
        " · digest " +
        report.capability_contract.digest.slice(0, 12),
    );
  }
  let category = "";
  for (const check of report.checks) {
    if (check.category !== category) {
      category = check.category;
      lines.push("", category.toUpperCase());
    }
    lines.push(
      "  " + STATUS_MARK[check.status] + " " + check.id + " — " + check.detail + " (" + stateWords(check) + ")",
    );
  }
  lines.push(
    "",
    "Summary: " +
      report.summary.pass + " pass · " +
      report.summary.warn + " warn · " +
      report.summary.fail + " fail · " +
      report.summary.skip + " skip",
  );
  return lines.join("\n") + "\n";
}

/** v1 renderer — kept byte-identical to the original flat format. */
export function renderDiagnosticReport(report: DiagnosticReport): string {
  const lines = [
    "Aether doctor v" + report.schemaVersion + (report.deep ? " (deep)" : ""),
  ];
  for (const check of report.checks) {
    lines.push("  [" + check.status + "] " + check.id + ": " + check.detail);
  }
  lines.push(
    "Summary: " +
      report.summary.pass +
      " pass, " +
      report.summary.warn +
      " warn, " +
      report.summary.fail +
      " fail, " +
      report.summary.skip +
      " skip",
  );
  return lines.join("\n") + "\n";
}

/** JUnit XML — mirrors skill_eval.ts renderEvalJUnit; suites are categories. */
export function renderDoctorJUnit(report: DoctorReportV2): string {
  const escape = (text: string): string =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const categories = [...new Set(report.checks.map((check) => check.category))];
  const failures = report.summary.fail;
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push('<testsuites tests="' + report.checks.length + '" failures="' + failures + '">');
  for (const category of categories) {
    const checks = report.checks.filter((check) => check.category === category);
    const failed = checks.filter((check) => check.status === "fail").length;
    lines.push('  <testsuite name="' + escape(category) + '" tests="' + checks.length + '" failures="' + failed + '">');
    for (const check of checks) {
      if (check.status === "fail") {
        lines.push('    <testcase name="' + escape(check.id) + '">');
        lines.push('      <failure message="' + escape(check.detail) + '"/>');
        lines.push("    </testcase>");
      } else if (check.status === "skip") {
        lines.push('    <testcase name="' + escape(check.id) + '">');
        lines.push("      <skipped/>");
        lines.push("    </testcase>");
      } else {
        lines.push('    <testcase name="' + escape(check.id) + '"/>');
      }
    }
    lines.push("  </testsuite>");
  }
  lines.push("</testsuites>");
  return lines.join("\n") + "\n";
}
