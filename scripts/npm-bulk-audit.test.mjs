import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  auditLockfile,
  classifyNpmAuditResult,
  collectNpmBulkPayload,
  queryNpmBulkAdvisories,
} from "./npm-bulk-audit.mjs";

const BULK_URI = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const VALID_INTEGRITY = "sha512-Dh8vAsV36ig5wa9OX4pXvMc9D3Veibfw2wix0CUwYODLD8nkj9UsLjASr49nPg+2eKzxhBV+v7L8pXvT4e639Q==";

function locked(name, version, overrides = {}) {
  const leaf = name.split("/").at(-1);
  return {
    version,
    resolved: `https://registry.npmjs.org/${name}/-/${leaf}-${version}.tgz`,
    integrity: VALID_INTEGRITY,
    ...overrides,
  };
}

function lockfile(packages) {
  return { lockfileVersion: 3, packages };
}

function auditReport(vulnerabilities = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const vulnerability of Object.values(vulnerabilities)) {
    counts[vulnerability.severity] += 1;
    counts.total += 1;
  }
  return JSON.stringify({ auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts } });
}

test("builds the exact npm bulk payload, deduplicating nested versions and honoring canonical alias names", () => {
  const collected = collectNpmBulkPayload(
    lockfile({
      "": { version: "0.3.2" },
      "packages/workspace": { version: "1.0.0" },
      "node_modules/z": locked("z", "2.0.0"),
      "node_modules/a/node_modules/z": locked("z", "2.0.0"),
      "node_modules/@types/node": locked("@types/node", "24.0.0"),
      "node_modules/alias": locked("canonical", "1.2.3", { name: "canonical" }),
    }),
  );
  assert.deepEqual(collected.payload, {
    "@types/node": ["24.0.0"],
    canonical: ["1.2.3"],
    z: ["2.0.0"],
  });
  assert.equal(collected.nodeModulesEntries, 4);
  assert.equal(collected.exactPackageVersions, 3);
});

test("fails closed on unsupported locks, malformed entries, inexact versions, names, and registry origins", () => {
  assert.throws(() => collectNpmBulkPayload({ lockfileVersion: 1, packages: {} }), /lockfileVersion 2 or 3/u);
  assert.throws(() => collectNpmBulkPayload(lockfile({ "": { version: "1.0.0" } })), /no auditable/u);
  assert.throws(
    () => collectNpmBulkPayload(lockfile({ "node_modules/link": { link: true } })),
    /exact semantic version/u,
  );
  assert.throws(
    () => collectNpmBulkPayload(lockfile({ "node_modules/a": locked("a", "^1.2.3") })),
    /exact semantic version/u,
  );
  assert.throws(
    () => collectNpmBulkPayload(lockfile({ "node_modules/UPPER": locked("UPPER", "1.2.3") })),
    /invalid npm package name/u,
  );
  assert.throws(
    () =>
      collectNpmBulkPayload(
        lockfile({
          "node_modules/a": {
            version: "1.2.3",
            resolved: "https://registry.example/a/-/a-1.2.3.tgz",
            integrity: VALID_INTEGRITY,
          },
        }),
      ),
    /not backed by registry\.npmjs\.org/u,
  );
  assert.throws(
    () =>
      collectNpmBulkPayload(
        lockfile({
          "node_modules/a": locked("a", "1.2.3", {
            resolved: "https://registry.npmjs.org/a/-/a-9.9.9.tgz",
          }),
        }),
      ),
    /not backed by registry\.npmjs\.org/u,
  );
  assert.throws(
    () => collectNpmBulkPayload(lockfile({ "node_modules/a": locked("a", "1.2.3", { integrity: undefined }) })),
    /valid sha512 integrity/u,
  );
  assert.throws(
    () => collectNpmBulkPayload(lockfile({ "node_modules/a": locked("a", "1.2.3", { integrity: "sha512-not-base64!" }) })),
    /valid sha512 integrity/u,
  );
  assert.throws(
    () =>
      collectNpmBulkPayload(
        lockfile({
          "node_modules/alias": locked("other", "1.2.3", { name: "canonical" }),
        }),
      ),
    /not backed by registry\.npmjs\.org/u,
  );
});

test("passes only a consistent zero-exit npm v2 report below the high threshold", () => {
  assert.deepEqual(
    classifyNpmAuditResult(
      auditReport({ low: { severity: "low" }, moderate: { severity: "moderate" } }),
      0,
    ),
    { disposition: "pass", reason: "npm-audit-report-clean-at-high-threshold" },
  );
  assert.equal(classifyNpmAuditResult(auditReport({ high: { severity: "high" } }), 0).disposition, "fail");
  assert.equal(classifyNpmAuditResult(auditReport({ critical: { severity: "critical" } }), 1).disposition, "fail");
  assert.equal(classifyNpmAuditResult(auditReport(), 1).disposition, "fail");
  assert.equal(classifyNpmAuditResult("{}", 0).disposition, "fail");
  assert.equal(classifyNpmAuditResult("not JSON", 0).disposition, "fail");

  const inconsistentTotal = JSON.parse(auditReport());
  inconsistentTotal.metadata.vulnerabilities.total = 1;
  assert.equal(classifyNpmAuditResult(JSON.stringify(inconsistentTotal), 0).disposition, "fail");
  const inconsistentDetail = JSON.parse(auditReport({ high: { severity: "high" } }));
  inconsistentDetail.metadata.vulnerabilities.high = 0;
  inconsistentDetail.metadata.vulnerabilities.low = 1;
  assert.equal(classifyNpmAuditResult(JSON.stringify(inconsistentDetail), 0).disposition, "fail");
  const futureSchema = JSON.parse(auditReport());
  futureSchema.auditReportVersion = 3;
  assert.equal(classifyNpmAuditResult(JSON.stringify(futureSchema), 0).disposition, "fail");
});

