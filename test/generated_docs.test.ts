import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { COMMAND_MANIFEST, type CommandManifestEntry } from "../src/commands/command_manifest.js";
import {
  PUBLIC_CATALOGUE_SCHEMA,
  buildGeneratedOutputs,
  generateDocumentation,
  renderCommandReference,
} from "../scripts/generate-docs.js";
import { deterministicRepositoryEvidence } from "../scripts/release-truth.js";

const source = {
  schema: PUBLIC_CATALOGUE_SCHEMA,
  asOf: "2026-08-06T00:00:00.000Z",
  sourcePath: "RELEASE_NOTES.md",
  sourceSection: "Public release",
  scopeNote: "A sanitized, dated subset; live availability remains account-scoped.",
  models: [
    { id: "model_a", label: "Model A", provider: "Provider", kind: "model", tierMin: "pro" },
  ],
};

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aether-docgen-"));
  mkdirSync(join(root, "docs", "model-catalogue"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# Readme\n\n<!-- MODEL-CATALOGUE:START -->\nold\n<!-- MODEL-CATALOGUE:END -->\n", "utf8");
  writeFileSync(join(root, "COMMANDS.md"), "# Commands\n\n<!-- GENERATED-COMMAND-REFERENCE:START -->\nold\n<!-- GENERATED-COMMAND-REFERENCE:END -->\n", "utf8");
  writeFileSync(join(root, "docs", "model-catalogue", "catalogue.source.json"), `${JSON.stringify(source)}\n`, "utf8");
  return root;
}

test("generated command reference is deterministic and sourced from the canonical manifest", () => {
  const first = renderCommandReference(COMMAND_MANIFEST);
  const second = renderCommandReference(COMMAND_MANIFEST);
  assert.equal(first, second);
  assert.match(first, /manifest-digest: sha256:[a-f0-9]{64}/);
  assert.match(first, /`aether agent \[task\]`/);
  assert.match(first, /`\/model <n\\\|id>`/);
  assert.match(first, /Permission: `local-write`/);
  assert.match(first, /Requires: `aether\.hosted-or-local`/);
});

test("bad command mutations fail before any output is written", () => {
  const root = fixtureRoot();
  const original = readFileSync(join(root, "COMMANDS.md"), "utf8");
  const bad = COMMAND_MANIFEST.map((entry, index) => index === 0 ? { ...entry, summary: "" } : entry) as readonly CommandManifestEntry[];
  assert.throws(() => generateDocumentation({ root, commands: bad }), /command manifest is invalid.*missing summary/);
  assert.equal(readFileSync(join(root, "COMMANDS.md"), "utf8"), original);
});

test("empty or invalid catalogue refresh preserves the last-known-good output set", () => {
  const root = fixtureRoot();
  generateDocumentation({ root });
  const paths = buildGeneratedOutputs({ root }).map((output) => output.path);
  const before = new Map(paths.map((path) => [path, readFileSync(join(root, path), "utf8")]));
  const empty = JSON.stringify({ ...source, models: [] });
  assert.throws(() => generateDocumentation({ root, catalogueSourceText: empty }), /refresh is empty.*preserved/);
  assert.throws(() => generateDocumentation({ root, catalogueSourceText: "not json" }), /not valid JSON/);
  assert.throws(() => generateDocumentation({ root, catalogueSourceText: JSON.stringify({ ...source, pricing: "invented" }) }), /unsupported fields: pricing/);
  for (const path of paths) assert.equal(readFileSync(join(root, path), "utf8"), before.get(path));
});

test("docs check detects drift and generation repairs it", () => {
  const root = fixtureRoot();
  generateDocumentation({ root });
  assert.doesNotThrow(() => generateDocumentation({ root, check: true }));
  const path = join(root, "docs", "generated", "commands.md");
  writeFileSync(path, `${readFileSync(path, "utf8")}drift\n`, "utf8");
  assert.throws(() => generateDocumentation({ root, check: true }), /generated documentation drift: docs\/generated\/commands\.md/);
  generateDocumentation({ root });
  assert.doesNotThrow(() => generateDocumentation({ root, check: true }));
});

test("release truth independently binds every generated output and the catalogue digest", () => {
  const root = fixtureRoot();
  generateDocumentation({ root });
  const evidence = deterministicRepositoryEvidence(root);
  assert.equal(evidence.generatedDocs?.state, "available");
  if (evidence.generatedDocs?.state !== "available") return;
  assert.equal(evidence.generatedDocs.value.length, 6);
  assert.ok(evidence.generatedDocs.value.every((item) => item.manifestDigest === item.documentDigest));
  assert.equal(evidence.catalogue?.state, "available");
  if (evidence.catalogue?.state !== "available") return;
  assert.equal(evidence.catalogue.value.catalogueDigest, evidence.catalogue.value.renderedDigest);
  const path = join(root, "docs", "generated", "commands.md");
  writeFileSync(path, `${readFileSync(path, "utf8")}drift\n`, "utf8");
  const drifted = deterministicRepositoryEvidence(root);
  assert.equal(drifted.generatedDocs?.state, "available");
  if (drifted.generatedDocs?.state === "available") {
    assert.ok(drifted.generatedDocs.value.some((item) => item.manifestDigest !== item.documentDigest));
  }
});

test("catalogue outputs are sanitized, deterministic, responsive, and useful without JavaScript", () => {
  const root = fixtureRoot();
  generateDocumentation({ root });
  const json = JSON.parse(readFileSync(join(root, "docs", "model-catalogue", "catalogue.json"), "utf8")) as Record<string, unknown>;
  assert.match(String(json["digest"]), /^sha256:[a-f0-9]{64}$/);
  assert.equal(json["generatedAt"], source.asOf);
  const html = readFileSync(join(root, "docs", "model-catalogue", "index.html"), "utf8");
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<noscript>/);
  assert.match(html, /role="search"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<article class="card"/);
  assert.match(html, /No prices or spend caps are asserted/);
  assert.doesNotMatch(html, /AETHER_TOKEN|Bearer\s+[A-Za-z0-9._-]+|\/api\/internal/i);
});
