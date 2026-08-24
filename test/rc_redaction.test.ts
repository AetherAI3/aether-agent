// The Remote Control payload allowlist: every forbidden category from
// ADR-0007 §5 must be provably dropped before upload.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RC_EVENT_TYPES,
  RC_MAX_PAYLOAD_BYTES,
  RC_NEVER_UPLOADED,
  relativizePath,
  sanitizeRemotePayload,
} from "../src/core/remote_redaction.js";

const OPTS = { projectRoot: "C:\\proj", env: {} as NodeJS.ProcessEnv };

test("every forbidden field is dropped, one by one", () => {
  const forbidden: Record<string, unknown> = {
    env: { AETHER_TOKEN: "secret-1" }, // environment variables
    environment: "PATH=...",
    token: "secret-2", // auth tokens
    api_key: "secret-3",
    authorization: "Bearer secret-4",
    file_contents: "entire file body", // arbitrary file contents
    contents: "raw",
    shell_history: ["curl -H 'auth: secret-5'"], // unredacted shell history
    history: "cmd log",
    mcp_credentials: { key: "secret-6" }, // MCP credentials
    mcp: "server config",
    cookies: "sid=secret-7", // browser cookies
    hidden_prompt: "system prompt", // hidden prompts / private memory
    system_prompt: "system prompt",
    memory: "private memory",
    stdout: "raw output",
    body: "raw body",
  };
  for (const [key, value] of Object.entries(forbidden)) {
    const out = sanitizeRemotePayload("tool_activity", { tool: "x", [key]: value }, OPTS);
    assert.ok(out, `payload with ${key} still has its allowlisted remainder`);
    assert.equal(key in out!, false, `forbidden key ${key} must not survive`);
    assert.ok(!JSON.stringify(out).includes("secret-"), `value of ${key} leaked`);
  }
  // The published forbidden-category list stays intact (the PR body quotes it).
  assert.equal(RC_NEVER_UPLOADED.length, 8);
});

test("unknown keys are dropped even when harmless: allowlist, not blocklist", () => {
  const out = sanitizeRemotePayload("done", { status: "passed", summary: "ok", favourite_color: "blue" }, OPTS);
  assert.deepEqual(out, { status: "passed", summary: "ok" });
});

test("unknown event types are refused entirely", () => {
  assert.equal(sanitizeRemotePayload("shell", { summary: "x" }, OPTS), null);
  assert.equal(sanitizeRemotePayload("file_read", { summary: "x" }, OPTS), null);
  assert.ok((RC_EVENT_TYPES as readonly string[]).includes("tool_activity"));
});

test("absolute local paths become project-relative identifiers or are withheld", () => {
  assert.equal(relativizePath("C:\\proj\\src\\app.ts", "C:\\proj"), "src/app.ts");
  assert.equal(relativizePath("C:/proj/src/app.ts", "C:/proj"), "src/app.ts");
  assert.equal(relativizePath("C:\\other\\secret.txt", "C:\\proj"), "[external-path]");
  assert.equal(relativizePath("/etc/passwd", "C:\\proj"), "[external-path]");
  assert.equal(relativizePath("~/.ssh/id_ed25519", "C:\\proj"), "[external-path]");
  assert.equal(relativizePath("src/app.ts", "C:\\proj"), "src/app.ts"); // already relative

  const out = sanitizeRemotePayload("diff_summary", {
    files_changed: 2,
    files: ["C:\\proj\\a.ts", "D:\\elsewhere\\b.ts"],
  }, OPTS);
  assert.deepEqual(out, { files_changed: 2, files: ["a.ts", "[external-path]"] });
});

test("sensitive environment values are scrubbed out of strings", () => {
  const env = { MY_API_KEY: "supersecretvalue" } as NodeJS.ProcessEnv;
  const out = sanitizeRemotePayload("error", { message: "request failed for supersecretvalue" }, {
    projectRoot: "C:\\proj",
    env,
  });
  assert.equal(out!["message"], "request failed for [REDACTED]");
});

test("allowed scalars and lists survive intact", () => {
  const out = sanitizeRemotePayload("tests", {
    framework: "node:test",
    status: "passed",
    passed: 12,
    failed: 0,
    skipped: 1,
    summary: "12 passed",
  }, OPTS);
  assert.deepEqual(out, {
    framework: "node:test", status: "passed", passed: 12, failed: 0, skipped: 1, summary: "12 passed",
  });
});

test("an oversized payload is withheld entirely, never replaced by an undeclared fallback shape", () => {
  const files = Array.from({ length: 64 }, (_, i) => `${"x".repeat(600)}-${i}.ts`);
  const out = sanitizeRemotePayload("diff_summary", { files_changed: 64, files }, OPTS);
  assert.equal(out, null);
  assert.equal(Buffer.byteLength(JSON.stringify(out), "utf8") < RC_MAX_PAYLOAD_BYTES, true);
});

test("payloads with nothing allowlisted are dropped, not sent empty", () => {
  assert.equal(sanitizeRemotePayload("tool_activity", { env: { A: "b" }, token: "t" }, OPTS), null);
});
