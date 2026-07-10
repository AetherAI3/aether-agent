import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/version.js";

// version.ts promises "kept in lockstep with package.json" — pin that promise.
test("VERSION is in lockstep with package.json", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
  assert.equal(VERSION, pkg.version);
});
