import { test } from "node:test";
import assert from "node:assert/strict";
import { StatusRenderer } from "../src/ui/status_renderer.js";
import { stripAnsi } from "../src/ui/theme.js";

test("composeLine renders verb, elapsed, and streamed tokens", () => {
  let clock = 0;
  const sr = new StatusRenderer({ quiet: true, now: () => clock });
  sr.start();
  sr.setVerb("Forging", "(ง'̀-'́)ง");
  sr.setStreamed(33_000);
  clock = 2 * 60_000 + 14_000;
  const line = stripAnsi(sr.composeLine());
  assert.match(line, /Forging…/);
  assert.match(line, /2m 14s/);
  assert.match(line, /↑ 33\.0K tokens/);
});

test("with no streamed tokens, the ↑ segment is omitted", () => {
  const sr = new StatusRenderer({ quiet: true, now: () => 1000 });
  assert.doesNotMatch(stripAnsi(sr.composeLine()), /↑/);
});
