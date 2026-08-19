// Deterministic, offline skill evaluation.
//
// Layers (spec: schema → resolution → policy), all pure over the index and a
// fixture file — no model call, no network, no UVT. Live provider evaluation
// is a separate, explicitly authorized path that does not exist here.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateSkillPolicy, defaultPermissionEnvelope, refuseUndeclaredToolCall } from "./skill_policy.js";
import { loadSkillBody } from "./skill_loader.js";
import { resolveAutomatic, resolveExplicit } from "./skill_resolver.js";
import { SkillError } from "./skill_errors.js";
import type { SkillDescriptor, SkillIndex } from "./skill_types.js";

export interface SkillEvalCase {
  id: string;
  input: string;
  expected: {
    selectedSkill?: string;
    allowedTools?: readonly string[];
    forbiddenTools?: readonly string[];
    requiredOutputKind?: string;
    maxUvt?: number;
  };
}

export interface SkillEvalOutcome {
  caseId: string;
  status: "pass" | "fail";
  detail: string;
}

export interface SkillEvalReport {
  skillId: string;
  cases: readonly SkillEvalOutcome[];
  pass: number;
  fail: number;
}

export type EvalManifestValidation =
  | { ok: true; cases: readonly SkillEvalCase[] }
  | { ok: false; errors: readonly string[] };

/** Parse + shape-check one evals/cases.json manifest. Strict, actionable errors. */
export function parseEvalManifest(raw: unknown): EvalManifestValidation {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { ok: false, errors: ["eval manifest must be a JSON array of cases"] };
  const cases: SkillEvalCase[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push("case " + index + " must be an object");
      continue;
    }
    const item = entry as Record<string, unknown>;
    const id = item["id"];
    const input = item["input"];
    const expected = item["expected"];
    if (typeof id !== "string" || !id) { errors.push("case " + index + " needs a string id"); continue; }
    if (seen.has(id)) { errors.push("duplicate case id: " + id); continue; }
    seen.add(id);
    if (typeof input !== "string" || !input) { errors.push("case " + id + " needs a string input"); continue; }
    if (typeof expected !== "object" || expected === null) { errors.push("case " + id + " needs an expected object"); continue; }
    const expectedRecord = expected as Record<string, unknown>;
    const strList = (key: string): string[] | undefined => {
      const value = expectedRecord[key];
      if (value == null) return undefined;
      if (!Array.isArray(value) || value.some((tool) => typeof tool !== "string")) {
        errors.push("case " + id + " expected." + key + " must be a string array");
        return undefined;
      }
      return value as string[];
    };
    const selected = expectedRecord["selected_skill"];
    const outputKind = expectedRecord["required_output_kind"];
    const maxUvt = expectedRecord["max_uvt"];
    const parsed: SkillEvalCase = {
      id,
      input,
      expected: {
        ...(typeof selected === "string" ? { selectedSkill: selected } : {}),
        ...(strList("allowed_tools") ? { allowedTools: strList("allowed_tools") } : {}),
        ...(strList("forbidden_tools") ? { forbiddenTools: strList("forbidden_tools") } : {}),
        ...(typeof outputKind === "string" ? { requiredOutputKind: outputKind } : {}),
        ...(typeof maxUvt === "number" ? { maxUvt } : {}),
      },
    };
    cases.push(parsed);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, cases };
}

export function loadEvalManifest(descriptor: SkillDescriptor): EvalManifestValidation {
  const manifestPath = descriptor.manifest.health.evalManifest;
  if (!manifestPath) return { ok: false, errors: ["skill declares no eval manifest"] };
  const full = join(descriptor.root, manifestPath);
  if (!existsSync(full)) return { ok: false, errors: ["eval manifest missing: " + manifestPath] };
  try {
    return parseEvalManifest(JSON.parse(readFileSync(full, "utf8")));
  } catch {
    return { ok: false, errors: ["eval manifest is not valid JSON: " + manifestPath] };
  }
}

/**
 * Run one skill's offline eval suite against the live index.
 * max_uvt expectations: this runner NEVER spends, so any expected.maxUvt > 0
 * is a manifest error — offline evals prove zero-spend by construction.
 */
