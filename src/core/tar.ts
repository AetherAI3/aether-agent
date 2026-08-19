// Minimal uncompressed ustar writer/reader — zero-dep support-bundle
// packaging. Deliberately narrow: regular files only, relative names under
// 100 bytes, no symlinks, no prefix field, deterministic headers (uid/gid 0,
// mtime 0, mode 0644). The reader fails closed on anything outside that set.

const BLOCK = 512;

export interface TarEntry {
  name: string;
  data: Buffer;
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function writeHeader(name: string, size: number): Buffer {
  if (name.length === 0 || name.length > 100) throw new Error("tar entry name must be 1..100 chars");
  if (name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("tar entry name must be a clean relative path: " + name);
  }
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, 100, "utf8");
  header.write(octal(0o644, 8), 100);
  header.write(octal(0, 8), 108); // uid
  header.write(octal(0, 8), 116); // gid
  header.write(octal(size, 12), 124);
  header.write(octal(0, 12), 136); // mtime — deterministic
  header.write("        ", 148); // checksum placeholder: 8 spaces
  header.write("0", 156); // typeflag: regular file
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return header;
}

export function writeTar(entries: readonly TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    parts.push(writeHeader(entry.name, entry.data.length));
    parts.push(entry.data);
    const remainder = entry.data.length % BLOCK;
    if (remainder) parts.push(Buffer.alloc(BLOCK - remainder));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // archive terminator
  return Buffer.concat(parts);
}

function parseOctal(buffer: Buffer, offset: number, length: number): number {
  const text = buffer.toString("ascii", offset, offset + length).replace(/[\0 ]+$/g, "").trim();
  if (!/^[0-7]*$/.test(text)) throw new Error("tar header field is not octal");
  return text ? parseInt(text, 8) : 0;
}

/** Parse an archive produced by writeTar (or equivalent). Throws on symlinks,
 * absolute or traversal names, bad checksums, or truncated data. */
export function readTar(archive: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const magic = header.toString("ascii", 257, 262);
    if (magic !== "ustar") throw new Error("tar entry missing ustar magic");
    const stored = parseOctal(header, 148, 8);
    let sum = 0;
    for (let index = 0; index < BLOCK; index++) {
      sum += index >= 148 && index < 156 ? 0x20 : header[index]!;
    }
    if (sum !== stored) throw new Error("tar header checksum mismatch");
    const typeflag = String.fromCharCode(header[156]!);
    if (typeflag !== "0" && typeflag !== "\0") throw new Error("tar entry is not a regular file");
    const nameEnd = header.indexOf(0);
    const name = header.toString("utf8", 0, nameEnd < 0 || nameEnd > 100 ? 100 : nameEnd);
    if (
      !name ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new Error("tar entry name rejected: " + name);
    }
    const size = parseOctal(header, 124, 12);
    const dataStart = offset + BLOCK;
    if (dataStart + size > archive.length) throw new Error("tar entry truncated: " + name);
    entries.push({ name, data: Buffer.from(archive.subarray(dataStart, dataStart + size)) });
    offset = dataStart + size + (size % BLOCK ? BLOCK - (size % BLOCK) : 0);
  }
  return entries;
}
