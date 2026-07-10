import { test } from "node:test";
import assert from "node:assert/strict";
import { clipCodePoints } from "../src/ui/theme.js";

test("clipCodePoints leaves short strings alone", () => {
  assert.equal(clipCodePoints("hi", 10), "hi");
});

test("clipCodePoints truncates ASCII with an ellipsis", () => {
  assert.equal(clipCodePoints("abcdefghij", 5), "abcd…");
});

test("clipCodePoints never splits an emoji (surrogate pair) at the boundary", () => {
  // "a" + rocket emoji (surrogate pair) + "b" — clipping to 2 chars must not
  // cut the emoji in half and emit a lone unpaired surrogate.
  const s = "a🚀b";
  const clipped = clipCodePoints(s, 2);
  assert.equal(clipped, "a…");
  assert.doesNotMatch(clipped, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, "unpaired high surrogate");
  assert.doesNotMatch(clipped, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, "unpaired low surrogate");
});
