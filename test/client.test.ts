import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, AetherClient } from "../src/index.js";

test("createClient honors explicit baseUrl + token", () => {
  const c = createClient({ baseUrl: "https://api.example", token: "tok" });
  assert.ok(c instanceof AetherClient);
  assert.equal(c.baseUrl, "https://api.example");
});

test("baseUrl falls back to AETHER_BASE_URL env", () => {
  const prev = process.env["AETHER_BASE_URL"];
  process.env["AETHER_BASE_URL"] = "https://env.example";
  try {
    assert.equal(createClient({ token: "t" }).baseUrl, "https://env.example");
  } finally {
    if (prev === undefined) delete process.env["AETHER_BASE_URL"];
    else process.env["AETHER_BASE_URL"] = prev;
  }
});

test("exposes raw http on the same route", () => {
  const c = createClient({ baseUrl: "https://x", token: "t" });
  assert.ok(c.http);
});
