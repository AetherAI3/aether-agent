import { test } from "node:test";
import assert from "node:assert/strict";
import { hintFor, isAbortError } from "../src/core/error_hints.js";
import { HttpError, InsecureTransportError, StreamTimeoutError } from "../src/core/errors.js";

test("HTTP statuses map to actionable hints", () => {
  assert.match(hintFor(new HttpError(401, "HTTP 401"))!, /aether auth login/);
  assert.match(hintFor(new HttpError(403, "HTTP 403"))!, /\/tier/);
  assert.match(hintFor(new HttpError(429, "HTTP 429"))!, /rate limited/i);
  assert.match(hintFor(new HttpError(503, "HTTP 503"))!, /\/doctor/);
  assert.equal(hintFor(new HttpError(404, "HTTP 404")), null);
});

test("network failures point at connectivity", () => {
  assert.match(hintFor(new TypeError("fetch failed"))!, /aether api/i);
  assert.match(hintFor(new Error("connect ECONNREFUSED 1.2.3.4:443"))!, /network/);
});

test("insecure transport points at the base URL", () => {
  assert.match(hintFor(new InsecureTransportError("http://evil"))!, /https/);
});

test("stream timeouts point at connectivity", () => {
  assert.match(hintFor(new StreamTimeoutError(120_000))!, /stream went quiet/);
  assert.match(hintFor(new StreamTimeoutError(120_000))!, /\/doctor/);
});

test("aborts are silent (already user-initiated) and detected", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(hintFor(abort), null);
  assert.equal(isAbortError(abort), true);
  assert.equal(isAbortError(new Error("x")), false);
  assert.equal(isAbortError("nope"), false);
});

test("unknown errors produce no hint", () => {
  assert.equal(hintFor(new Error("whatever")), null);
  assert.equal(hintFor(42), null);
});
