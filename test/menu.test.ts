import test from "node:test";
import assert from "node:assert/strict";
import { SelectMenu, renderMenu, stripAnsi } from "../src/ui/menu.js";
import type { MenuItem } from "../src/ui/menu.js";

const items: MenuItem[] = [
  { id: "a", label: "fal.ai", glyph: "✔", hint: "connected" },
  { id: "sep", label: "──────", disabled: true },
  { id: "b", label: "my-server", glyph: "○" },
];

test("cursor starts on first enabled item and wraps", () => {
  const m = new SelectMenu(items);
  assert.equal(m.selected()?.id, "a");
  m.down();
  assert.equal(m.selected()?.id, "b"); // skipped disabled separator
  m.down();
  assert.equal(m.selected()?.id, "a"); // wrapped
  m.up();
  assert.equal(m.selected()?.id, "b"); // wrapped backwards, skipped disabled
});

test("empty menu selects nothing", () => {
  const m = new SelectMenu([]);
  assert.equal(m.selected(), null);
  m.down(); // no throw
});

test("renderMenu draws box, cursor, glyphs, footer", () => {
  const m = new SelectMenu(items);
  const out = stripAnsi(renderMenu("MCP Servers", m, "↑↓ move · enter manage · q quit"));
  assert.match(out, /╭─.*─╮/);
  assert.match(out, /❯ ✔ fal\.ai\s+connected/);
  assert.match(out, /  ○ my-server/);
  assert.match(out, /↑↓ move · enter manage · q quit/);
  assert.match(out, /╰─.*─╯/);
});

test("renderMenu truncates overlong rows so the box never breaks", () => {
  const long = "x".repeat(80);
  const m = new SelectMenu([{ id: "l", label: long, hint: "https://very-long-url.example.com/mcp/sse/endpoint" }]);
  const out = stripAnsi(renderMenu("T", m, "f"));
  const lines = out.split("\n").filter(Boolean);
  const widths = new Set(lines.map((l) => l.length));
  assert.equal(widths.size, 1); // every line exactly the same width
  assert.match(out, /…/);
});

test("stripAnsi removes SGR sequences", () => {
  assert.equal(stripAnsi("\x1b[36mhi\x1b[0m"), "hi");
});
