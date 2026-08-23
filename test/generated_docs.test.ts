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
  sha256,
} from "../scripts/generate-docs.js";
import { deterministicRepositoryEvidence } from "../scripts/release-truth.js";

const provenanceText = "## Public release\n\nDocumented model `model_a` is hosted for Pro accounts.\n";
const source = {
  schema: PUBLIC_CATALOGUE_SCHEMA,
  asOf: "2026-08-06T00:00:00.000Z",
  source: {
    kind: "repository-markdown-section",
    path: "RELEASE_NOTES.md",
    section: "Public release",
    digest: sha256(provenanceText),
  },
  scopeNote: "A sanitized, dated subset; live availability remains account-scoped.",
  models: [
    { id: "model_a", label: "Model A", provider: "unknown", kind: "model", tierMin: "pro", modality: "unknown", hosting: "hosted", availability: "unknown", evidence: "`model_a`" },
  ],
} as const;

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aether-docgen-"));
  mkdirSync(join(root, "docs", "model-catalogue"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# Readme\n\n<!-- MODEL-CATALOGUE:START -->\nold\n<!-- MODEL-CATALOGUE:END -->\n", "utf8");
  writeFileSync(join(root, "COMMANDS.md"), "# Commands\n\n<!-- GENERATED-COMMAND-REFERENCE:START -->\nold\n<!-- GENERATED-COMMAND-REFERENCE:END -->\n", "utf8");
  writeFileSync(join(root, "RELEASE_NOTES.md"), provenanceText, "utf8");
  writeFileSync(join(root, "docs", "model-catalogue", "catalogue.source.json"), `${JSON.stringify(source)}\n`, "utf8");
  return root;
}

test("generated command reference is deterministic and sourced from the canonical manifest", () => {
  const first = renderCommandReference(COMMAND_MANIFEST);
  const second = renderCommandReference(COMMAND_MANIFEST);
  assert.equal(first, second);
  assert.match(first, /manifest-digest: sha256:[a-f0-9]{64}/);
  assert.match(first, /`aether agent \[task\]`/);
  assert.match(first, /`\/model <n\|id>`/);
  assert.match(first, /Permission: `local-write`/);
  assert.match(first, /Requires: `aether\.hosted-or-local`/);
});

test("bad command mutations fail before any output is written", () => {
  const root = fixtureRoot();
  const original = readFileSync(join(root, "COMMANDS.md"), "utf8");
  const bad = COMMAND_MANIFEST.map((entry, index) => index === 0 ? { ...entry, summary: "" } : entry) as readonly CommandManifestEntry[];
  assert.throws(() => generateDocumentation({ root, commands: bad }), /command 0 summary is required/);
  assert.equal(readFileSync(join(root, "COMMANDS.md"), "utf8"), original);
});

test("command section, summary, and args reject hostile public content before manifest diagnostics", () => {
  const mutations = [
    { section: "**injected heading**" },
    { summary: "password=hunter2" },
    { args: "[click](https://evil.test) `code` --token=plain-secret-value" },
  ] as const;
  for (const mutation of mutations) {
    const mutated = COMMAND_MANIFEST.map((entry, index) => index === 0 ? { ...entry, ...mutation } : entry) as readonly CommandManifestEntry[];
    let message = "";
    try { renderCommandReference(mutated); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    assert.match(message, /contains (?:credential-shaped content|markdown injection)/);
    assert.doesNotMatch(message, /hunter2|plain-secret-value|evil\.test/);
  }
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

test("provenance must exist, match its digest, and exactly evidence every non-generic model id", () => {
  const root = fixtureRoot();
  generateDocumentation({ root });
  const lastGood = readFileSync(join(root, "docs", "model-catalogue", "catalogue.json"), "utf8");
  const nonexistent = { ...source, source: { ...source.source, path: "MISSING.md" } };
  assert.throws(() => generateDocumentation({ root, catalogueSourceText: JSON.stringify(nonexistent) }), /provenance file does not exist/);
  const changed = { ...source, source: { ...source.source, digest: `sha256:${"0".repeat(64)}` } };
  assert.throws(() => generateDocumentation({ root, catalogueSourceText: JSON.stringify(changed) }), /digest does not match/);
  const invented = {
    ...source,
    models: [...source.models, { ...source.models[0], id: "invented", label: "Invented", evidence: "`invented`" }],
  };
  assert.throws(() => generateDocumentation({ root, catalogueSourceText: JSON.stringify(invented) }), /invented has no exact backticked evidence/);
  const generic = { ...source, models: [{ ...source.models[0], id: "model", evidence: "model" }] };
  assert.throws(() => generateDocumentation({ root, catalogueSourceText: JSON.stringify(generic) }), /invalid or generic id/);
  const substringText = "## Public release\n\nDocumented preview `model_a_preview` is hosted for Pro accounts.\n";
  writeFileSync(join(root, "RELEASE_NOTES.md"), substringText, "utf8");
  const substring = {
    ...source,
    source: { ...source.source, digest: sha256(substringText) },
    models: [{ ...source.models[0], evidence: "model_a" }],
  };
  assert.throws(() => generateDocumentation({ root, catalogueSourceText: JSON.stringify(substring) }), /no exact backticked evidence/);
  const fencedText = "## Public release\n\nA generic fenced value is not inline evidence: ```model_a```.\n";
  writeFileSync(join(root, "RELEASE_NOTES.md"), fencedText, "utf8");
  const fenced = { ...source, source: { ...source.source, digest: sha256(fencedText) } };
  assert.throws(() => generateDocumentation({ root, catalogueSourceText: JSON.stringify(fenced) }), /no exact backticked evidence/);
  assert.equal(readFileSync(join(root, "docs", "model-catalogue", "catalogue.json"), "utf8"), lastGood);
});

test("future timestamps and hostile public strings are rejected without leaking their values", () => {
  const root = fixtureRoot();
  const future = { ...source, asOf: "2999-01-01T00:00:00.000Z" };
  assert.throws(() => generateDocumentation({ root, catalogueSourceText: JSON.stringify(future) }), /materially in the future/);
  const hostile = [
    ["Bearer top.secret.value", /credential-shaped/],
    ["password=hunter2", /credential-shaped/],
    ["token=plain-secret-value", /credential-shaped/],
    ["glpat-abcdefghijklmnop", /credential-shaped/],
    ["https://user:password@example.test/data", /credential-shaped/],
    ["Read \/api\/internal\/models", /internal route/],
    ["Read http://[::1]:8080/models", /internal route/],
    ["Read http://[fd00::1]/models", /internal route/],
    ["The cost per token is low", /pricing assertion/],
    ["Only 9 cents per token", /pricing assertion/],
    ["**injected emphasis**", /markdown injection/],
    ["# injected heading", /markdown injection/],
    ["[click](https://evil.test)", /markdown injection/],
    ["`injected code`", /markdown injection/],
    ["unsafe\u0000text", /control characters/],
  ] as const;
  for (const [scopeNote, expected] of hostile) {
    let message = "";
    try { generateDocumentation({ root, catalogueSourceText: JSON.stringify({ ...source, scopeNote }) }); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    assert.match(message, expected);
    assert.doesNotMatch(message, /top\.secret\.value|hunter2|plain-secret-value|abcdefghijklmnop|user:password|evil\.test/);
  }
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

test("docs check and release digests normalize CRLF checkouts", () => {
  const root = fixtureRoot();
  const outputs = generateDocumentation({ root });
  for (const output of outputs) {
    const path = join(root, output.path);
    writeFileSync(path, readFileSync(path, "utf8").replace(/\n/g, "\r\n"), "utf8");
  }
  assert.doesNotThrow(() => generateDocumentation({ root, check: true }));
  const evidence = deterministicRepositoryEvidence(root);
  assert.equal(evidence.generatedDocs?.state, "available");
  if (evidence.generatedDocs?.state === "available") {
    assert.ok(evidence.generatedDocs.value.every((item) => item.manifestDigest === item.documentDigest));
  }
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
  for (const id of ["provider", "modality", "tier", "hosting", "availability"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<option>local<\/option><option>hosted<\/option><option>unknown<\/option>/);
  assert.match(html, /data-modality="unknown" data-tier="pro" data-hosting="hosted" data-availability="unknown"/);
  assert.match(html, /No prices or spend caps are asserted/);
  assert.doesNotMatch(html, /AETHER_TOKEN|Bearer\s+[A-Za-z0-9._-]+|\/api\/internal/i);
  assert.doesNotMatch(html, /href="[^\"]*RELEASE_NOTES/);
  const markdown = readFileSync(join(root, "docs", "generated", "model-catalogue.md"), "utf8");
  assert.doesNotMatch(markdown, /\]\([^)]*RELEASE_NOTES/);
});
