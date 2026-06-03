import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPoll } from "../src/core/device.js";

test("classifyPoll maps server responses to poll actions", () => {
  assert.equal(classifyPoll({ error: "authorization_pending" }), "wait");
  assert.equal(classifyPoll({ error: "slow_down" }), "slow_down");
  assert.equal(classifyPoll({ error: "access_denied" }), "denied");
  assert.equal(classifyPoll({ error: "expired_token" }), "expired");
  assert.equal(classifyPoll({ access_token: "aek_x" }), "ready");
  assert.equal(classifyPoll({}), "wait");
});
