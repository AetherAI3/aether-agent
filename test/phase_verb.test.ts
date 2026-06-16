import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseVerb, whimsicalVerb } from "../src/ui/phase_verb.js";

test("known stage maps to its anchored verb", () => {
  assert.equal(phaseVerb("execute").verb, "Forging");
  assert.equal(phaseVerb("recon").verb, "Reconnoitring");
});
test("unknown stage falls back to a whimsical verb, stable within a tick", () => {
  assert.equal(phaseVerb("totally-unknown", 0).verb, phaseVerb("totally-unknown", 0).verb);
});
test("whimsical verb cycles with the tick", () => {
  assert.notEqual(whimsicalVerb(0).verb, whimsicalVerb(1).verb);
});
test("every entry carries a kaomoji", () => {
  assert.ok(phaseVerb("execute").kao.length > 0);
});
test("memory-extract phase maps to Extracting memory + kaomoji", () => {
  const v = phaseVerb("memory-extract");
  assert.equal(v.verb, "Extracting memory");
  assert.equal(v.kao, "(◕‿◕)✎");
});
test("compacting phase maps to Compacting context + kaomoji", () => {
  const v = phaseVerb("compacting");
  assert.equal(v.verb, "Compacting context");
  assert.equal(v.kao, "(；・∀・)📦");
});
