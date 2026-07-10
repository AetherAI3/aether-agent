import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseBackend } from "../src/core/backend.js";

// chooseBackend is the ONE pure decision: given the resolved config backend and
// whether the user is authed, return the concrete path. 'auto' picks cloud when
// authed (the metered, signed default) and local Ollama when not (offline).

test("explicit cloud always picks cloud, authed or not", () => {
  assert.equal(chooseBackend("cloud", true), "cloud");
  assert.equal(chooseBackend("cloud", false), "cloud");
});

test("explicit local always picks local, authed or not", () => {
  assert.equal(chooseBackend("local", true), "local");
  assert.equal(chooseBackend("local", false), "local");
});

test("auto picks cloud when authed", () => {
  assert.equal(chooseBackend("auto", true), "cloud");
});

test("auto picks local when not authed", () => {
  assert.equal(chooseBackend("auto", false), "local");
});

test("an unknown/garbage backend value is treated as auto", () => {
  // Defensive: a hand-edited config or stray env value must not brick the CLI.
  assert.equal(chooseBackend("nonsense", true), "cloud");
  assert.equal(chooseBackend("nonsense", false), "local");
  assert.equal(chooseBackend("", true), "cloud");
  assert.equal(chooseBackend("", false), "local");
});
