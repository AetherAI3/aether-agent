// Canonical skill digest: deterministic over declared content only, bounded,
// and symlink-escape safe.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  calculateSkillDigest,
  canonicalJson,
  digestFileList,
  sha256Hex,
} from "../src/core/skills/skill_digest.js";
import { validateSkillManifest, type SkillManifest } from "../src/core/skills/skill_schema.js";
import { SKILL_BOUNDS } from "../src/core/skills/skill_bounds.js";

let base: string;
let counter = 0;

before(() => {
  base = mkdtempSync(join(tmpdir(), "aether-digest-"));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

function rawManifest(resources: readonly string[] = []): Record<string, unknown> {
  return {
    schema_version: 1,
    id: "project/digest-demo",
    version: "1.0.0",
    name: "Digest Demo",
    description: "Fixture skill for digest tests.",
    context: { resources: [...resources] },
  };
}

function parseManifest(raw: Record<string, unknown>): SkillManifest {
  const validation = validateSkillManifest(raw, "project");
  assert.equal(validation.ok, true, JSON.stringify(validation.ok ? [] : validation.errors));
  if (!validation.ok) throw new Error("unreachable");
  return validation.manifest;
}

function makeSkillDir(files: Readonly<Record<string, string | Buffer>>): string {
  const root = join(base, "skill-" + counter++);
  mkdirSync(root, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const full = join(root, relative);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function digestOf(root: string, raw: Record<string, unknown>): string {
  const result = calculateSkillDigest(root, parseManifest(raw), raw);
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  if (!result.ok) throw new Error("unreachable");
  return result.sha256;
}

test("canonicalJson sorts keys at every level", () => {
  const a = canonicalJson({ b: 1, a: { d: [1, 2], c: null } });
  const b = canonicalJson({ a: { c: null, d: [1, 2] }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":null,"d":[1,2]},"b":1}');
});

test("digest is deterministic across manifest key order", () => {
  const root = makeSkillDir({ "SKILL.md": "# body\n", "res.md": "resource\n" });
  const rawA = rawManifest(["res.md"]);
  const rawB: Record<string, unknown> = {
    context: { resources: ["res.md"] },
    description: "Fixture skill for digest tests.",
    name: "Digest Demo",
    version: "1.0.0",
    id: "project/digest-demo",
    schema_version: 1,
  };
  assert.equal(digestOf(root, rawA), digestOf(root, rawB));
});

test("changing one SKILL.md byte changes the digest", () => {
  const root = makeSkillDir({ "SKILL.md": "instructions v1\n" });
  const raw = rawManifest();
  const first = digestOf(root, raw);
  writeFileSync(join(root, "SKILL.md"), "instructions v2\n");
  const second = digestOf(root, raw);
  assert.notEqual(first, second);
});

test("changing a declared resource changes the digest", () => {
  const root = makeSkillDir({ "SKILL.md": "body\n", "notes.md": "one\n" });
  const raw = rawManifest(["notes.md"]);
  const first = digestOf(root, raw);
  writeFileSync(join(root, "notes.md"), "two\n");
  assert.notEqual(first, digestOf(root, raw));
});

test("an undeclared file never contributes to the digest", () => {
  const root = makeSkillDir({ "SKILL.md": "body\n" });
  const raw = rawManifest();
  const first = digestOf(root, raw);
  writeFileSync(join(root, "stray.md"), "does not count\n");
  assert.equal(first, digestOf(root, raw));
});

test("missing declared file fails the digest", () => {
  const root = makeSkillDir({ "SKILL.md": "body\n" });
  const raw = rawManifest(["ghost.md"]);
  const result = calculateSkillDigest(root, parseManifest(raw), raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /declared file missing: ghost\.md/);
});

test("declared file over the byte cap fails", () => {
  const oversized = Buffer.alloc(SKILL_BOUNDS.maxResourceBytes + 1, 0x61);
  const root = makeSkillDir({ "SKILL.md": "body\n", "big.md": oversized });
  const raw = rawManifest(["big.md"]);
  const result = calculateSkillDigest(root, parseManifest(raw), raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /exceeds \d+ bytes: big\.md/);
});

test("symlink escaping the skill root fails", (t) => {
  const outside = join(base, "outside-secret.md");
  writeFileSync(outside, "secret outside the root\n");
  const root = makeSkillDir({ "SKILL.md": "body\n" });
  try {
    symlinkSync(outside, join(root, "link.md"), "file");
  } catch (error) {
    // Windows without Developer Mode refuses symlink creation (EPERM).
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      t.skip("symlink creation not permitted on this host");
      return;
    }
    throw error;
  }
  const raw = rawManifest(["link.md"]);
  const result = calculateSkillDigest(root, parseManifest(raw), raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /escapes the skill root: link\.md/);
});

test("digestFileList sorts and deduplicates, sha256Hex matches node crypto shape", () => {
  const raw = rawManifest(["z.md", "a.md"]);
  raw["health"] = { eval_manifest: "evals/e.json" };
  const files = digestFileList(parseManifest(raw));
  assert.deepEqual(files, ["SKILL.md", "a.md", "evals/e.json", "z.md"]);
  assert.match(sha256Hex("abc"), /^[0-9a-f]{64}$/);
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
