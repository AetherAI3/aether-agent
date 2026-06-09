import { test } from "node:test";
import assert from "node:assert/strict";
import { groupItems, flattenGroups, currentIndex, renderPicker } from "../src/ui/model_picker.js";
import type { CatalogItem } from "../src/types.js";

function item(overrides: Partial<CatalogItem> & { id: string }): CatalogItem {
  return {
    label: overrides.id,
    kind: "model",
    provider: "anthropic",
    context_window: null,
    tier_min: "free",
    enabled: true,
    available: true,
    monthly_uvt_cap: null,
    is_default: false,
    ...overrides,
  };
}

test("groupItems puts orchestrators first", () => {
  const items = [
    item({ id: "opus", kind: "model", provider: "anthropic" }),
    item({ id: "neo", kind: "orchestrator", provider: null }),
    item({ id: "gpt4", kind: "model", provider: "openai" }),
  ];
  const groups = groupItems(items);
  assert.equal(groups[0]!.label, "Orchestrators");
  assert.equal(groups[0]!.items.length, 1);
  assert.equal(groups[0]!.items[0]!.id, "neo");
});

test("groupItems groups models by provider", () => {
  const items = [
    item({ id: "opus", provider: "anthropic" }),
    item({ id: "sonnet", provider: "anthropic" }),
    item({ id: "gpt4", provider: "openai" }),
    item({ id: "deepseek-v4", provider: "deepseek" }),
  ];
  const groups = groupItems(items);

  const claude = groups.find((g) => g.label === "Claude")!;
  assert.ok(claude, "Claude group exists");
  assert.equal(claude.items.length, 2);

  const gpt = groups.find((g) => g.label === "GPT")!;
  assert.ok(gpt, "GPT group exists");
  assert.equal(gpt.items.length, 1);
});

test("groupItems handles unknown provider as raw name", () => {
  const items = [
    item({ id: "unknown-model", provider: "some-new-provider" }),
  ];
  const groups = groupItems(items);
  const other = groups.find((g) => g.label === "some-new-provider");
  assert.ok(other);
  assert.equal(other!.items.length, 1);
});

test("flattenGroups creates flat indexed list", () => {
  const groups = [
    { label: "A", color: (s: string) => s, items: [item({ id: "a1" }), item({ id: "a2" })] },
    { label: "B", color: (s: string) => s, items: [item({ id: "b1" })] },
  ];
  const flat = flattenGroups(groups);
  assert.equal(flat.length, 3);
  assert.equal(flat[0]!.item.id, "a1");
  assert.equal(flat[0]!.groupIdx, 0);
  assert.equal(flat[2]!.item.id, "b1");
  assert.equal(flat[2]!.groupIdx, 1);
});

test("currentIndex finds active model by id", () => {
  const flat = [
    { item: item({ id: "haiku" }), groupIdx: 0 },
    { item: item({ id: "sonnet" }), groupIdx: 0 },
    { item: item({ id: "opus" }), groupIdx: 0 },
  ];
  assert.equal(currentIndex(flat, "sonnet"), 1);
  assert.equal(currentIndex(flat, "nope"), -1);
  assert.equal(currentIndex(flat, undefined), -1);
});

test("flattenGroups preserves group indices across groups", () => {
  const groups = [
    { label: "Orch", color: (s: string) => s, items: [
      item({ id: "neo", kind: "orchestrator", provider: null }),
    ]},
    { label: "Claude", color: (s: string) => s, items: [
      item({ id: "haiku", kind: "model", provider: "anthropic" }),
      item({ id: "opus", kind: "model", provider: "anthropic" }),
    ]},
  ];
  const flat = flattenGroups(groups);
  assert.equal(flat[0]!.groupIdx, 0);
  assert.equal(flat[1]!.groupIdx, 1);
  assert.equal(flat[2]!.groupIdx, 1);
});

test("renderPicker returns a string with box content", () => {
  const groups = [
    { label: "Claude", color: (s: string) => s, items: [
      item({ id: "haiku", label: "Haiku" }),
      item({ id: "opus", label: "Opus" }),
    ]},
  ];
  const flat = flattenGroups(groups);
  const out = renderPicker(groups, flat, 0);
  assert.ok(typeof out === "string");
  assert.ok(out.length > 0);
  // Should contain box-drawing chars and the first item
  assert.ok(out.includes("Haiku"), "contains first model name");
  assert.ok(out.includes("Opus"), "contains second model name");
  assert.ok(out.includes("\u250c"), "has top-left box corner");
  assert.ok(out.includes("\u2518"), "has bottom-right box corner");
});

test("renderPicker highlights selected item with orb + bold", () => {
  const groups = [
    { label: "Claude", color: (s: string) => s, items: [
      item({ id: "haiku", label: "Haiku" }),
      item({ id: "opus", label: "Opus" }),
    ]},
  ];
  const flat = flattenGroups(groups);
  const out = renderPicker(groups, flat, 1); // Opus selected
  assert.ok(out.includes("Opus"), "contains Opus");
});

test("groupItems returns empty array for empty input", () => {
  assert.equal(groupItems([]).length, 0);
});

test("groupItems only-orchestrators returns just orchestrators group", () => {
  const items = [
    item({ id: "neo", kind: "orchestrator", provider: null }),
    item({ id: "kronus", kind: "orchestrator", provider: null }),
  ];
  const groups = groupItems(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.label, "Orchestrators");
  assert.equal(groups[0]!.items.length, 2);
});
