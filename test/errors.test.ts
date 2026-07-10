import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpError, errorHint } from "../src/core/errors.js";

const BASE = "https://api.aethersystems.net";

test("401/403 hint points at auth login", () => {
  assert.match(errorHint(new HttpError(401, "HTTP 401"), BASE) ?? "", /aether auth login/);
  assert.match(errorHint(new HttpError(403, "HTTP 403"), BASE) ?? "", /aether auth login/);
});

test("429 hint points at the tier", () => {
  assert.match(errorHint(new HttpError(429, "HTTP 429"), BASE) ?? "", /\/tier/);
});

test("5xx hint says try again and names the server", () => {
  const h = errorHint(new HttpError(503, "HTTP 503"), BASE) ?? "";
  assert.ok(h.includes(BASE));
  assert.match(h, /try again/);
});

test("network failures hint at /doctor with the base url", () => {
  const fetchFailed = new TypeError("fetch failed");
  assert.match(errorHint(fetchFailed, BASE) ?? "", /\/doctor/);

  const withCause = new Error("request to host failed");
  (withCause as { cause?: unknown }).cause = { code: "ECONNREFUSED" };
  const h = errorHint(withCause, BASE) ?? "";
  assert.ok(h.includes(BASE));
  assert.match(h, /offline\?/);
});

test("errors with nothing better to say get no hint", () => {
  assert.equal(errorHint(new HttpError(404, "HTTP 404"), BASE), null);
  assert.equal(errorHint(new Error("some app error"), BASE), null);
  assert.equal(errorHint("not even an Error", BASE), null);
});
