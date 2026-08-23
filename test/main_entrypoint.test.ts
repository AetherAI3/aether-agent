import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainInvocation } from "../src/main.js";

test("installed npm bin symlink is recognized as the CLI entrypoint", () => {
  const shim = resolve("virtual", "bin", "aether");
  const target = resolve("virtual", "lib", "node_modules", "aether-agents", "dist", "src", "main.js");
  const canonicalTarget = resolve("canonical", "aether-agents", "dist", "src", "main.js");
  const canonicalize = (path: string): string => {
    if (path === shim || path === target) return canonicalTarget;
    return path;
  };

  assert.equal(isMainInvocation(shim, pathToFileURL(target).href, canonicalize), true);
});

test("entrypoint detection stays false for an unrelated importer", () => {
  const importer = resolve("virtual", "node-test-runner.js");
  const target = resolve("virtual", "aether", "main.js");
  assert.equal(isMainInvocation(importer, pathToFileURL(target).href, (path) => path), false);
});

test("entrypoint detection falls back to lexical identity when realpath fails", () => {
  const target = resolve("virtual", "aether", "main.js");
  const failRealpath = (): never => {
    throw new Error("unavailable");
  };

  assert.equal(isMainInvocation(target, pathToFileURL(target).href, failRealpath), true);
});