export function runSkillEvals(index: SkillIndex, descriptor: SkillDescriptor): SkillEvalReport {
  const manifest = loadEvalManifest(descriptor);
  if (!manifest.ok) {
    return {
      skillId: descriptor.id,
      cases: manifest.errors.map((error) => ({ caseId: "manifest", status: "fail" as const, detail: error })),
      pass: 0,
      fail: manifest.errors.length,
    };
  }
  const outcomes: SkillEvalOutcome[] = [];
  for (const evalCase of manifest.cases) {
    outcomes.push(runOneCase(index, descriptor, evalCase));
  }
  const pass = outcomes.filter((outcome) => outcome.status === "pass").length;
  return { skillId: descriptor.id, cases: outcomes, pass, fail: outcomes.length - pass };
}

function runOneCase(index: SkillIndex, descriptor: SkillDescriptor, evalCase: SkillEvalCase): SkillEvalOutcome {
  const failures: string[] = [];
  const expected = evalCase.expected;

  if (expected.maxUvt != null && expected.maxUvt > 0) {
    failures.push("offline evals are zero-spend; expected.max_uvt must be 0");
  }

  // Resolution layer.
  if (expected.selectedSkill) {
    let selectedId: string | null = null;
    const automatic = resolveAutomatic(index, evalCase.input);
    if (automatic.length && automatic[0]) {
      selectedId = automatic[0].candidate.descriptor.id;
    } else {
      try {
        selectedId = resolveExplicit(index, descriptor.id).candidate.descriptor.id;
      } catch (err) {
        failures.push(err instanceof SkillError ? err.refusal.code : String(err));
      }
    }
    if (selectedId && selectedId !== expected.selectedSkill) {
      failures.push("selected " + selectedId + ", expected " + expected.selectedSkill);
    }
  }

  // Policy layer — load lazily, then verify tool intersection both ways.
  try {
    const loaded = loadSkillBody(descriptor, "explicit");
    const policy = calculateSkillPolicy(loaded);
    const envelope = defaultPermissionEnvelope();
    for (const tool of expected.allowedTools ?? []) {
      const refusal = refuseUndeclaredToolCall(tool, [policy], envelope);
      if (refusal) failures.push("expected allowed tool refused: " + tool + " (" + refusal.code + ")");
    }
    for (const tool of expected.forbiddenTools ?? []) {
      const refusal = refuseUndeclaredToolCall(tool, [policy], envelope);
      if (!refusal) failures.push("expected forbidden tool was allowed: " + tool);
    }
    if (expected.requiredOutputKind && !descriptor.manifest.outputs.kinds.includes(expected.requiredOutputKind)) {
      failures.push("manifest outputs.kinds lacks " + expected.requiredOutputKind);
    }
  } catch (err) {
    failures.push(err instanceof SkillError ? err.refusal.code + ": " + err.refusal.detail : String(err));
  }

  return failures.length
    ? { caseId: evalCase.id, status: "fail", detail: failures.join("; ") }
    : { caseId: evalCase.id, status: "pass", detail: "resolution + policy verified" };
}

/** JUnit XML for CI consumers (`aether skills eval --all --junit <path>`). */
export function renderEvalJUnit(reports: readonly SkillEvalReport[]): string {
  const escape = (text: string): string =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const total = reports.reduce((sum, report) => sum + report.cases.length, 0);
  const failures = reports.reduce((sum, report) => sum + report.fail, 0);
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push('<testsuites tests="' + total + '" failures="' + failures + '">');
  for (const report of reports) {
    lines.push('  <testsuite name="' + escape(report.skillId) + '" tests="' + report.cases.length + '" failures="' + report.fail + '">');
    for (const outcome of report.cases) {
      if (outcome.status === "pass") {
        lines.push('    <testcase name="' + escape(outcome.caseId) + '"/>');
      } else {
        lines.push('    <testcase name="' + escape(outcome.caseId) + '">');
        lines.push('      <failure message="' + escape(outcome.detail) + '"/>');
        lines.push("    </testcase>");
      }
    }
    lines.push("  </testsuite>");
  }
  lines.push("</testsuites>");
  return lines.join("\n") + "\n";
}
