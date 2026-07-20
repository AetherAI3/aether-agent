import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("TypeScript 7 toolchain and Node 24 contract stay pinned", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageManifest;
  assert.match(pkg.devDependencies?.["typescript"] ?? "", /^\^7\./);
  assert.match(pkg.devDependencies?.["@types/node"] ?? "", /^\^24\./);
  assert.equal(pkg.engines?.["node"], ">=24");
  assert.equal(pkg.scripts?.["typecheck"], "tsc -p tsconfig.json --noEmit");
});

test("published package stays runtime-dependency-free and excludes compiled tests", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageManifest;
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.ok(pkg.files?.includes("dist/src"));
  assert.ok(!pkg.files?.includes("dist"));
});

test("ESM application source contains no CommonJS require calls", () => {
  const offenders = sourceFiles(join(root, "src"))
    .filter((path) => /\brequire\s*\(/.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(root.length + 1));
  assert.deepEqual(offenders, []);
});
