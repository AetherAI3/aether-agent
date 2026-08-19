import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import {
  redactEnvValues,
  redactForBundle,
  redactHomeDir,
  redactInline,
  scanForSecrets,
  SENSITIVE_KEY,
} from "../src/core/redaction.js";

test("redactInline keeps session_log's exact contract", () => {
  // Both patterns fire here — the authorization key/value pass also swallows
  // the word "Bearer"; identical to session_log's original private helper.
  assert.equal(redactInline("Authorization: Bearer abc.def-123"), "Authorization: [REDACTED] [REDACTED]");
  assert.equal(redactInline("token=sk-live-abcdef status=ok"), "token=[REDACTED] status=ok");
  assert.equal(redactInline("api_key: 12345 next"), "api_key: [REDACTED] next");
  assert.equal(redactInline("x".repeat(600)).length, 512);
  assert.equal(redactInline("plain text stays"), "plain text stays");
});

test("jwt-shaped strings are redacted and detected", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2ln";
  const redacted = redactForBundle("id " + jwt + " end", {});
  assert.equal(redacted.includes(jwt), false);
  assert.match(redacted, /\[REDACTED-JWT\]/);
  assert.deepEqual(scanForSecrets("value " + jwt, {}), ["jwt-shaped string"]);
  assert.deepEqual(scanForSecrets(redacted, {}), []);
});

test("bearer tokens are redacted and detected", () => {
  const redacted = redactForBundle("Bearer abcDEF123.z", {});
  assert.equal(redacted, "Bearer [REDACTED]");
  assert.deepEqual(scanForSecrets("Bearer abcDEF123.z", {}), ["bearer token"]);
  assert.deepEqual(scanForSecrets(redacted, {}), []);
});

test("hex secrets are scrubbed only in sensitive key positions", () => {
  const hex = "deadbeef".repeat(8);
  const json = `{"api_key": "${hex}", "sha256": "${hex}"}`;
  const redacted = redactForBundle(json, {});
  assert.equal(redacted.includes(`"api_key": "[REDACTED]"`), true);
  assert.equal(redacted.includes(`"sha256": "${hex}"`), true);
  assert.deepEqual(scanForSecrets(json, {}), ["hex secret in sensitive key position"]);
  assert.deepEqual(scanForSecrets(redacted, {}), []);
  const pair = redactForBundle("client_secret=" + hex, {});
  assert.equal(pair.includes(hex), false);
});

test("urls with userinfo lose the userinfo", () => {
  const redacted = redactForBundle("see https://alice:hunter2secret@example.test/path", {});
  assert.equal(redacted.includes("hunter2secret"), false);
  assert.match(redacted, /https:\/\/\[REDACTED\]@example\.test\/path/);
  assert.deepEqual(scanForSecrets("https://alice:pw12345678@example.test", {}), ["url with userinfo"]);
  assert.deepEqual(scanForSecrets(redacted, {}), []);
});

test("sensitive environment values are scrubbed wherever they appear", () => {
  const env = { MY_API_TOKEN: "supersecretvalue42", HARMLESS: "supersafe" };
  assert.equal(redactEnvValues("x supersecretvalue42 y", env), "x [REDACTED] y");
  assert.equal(redactEnvValues("x supersafe y", env), "x supersafe y");
  assert.deepEqual(scanForSecrets("contains supersecretvalue42", env), ["sensitive environment value"]);
  assert.deepEqual(scanForSecrets("contains [REDACTED]", env), []);
});

test("home directory prefixes collapse to ~", () => {
  const home = homedir();
  assert.equal(redactHomeDir(home + "/projects/app"), "~/projects/app");
  const escaped = JSON.stringify({ path: home + "\\x" });
  assert.equal(redactHomeDir(escaped).includes("~"), true);
  assert.equal(redactHomeDir(escaped).includes(JSON.stringify(home).slice(1, -1)), false);
});

test("SENSITIVE_KEY matches the same key classes session_log relied on", () => {
  for (const key of ["token", "API_KEY", "private-key", "Authorization", "credential", "password", "client_secret"]) {
    assert.equal(SENSITIVE_KEY.test(key), true, key);
  }
  assert.equal(SENSITIVE_KEY.test("username"), false);
});