test("retries only a parsed 502-504 from npm's exact bulk endpoint", () => {
  for (const statusCode of [502, 503, 504]) {
    assert.deepEqual(
      classifyNpmAuditResult(
        JSON.stringify({
          message: `${statusCode} Service Unavailable - POST ${BULK_URI} - Service Unavailable`,
          statusCode,
          method: "POST",
          uri: BULK_URI,
          error: { summary: "", detail: "" },
        }),
        1,
      ),
      { disposition: "retry", reason: "npm-advisory-endpoint-502-504" },
    );
  }
  for (const rejected of [
    JSON.stringify({ message: `500 Internal Server Error - POST ${BULK_URI}` }),
    JSON.stringify({ message: `429 Too Many Requests - POST ${BULK_URI}` }),
    JSON.stringify({ message: "503 Service Unavailable - POST https://registry.example/bulk" }),
    JSON.stringify({ message: "request failed, reason: ETIMEDOUT" }),
    JSON.stringify({ message: "unable to verify the first certificate" }),
    JSON.stringify({ message: `503 Service Unavailable - POST ${BULK_URI}`, statusCode: 401 }),
    JSON.stringify({ message: `503 Service Unavailable - POST ${BULK_URI}`, method: "GET" }),
    JSON.stringify({ message: `503 Service Unavailable - POST ${BULK_URI}`, uri: "https://example.com" }),
  ]) {
    assert.equal(classifyNpmAuditResult(rejected, 1).disposition, "fail");
  }
});

test("sends an identity-encoded exact payload and accepts only an empty HTTP 200 advisory map", async () => {
  const requestBody = JSON.stringify({ lodash: ["4.17.21"] });
  const advisoryPackages = await queryNpmBulkAdvisories({
    requestBody,
    expectedPackageNames: new Set(["lodash"]),
    fetchImpl: async (input, init) => {
      assert.equal(new URL(input).href, BULK_URI);
      assert.equal(init.method, "POST");
      assert.equal(init.body, requestBody);
      assert.equal(init.headers["Content-Type"], "application/json");
      assert.equal(Object.hasOwn(init.headers, "Content-Encoding"), false);
      assert.equal(init.redirect, "error");
      return new Response("{}", { status: 200 });
    },
  });
  assert.deepEqual(advisoryPackages, []);
});

test("fails closed on a finding, unknown package, HTTP error, transport error, or malformed response", async () => {
  const base = { requestBody: '{"lodash":["4.17.21"]}', expectedPackageNames: new Set(["lodash"]) };
  await assert.rejects(
    queryNpmBulkAdvisories({
      requestBody: "{}",
      expectedPackageNames: new Set(["lodash"]),
      fetchImpl: async () => new Response("{}", { status: 200 }),
    }),
    /does not match the exact package set/u,
  );
  await assert.rejects(
    queryNpmBulkAdvisories({
      ...base,
      fetchImpl: async () => new Response('{"lodash":[{"id":1}]}', { status: 200 }),
    }).then((packages) => {
      if (packages.length > 0) throw new Error("advisories returned");
    }),
    /advisories returned/u,
  );
  await assert.rejects(
    queryNpmBulkAdvisories({
      ...base,
      fetchImpl: async () => new Response('{"other":[]}', { status: 200 }),
    }),
    /unexpected response shape/u,
  );
  for (const status of [206, 401, 403, 429, 502]) {
    await assert.rejects(
      queryNpmBulkAdvisories({ ...base, fetchImpl: async () => new Response("{}", { status }) }),
      new RegExp(`HTTP ${status}`, "u"),
    );
  }
  await assert.rejects(
    queryNpmBulkAdvisories({
      ...base,
      fetchImpl: async () => {
        throw new Error("ETIMEDOUT");
      },
    }),
    /ETIMEDOUT/u,
  );
  await assert.rejects(
    queryNpmBulkAdvisories({ ...base, fetchImpl: async () => new Response("not JSON", { status: 200 }) }),
    /invalid JSON/u,
  );
  await assert.rejects(
    queryNpmBulkAdvisories({ ...base, fetchImpl: async () => new Response("[]", { status: 200 }) }),
    /must be an object/u,
  );
});

test("the lockfile audit rejects a non-empty official advisory map", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aether-npm-bulk-audit-"));
  const lockfilePath = join(directory, "package-lock.json");
  let report;
  try {
    await writeFile(
      lockfilePath,
      JSON.stringify(lockfile({ "node_modules/lodash": locked("lodash", "4.17.19") })),
      "utf8",
    );
    await assert.rejects(
      auditLockfile({
        lockfilePath,
        fetchImpl: async () => new Response('{"lodash":[{"id":1}]}', { status: 200 }),
        writeReport: (line) => {
          report = JSON.parse(line);
        },
      }),
      /returned advisories for 1 package/u,
    );
    assert.deepEqual(report.advisory_packages, ["lodash"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the workflow captures the classifier directly instead of trusting a tee pipeline", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(
    workflow,
    /--classify-npm-audit-result "\$audit_status" "\$audit_json" > aether-npm-audit-classification\.json/u,
  );
  assert.doesNotMatch(workflow, /--classify-npm-audit-result[^\r\n]*\|\s*tee/u);
});
