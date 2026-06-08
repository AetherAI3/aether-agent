import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSelection, handleSlash } from "../src/commands/slash.js";
import type { CatalogItem } from "../src/types.js";
import type { AppContext } from "../src/core/context.js";

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

function fakeCtx(answer: boolean): AppContext {
  return {
    flags: { yes: false, json: false, audit: false, cwd: "." },
    cfg: { defaultModel: "haiku", baseUrl: "x" },
    api: { getJson: async () => ({ tier: "pro", default: "haiku", models: [item("opus")] }) },
    confirm: async () => answer,
  } as unknown as AppContext;
}

test("/model switch prompts and, on yes, signals a restart", async () => {
  const out: string[] = [];
  const res = await handleSlash(fakeCtx(true), "/model opus", {
    write: (s: string) => out.push(s),
  } as never);
  assert.deepEqual(res.restart, { model: "opus" });
  assert.match(out.join(""), /restart the session and clear context/i);
});

test("/model switch on no does NOT restart", async () => {
  const res = await handleSlash(fakeCtx(false), "/model opus", { write: () => {} } as never);
  assert.equal(res.restart, undefined);
});
