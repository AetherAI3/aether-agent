import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseBackend, chooseLocalBrain } from "../src/core/backend.js";

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

// chooseLocalBrain is the second pure decision: WHICH local brain runs offline.
// The Ollama brain ships inside the npm package; the headless Python brain is a
// separate install, so asking for it by accident is the difference between a
// working offline run and "spawn python ENOENT".

test("the shipped Ollama brain is the default local brain", () => {
  assert.equal(chooseLocalBrain(undefined), "ollama");
  assert.equal(chooseLocalBrain(""), "ollama");
  assert.equal(chooseLocalBrain("   "), "ollama");
});

test("the Python brain is opt-in, case- and whitespace-insensitively", () => {
  assert.equal(chooseLocalBrain("python"), "python");
  assert.equal(chooseLocalBrain("  Python  "), "python");
  assert.equal(chooseLocalBrain("PYTHON"), "python");
});

test("an unknown local-brain value falls back to the shipped brain", () => {
  // A stray env value must never route an offline run to an interpreter the
  // npm package does not install.
  assert.equal(chooseLocalBrain("ollama"), "ollama");
  assert.equal(chooseLocalBrain("py"), "ollama");
  assert.equal(chooseLocalBrain("nonsense"), "ollama");
});
