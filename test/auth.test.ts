import { test } from "node:test";
import assert from "node:assert/strict";
import { isApiToken } from "../src/commands/auth.js";

test("isApiToken detects an aek_ API token vs a session token", () => {
  assert.equal(isApiToken("aek_abc123"), true);
  assert.equal(isApiToken("sess-xyz"), false);
  assert.equal(isApiToken(null), false);
  assert.equal(isApiToken(undefined), false);
  assert.equal(isApiToken(""), false);
});
