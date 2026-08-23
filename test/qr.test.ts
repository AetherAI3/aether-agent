// Structural checks for the dependency-free QR encoder used by /rc.

import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeQr, renderQr, rsEncode, rsGenerator } from "../src/ui/qr.js";

test("the degree-7 Reed–Solomon generator matches the published polynomial", () => {
  // g(x) for 7 EC codewords (integer coefficients, highest degree first):
  assert.deepEqual(rsGenerator(7), [1, 127, 122, 154, 164, 11, 68, 117]);
});

test("RS encoding of the canonical 'HELLO WORLD'-class vector is stable and bounded", () => {
  const ec = rsEncode([16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17, 236], 7);
  assert.equal(ec.length, 7);
  for (const byte of ec) assert.ok(byte >= 0 && byte <= 255);
  // Deterministic: the same data yields the same codewords.
  assert.deepEqual(ec, rsEncode([16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17, 236], 7));
});

test("a short payload encodes as a version-1 (21×21) matrix with intact anatomy", () => {
  const m = encodeQr("AETHER")!;
  assert.equal(m.length, 21);
  for (const row of m) assert.equal(row.length, 21);

  // Finder pattern corners: dark border, light separator ring, dark core.
  for (const [top, left] of [[0, 0], [0, 14], [14, 0]] as const) {
    assert.equal(m[top]![left], true, "finder outer corner is dark");
    assert.equal(m[top + 3]![left + 3], true, "finder core is dark");
    assert.equal(m[top + 1]![left + 1], false, "finder inner ring is light");
  }
  // Timing patterns alternate.
  for (let i = 8; i < 13; i++) {
    assert.equal(m[6]![i], i % 2 === 0);
    assert.equal(m[i]![6], i % 2 === 0);
  }
  // The dark module is always dark: (4*version + 9, 8).
  assert.equal(m[13]![8], true);
});

test("longer payloads pick larger versions; beyond 106 bytes the encoder refuses", () => {
  const v2 = encodeQr("https://viewer.invalid/code/rc/redeem/red_0123456789")!;
  assert.ok(v2.length > 21);
  assert.equal((v2.length - 17) % 4, 0, "matrix size must be a legal QR version size");
  assert.equal(encodeQr("x".repeat(106))!.length, 37); // version 5
  assert.equal(encodeQr("x".repeat(107)), null);
  assert.equal(renderQr("x".repeat(200)), null);
});

test("terminal rendering is deterministic, quiet-zoned, and rectangular", () => {
  const url = "https://viewer.invalid/code/rc/redeem/red_1";
  const a = renderQr(url)!;
  assert.equal(a, renderQr(url)!);
  const lines = a.split("\n");
  const size = encodeQr(url)!.length + 4; // 2-module quiet zone each side
  assert.equal(lines.length, Math.ceil(size / 2));
  for (const line of lines) assert.equal([...line].length, size);
  // The quiet zone renders as light (full blocks) on the first line.
  assert.ok(lines[0]!.startsWith("██"));
});
