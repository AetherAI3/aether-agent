import { test } from "node:test";
import assert from "node:assert/strict";
import { MdStream } from "../src/ui/md_stream.js";
import { createTheme } from "../src/ui/theme.js";

const t = createTheme(true);
const md = (): MdStream => new MdStream(true, t);

test("disabled stream is a byte-identical passthrough", () => {
  const m = new MdStream(false);
  assert.equal(m.feed("# raw **md** `x`\npartial"), "# raw **md** `x`\npartial");
  assert.equal(m.flush(), "");
});

test("complete lines style headers, bold, inline code, bullets", () => {
  const m = md();
  const out = m.feed("## Title\n**bold** and `code`\n- item\n");
  assert.ok(out.includes(t.dim("##")));
  assert.ok(out.includes(t.bold("Title")));
  assert.ok(out.includes(t.bold("bold")));
  assert.ok(out.includes(t.cyan("code")));
  assert.ok(out.includes(t.cyan("•")));
  assert.ok(!out.includes("**"), "bold markers consumed");
});

test("a partial line is held until its newline arrives (split marker safe)", () => {
  const m = md();
  assert.equal(m.feed("**bo"), ""); // held
  const out = m.feed("ld** done\n");
  assert.ok(out.includes(t.bold("bold")), "marker split across chunks still styles");
});

test("fence interior passes through raw; fence markers dim", () => {
  const m = md();
  const out = m.feed('```ts\nconst a = "**not bold**";\n```\n');
  assert.ok(out.includes(t.dim("```ts")));
  assert.ok(out.includes('const a = "**not bold**";'), "code body untouched");
  assert.ok(!out.includes(t.bold("not bold")));
});

test("long un-newlined prose flushes raw so streaming never stalls", () => {
  const m = md();
  const long = "x".repeat(200);
  const out = m.feed(long);
  assert.equal(out, long); // flushed immediately, unstyled
  const tail = m.feed(" tail **late**\n");
  assert.equal(tail, " tail **late**\n"); // rest of that line stays raw
});

test("flush styles the trailing partial line at end of stream", () => {
  const m = md();
  m.feed("**tail**");
  assert.ok(m.flush().includes(t.bold("tail")));
  assert.equal(m.flush(), "");
});

test("unmatched markers stay literal", () => {
  const m = md();
  const out = m.feed("a ** b\n`unclosed\n");
  assert.ok(out.includes("a ** b"));
  assert.ok(out.includes("`unclosed"));
});
