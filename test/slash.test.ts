import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSelection } from "../src/commands/slash.js";
import type { CatalogItem } from "../src/types.js";

function item(id: string): CatalogItem {
  return {
    id,
    label: id,
    kind: "model",
    provider: "anthropic",
    context_window: null,
    tier_min: "free",
    enabled: true,
    available: true,
    monthly_uvt_cap: null,
    is_default: false,
  };
}

const list = [item("haiku"), item("sonnet"), item("opus")];

test("resolveSelection picks by 1-based index", () => {
  assert.equal(resolveSelection(list, "2")?.id, "sonnet");
  assert.equal(resolveSelection(list, "1")?.id, "haiku");
});

test("resolveSelection picks by id", () => {
  assert.equal(resolveSelection(list, "opus")?.id, "opus");
});

test("resolveSelection rejects out-of-range index and unknown id", () => {
  assert.equal(resolveSelection(list, "9"), null);
  assert.equal(resolveSelection(list, "0"), null);
  assert.equal(resolveSelection(list, "nope"), null);
  assert.equal(resolveSelection(list, ""), null);
});
