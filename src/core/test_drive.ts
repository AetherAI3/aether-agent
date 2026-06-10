// UVT /test-drive — autonomous TDD loop. Orchestrator-gated.

import type { ApiClient } from "./transport.js";
import { AGENT_TEST_DRIVE_PATH } from "./transport.js";
import type { AppContext } from "./context.js";
import type { Writable } from "node:stream";
import { requireOrchestrator } from "./orchestrator.js";
import { execSync } from "node:child_process";

export interface TestDriveRequest {
  agent: string;
  target: string;
  cwd: string;
  test_cmd?: string;
}

export interface TestResult {
  passed: number;
  failed: number;
  errors: string[];
  output: string;
}

export interface TestDriveResponse {
  status: "running" | "passed" | "failed";
  iterations: number;
  final_result?: TestResult;
  patches: Array<{ file: string; content: string }>;
}

export async function startTestDrive(
  api: ApiClient,
  agent: string,
  target: string,
  cwd: string,
  testCmd?: string,
): Promise<TestDriveResponse> {
  return api.postJson<TestDriveResponse>(AGENT_TEST_DRIVE_PATH, {
    agent,
    target,
    cwd,
    test_cmd: testCmd,
  } as TestDriveRequest);
}

export function runTests(testCmd = "npx jest --json 2>&1"): TestResult {
  try {
    const output = execSync(testCmd, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseTestOutput(output);
  } catch (err: any) {
    const output = err.stdout ?? err.stderr ?? String(err);
    return parseTestOutput(output);
  }
}

function parseTestOutput(output: string): TestResult {
  const errors: string[] = [];
  let passed = 0;
  let failed = 0;

  try {
    const json = JSON.parse(output);
    if (json.numPassedTests != null) passed = json.numPassedTests;
    if (json.numFailedTests != null) failed = json.numFailedTests;
    if (json.testResults) {
      for (const r of json.testResults) {
        if (r.message) errors.push(r.message);
      }
    }
  } catch {
    const passMatch = output.match(/(\d+) passing/);
    const failMatch = output.match(/(\d+) failing/);
    if (passMatch) passed = parseInt(passMatch[1]!);
    if (failMatch) failed = parseInt(failMatch[1]!);
    if (failed > 0) errors.push(output.slice(-2000));
  }

  return { passed, failed, errors, output: output.slice(0, 5000) };
}
