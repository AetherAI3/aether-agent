import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStatusBar, humanTokens, TOKENS_PER_GB } from "../src/ui/statusbar.js";
import { KAOMOJI } from "../src/ui/kaomoji.js";

test("denominator follows the selected pool size", () => {
  // 5 GB pool reach = 5 x 233M = 1.165B
  const line5 = renderStatusBar(412_600_000, 5);
  assert.match(line5, /1\.17B tokens/);
  assert.match(line5, /local\/cache/);
  // 20 GB pool reach = 4.66B
  const line20 = renderStatusBar(1_800_000_000, 20);
  assert.match(line20, /4\.66B tokens/);
});

test("percent is used/cap and clamps at 100", () => {
  assert.match(renderStatusBar(412_600_000, 5), /35\.4%/); // 412.6M / 1.165B
  assert.match(renderStatusBar(10 ** 13, 5), /100\.0%/);
});

test("an explicit poolCap overrides the derived denominator", () => {
  const line = renderStatusBar(100, 5, "reasoning", 30, 500);
  assert.match(line, /100 \/ 500 tokens/);
  assert.match(line, /20\.0%/);
});

test("phase sets the label + kaomoji", () => {
  assert.match(renderStatusBar(1, 5, "grounding"), /grounding/);
  assert.match(renderStatusBar(1, 5, "scanning"), /scanning repo/);
});

test("phase faces come from the single kaomoji table", () => {
  assert.ok(renderStatusBar(1, 5, "scanning").includes(KAOMOJI.scanning));
  assert.ok(renderStatusBar(1, 5, "reasoning").includes(KAOMOJI.active));
  assert.ok(renderStatusBar(1, 5, "grounding").includes(KAOMOJI.error));
  assert.ok(renderStatusBar(1, 5, "anchoring").includes(KAOMOJI.logging));
  assert.ok(renderStatusBar(1, 5, "paging").includes(KAOMOJI.idle));
});

test("humanTokens scales units", () => {
  assert.equal(humanTokens(1_165_000_000), "1.17B");
  assert.equal(humanTokens(412_600_000), "412.6M");
  assert.equal(TOKENS_PER_GB, 233_000_000);
});
