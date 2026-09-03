import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainInvocation, MINIMUM_NODE_MAJOR, unsupportedNodeMessage } from "../src/main.js";

test("unsupported Node versions provide one copyable recovery path", () => {
  assert.equal(MINIMUM_NODE_MAJOR, 24);
  assert.equal(unsupportedNodeMessage("24.0.0"), null);
  assert.equal(unsupportedNodeMessage("v26.1.0"), null);
  for (const version of ["23.9.0", "v20.0.0", "", "not-a-version"]) {
    const message = unsupportedNodeMessage(version);
    assert.ok(message);
    assert.match(message, /requires Node\.js >= 24/);
    assert.match(message, /reopen your terminal.*aether --version/s);
    assert.match(message, /nodejs\.org\/en\/download/);
  }
});

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
