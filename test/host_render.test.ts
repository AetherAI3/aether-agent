import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { HostRenderer } from "../src/ui/host_render.js";
import { stripAnsi } from "../src/ui/theme.js";

class Capture extends Writable {
  private readonly chunks: string[] = [];

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

function renderer(): { r: HostRenderer; out: Capture; err: Capture } {
  const out = new Capture();
  const err = new Capture();
  return { r: new HostRenderer({ poolGb: 5, out, err }), out, err };
}

test("done ok carries the OKAY badge and victory face", () => {
  const { r, out } = renderer();
  r.event({ type: "done", ok: true, result: "all green", remaining: 0, reason: "" });
  const text = stripAnsi(out.text());
  assert.match(text, /ᕙ\(`▽`\)ᕗ all green \[ OKAY \]/);
});

test("done !ok carries the FAIL badge and defeat face", () => {
  const { r, out } = renderer();
  r.event({ type: "done", ok: false, result: "", remaining: 0, reason: "" });
  const text = stripAnsi(out.text());
  assert.match(text, /o\(TヘTo\) stopped \[ FAIL \]/);
});

test("error events go to stderr with the ✗ glyph", () => {
  const { r, err } = renderer();
  r.event({ type: "error", msg: "boom" });
  assert.match(stripAnsi(err.text()), /✗ boom/);
});

test("stage lines show the header once, then name + face", () => {
  const { r, out } = renderer();
  r.event({ type: "stage", name: "recon", face: "" });
  r.event({ type: "stage", name: "execute", face: "" });
  const text = stripAnsi(out.text());
  assert.equal(text.match(/Aether AI/g)?.length, 1);
  assert.match(text, /\* recon/);
  assert.match(text, /\* execute {2}\(ง'̀-'́\)ง/);
});

test("json mode passes events through verbatim, no decoration", () => {
  const out = new Capture();
  const err = new Capture();
  const r = new HostRenderer({ poolGb: 5, json: true, out, err });
  r.event({ type: "done", ok: false, result: "x", remaining: 0, reason: "" });
  r.writeLines(["decorated diff"]);
  assert.equal(out.text(), JSON.stringify({ type: "done", ok: false, result: "x", remaining: 0, reason: "" }) + "\n");
  assert.equal(err.text(), "");
});
