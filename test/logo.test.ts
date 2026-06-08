import { test } from "node:test";
import assert from "node:assert/strict";
import { aetherWordmark, composeBrand, BRAND_WIDTH } from "../src/ui/logo.js";
import { stripAnsi } from "../src/ui/theme.js";

test("wordmark is exactly 5 rows (aligns with the 5-row cloud)", () => {
  assert.equal(aetherWordmark(true).length, 5);
});
test("composeBrand fuses cloud + wordmark on each of 5 rows (wide terminal)", () => {
  const rows = composeBrand({ enabled: false, cols: 100 });
  assert.equal(rows.length, 5);
  assert.match(rows.map(stripAnsi).join("\n"), /█/);
});
test("narrow terminal falls back to a compact one-line brand", () => {
  const rows = composeBrand({ enabled: false, cols: 40 });
  assert.equal(rows.length, 1);
  assert.match(stripAnsi(rows[0]!), /AETHER/);
});
test("BRAND_WIDTH reflects the wide layout width", () => {
  assert.ok(BRAND_WIDTH > 40);
});
