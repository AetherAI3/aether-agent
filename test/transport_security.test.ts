import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient, isCredentialSafeUrl } from "../src/core/transport.js";
import { StaticTokenStore } from "../src/core/auth.js";

test("isCredentialSafeUrl: https any host ok; http only loopback; junk unsafe", () => {
  assert.equal(isCredentialSafeUrl("https://api.aethersystems.net/cloud"), true);
  assert.equal(isCredentialSafeUrl("https://evil.example.com"), true);
  assert.equal(isCredentialSafeUrl("http://localhost:8080"), true);
  assert.equal(isCredentialSafeUrl("http://127.0.0.1:9000/cloud"), true);
  assert.equal(isCredentialSafeUrl("http://[::1]:9000"), true);
  // The leak vectors: cleartext to a remote host.
  assert.equal(isCredentialSafeUrl("http://evil.example.com"), false);
  assert.equal(isCredentialSafeUrl("http://api.aethersystems.net"), false);
  // Non-http(s) schemes and garbage.
  assert.equal(isCredentialSafeUrl("ftp://localhost"), false);
  assert.equal(isCredentialSafeUrl("not a url"), false);
  assert.equal(isCredentialSafeUrl(""), false);
});

test("ApiClient refuses to send the bearer over insecure transport (no network)", async () => {
  const api = new ApiClient("http://evil.example.com", new StaticTokenStore("aek_test_synthetic"));
  await assert.rejects(() => api.getJson("/models"), /insecure transport/);
});

test("ApiClient with no token does not throw the insecure-transport guard", async () => {
  // Empty token store → no Authorization header → guard is skipped. The call will
  // fail at the network layer, but it must NOT be the InsecureTransportError.
  const api = new ApiClient("http://evil.example.com", new StaticTokenStore(""));
  await assert.rejects(
    () => api.getJson("/models"),
    (err: unknown) => !/insecure transport/.test(String((err as Error)?.message)),
  );
});
