// qr.ts — dependency-free QR encoder for the /rc terminal display.
// Byte mode, error-correction level L, versions 1–5 (up to 106 bytes), fixed
// mask pattern 0. That envelope is exactly what the Remote Control URL needs;
// anything longer returns null and the caller falls back to the plain URL.
// The repo ships zero runtime dependencies, so this is written out rather than
// pulled from npm.

interface VersionSpec {
  version: number;
  totalCodewords: number;
  ecCodewords: number;
  /** Alignment pattern centers ([] for version 1). */
  alignment: number[];
}

// EC level L, single RS block for every version in range.
const VERSIONS: VersionSpec[] = [
  { version: 1, totalCodewords: 26, ecCodewords: 7, alignment: [] },
  { version: 2, totalCodewords: 44, ecCodewords: 10, alignment: [6, 18] },
  { version: 3, totalCodewords: 70, ecCodewords: 15, alignment: [6, 22] },
  { version: 4, totalCodewords: 100, ecCodewords: 20, alignment: [6, 26] },
  { version: 5, totalCodewords: 134, ecCodewords: 26, alignment: [6, 30] },
];

/** 15-bit format info for EC level L, mask pattern 0 (BCH-encoded, masked). */
const FORMAT_BITS_L_MASK0 = 0b111011111000100;

// ── GF(256), primitive polynomial 0x11d ─────────────────────────────────────
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/** Reed–Solomon generator polynomial of degree `n` (exported for the tests). */
export function rsGenerator(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ gfMul(poly[j]!, GF_EXP[i]!);
      next[j + 1] = next[j + 1]! ^ poly[j]!;
    }
    poly = next;
  }
  // The building loop accumulates coefficients lowest-degree first; the QR RS
  // division in rsEncode (and the canonical published form) wants them
  // highest-degree first, leading 1 at index 0. Reverse once, here.
  return poly.reverse();
}

/** RS error-correction codewords for `data` (exported for the tests). */
export function rsEncode(data: number[], ecLength: number): number[] {
  const gen = rsGenerator(ecLength);
  const remainder = new Array<number>(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift()!;
    remainder.push(0);
    for (let i = 0; i < gen.length - 1; i++) {
      remainder[i] = remainder[i]! ^ gfMul(gen[i + 1]!, factor);
    }
  }
  return remainder;
}

// ── matrix construction ─────────────────────────────────────────────────────

type Matrix = (boolean | null)[][]; // null = unset data module

function emptyMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
}

function placeFinder(m: Matrix, top: number, left: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const row = top + r;
      const col = left + c;
      if (row < 0 || col < 0 || row >= m.length || col >= m.length) continue;
      const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m[row]![col] = inOuter || inInner;
    }
  }
}

function placeAlignment(m: Matrix, centers: number[]): void {
  for (const row of centers) {
    for (const col of centers) {
      if (m[row]![col] !== null) continue; // overlaps a finder
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          m[row + r]![col + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        }
      }
    }
  }
}

function placeTimingAndDark(m: Matrix, version: number): void {
  const size = m.length;
  for (let i = 8; i < size - 8; i++) {
    if (m[6]![i] === null) m[6]![i] = i % 2 === 0;
    if (m[i]![6] === null) m[i]![6] = i % 2 === 0;
  }
  m[4 * version + 9]![8] = true; // dark module
}

function reserveFormat(m: Matrix): void {
  const size = m.length;
  for (let i = 0; i < 9; i++) {
    if (m[8]![i] === null) m[8]![i] = false;
    if (m[i]![8] === null) m[i]![8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (m[8]![size - 1 - i] === null) m[8]![size - 1 - i] = false;
    if (m[size - 1 - i]![8] === null) m[size - 1 - i]![8] = false;
  }
}

function writeFormat(m: Matrix, bits: number): void {
  const size = m.length;
  const bit = (i: number): boolean => ((bits >> (14 - i)) & 1) === 1;
  // Copy 1, around the top-left finder.
  for (let i = 0; i < 6; i++) m[8]![i] = bit(i);
  m[8]![7] = bit(6);
  m[8]![8] = bit(7);
  m[7]![8] = bit(8);
  for (let i = 9; i < 15; i++) m[14 - i]![8] = bit(i);
  // Copy 2, split between the other two finders.
  for (let i = 0; i < 8; i++) m[size - 1 - i]![8] = bit(i);
  for (let i = 8; i < 15; i++) m[8]![size - 15 + i] = bit(i);
}

function fillData(m: Matrix, codewords: number[]): void {
  const size = m.length;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5; // the vertical timing column is skipped whole
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (m[row]![c] !== null) continue;
        let dark = false;
        if (bitIndex < totalBits) {
          const byte = codewords[bitIndex >> 3]!;
          dark = ((byte >> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex += 1;
        }
        // Mask pattern 0: invert when (row + column) is even.
        if ((row + c) % 2 === 0) dark = !dark;
        m[row]![c] = dark;
      }
    }
    upward = !upward;
  }
}

// ── encoding ────────────────────────────────────────────────────────────────

function buildCodewords(data: Uint8Array, spec: VersionSpec): number[] {
  const dataCodewords = spec.totalCodewords - spec.ecCodewords;
  const bits: number[] = [];
  const push = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(data.length, 8); // count (8 bits through version 9)
  for (const byte of data) push(byte, 8);
  const capacity = dataCodewords * 8;
  push(0, Math.min(4, capacity - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
    codewords.push(byte);
  }
  const pad = [0xec, 0x11];
  for (let i = 0; codewords.length < dataCodewords; i++) codewords.push(pad[i % 2]!);
  return [...codewords, ...rsEncode(codewords, spec.ecCodewords)];
}

/**
 * Encode `text` (UTF-8, byte mode, EC L, mask 0) into a boolean module matrix,
 * true = dark. Returns null when the text does not fit version 5 (106 bytes).
 * Exported for the structural tests; renderQr() is the display entry point.
 */
export function encodeQr(text: string): boolean[][] | null {
  const data = new TextEncoder().encode(text);
  const spec = VERSIONS.find((v) => v.totalCodewords - v.ecCodewords - 2 >= data.length);
  if (!spec) return null;
  const size = 17 + 4 * spec.version;
  const m = emptyMatrix(size);
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);
  placeAlignment(m, spec.alignment);
  placeTimingAndDark(m, spec.version);
  reserveFormat(m);
  fillData(m, buildCodewords(data, spec));
  writeFormat(m, FORMAT_BITS_L_MASK0);
  return m.map((row) => row.map((cell) => cell === true));
}

/**
 * Render `text` as a terminal QR using half-block characters (two modules per
 * character row), with a 2-module quiet zone. LIGHT modules are drawn as
 * blocks so the code reads correctly on dark terminal backgrounds. Returns
 * null when the text is too long to encode.
 */
export function renderQr(text: string): string | null {
  const matrix = encodeQr(text);
  if (!matrix) return null;
  const quiet = 2;
  const size = matrix.length + quiet * 2;
  const dark = (row: number, col: number): boolean => {
    const r = row - quiet;
    const c = col - quiet;
    if (r < 0 || c < 0 || r >= matrix.length || c >= matrix.length) return false;
    return matrix[r]![c]!;
  };
  const lines: string[] = [];
  for (let row = 0; row < size; row += 2) {
    let line = "";
    for (let col = 0; col < size; col++) {
      const topLight = !dark(row, col);
      const bottomLight = row + 1 < size ? !dark(row + 1, col) : true;
      line += topLight ? (bottomLight ? "█" : "▀") : bottomLight ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
