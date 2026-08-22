// Release coherence — the repository must describe exactly one release.
//
// The defect this file exists to make impossible:
//
//   On 2026-08-20 the repository described FIVE different releases at once.
//   package.json said 0.2.0. package-lock.json still said 0.1.0 (the #81 bump
//   never touched it). RELEASE_NOTES.md's top entry described a 0.2.0 whose
//   feature list was written before #72 added `aether skills` and
//   `aether capabilities`. The npm registry served 0.1.0. And a packed
//   aether-agents-0.2.0.tgz sat committed in the repo root from #83 until #90
//   deleted it. Nothing was lying on purpose; the four statements simply drifted
//   apart because nothing compared them.
//
// Two gates, both asserting file contents on disk rather than prose:
//
//   A. VERSION IDENTITY — every place that names the release names the same one.
//   B. FEATURE REACHABILITY — for every feature the release notes claim, the
//      code that implements it is inside the packed tarball's file list, and the
//      command that exposes it is in the CLI registry. This is the user-visible
//      objective stated as an assertion: the package users install contains the
//      features the repository says it contains.
//
// Gate B is the load-bearing one. verify-production.ts checks that the package
// contains its entrypoints and nothing forbidden; it has no idea what the
// release notes promised, so a feature dropped from the allowlist passes it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPackReport } from "../scripts/verify-production.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]): string => readFileSync(join(root, ...parts), "utf8");

const pkg = JSON.parse(read("package.json")) as { name: string; version: string };
const VERSION = pkg.version;

// ── Gate A: one release, named consistently ─────────────────────────────────

test("the lockfile names the same version as the manifest, in both places", () => {
  // package-lock.json carries the version twice: at the root and under
  // packages[""]. #81 bumped package.json and neither of these, so `npm ci`
  // installed a tree that disagreed with the manifest it was built from.
  const lock = JSON.parse(read("package-lock.json")) as {
    name: string;
    version: string;
    packages: Record<string, { name?: string; version?: string }>;
  };
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, VERSION, "package-lock.json root version drifted from package.json");
  assert.equal(lock.packages[""]?.version, VERSION, 'package-lock.json packages[""] version drifted');
});

test("RELEASE_NOTES.md leads with the version the package declares", () => {
  const notes = read("RELEASE_NOTES.md");
  const firstHeading = notes.split(/\r?\n/).find((line) => /^#\s+\S/.test(line));
  assert.ok(firstHeading, "RELEASE_NOTES.md has no heading");
  assert.ok(
    firstHeading.includes(`v${VERSION}`),
    `RELEASE_NOTES.md leads with ${JSON.stringify(firstHeading)}, which does not name v${VERSION}`,
  );
});

test("the dated release log has an entry for this version, and the index links it", () => {
  const index = read("docs", "releases", "README.md");
  const rows = index
    .split(/\r?\n/)
    .filter((line) => /^- \[\d{4}-\d{2}-\d{2}\]\(/.test(line));
  assert.ok(rows.length > 0, "docs/releases/README.md has no index rows");

  const head = rows[0]!;
  assert.ok(head.includes(`v${VERSION}`), `the newest index row does not name v${VERSION}: ${head}`);

  const file = /\((\d{4}-\d{2}-\d{2}\.md)\)/.exec(head)?.[1];
  assert.ok(file, `the newest index row links no dated file: ${head}`);
  const path = join(root, "docs", "releases", file);
  assert.ok(existsSync(path), `docs/releases/${file} is linked from the index but does not exist`);
  assert.ok(
    readFileSync(path, "utf8").includes(`v${VERSION}`),
    `docs/releases/${file} does not name v${VERSION}`,
  );

  // Every row in the index must link a file that exists — a dead link in the
  // release log is how a release becomes unauditable later.
  for (const row of rows) {
    const linked = /\((\d{4}-\d{2}-\d{2}\.md)\)/.exec(row)?.[1];
    assert.ok(linked, `index row links no dated file: ${row}`);
    assert.ok(existsSync(join(root, "docs", "releases", linked)), `missing docs/releases/${linked}`);
  }
});

test("an operator packet exists for this version and binds a commit", () => {
  const path = join(root, "docs", "releases", `OPERATOR-PACKET-v${VERSION}.md`);
  assert.ok(existsSync(path), `no docs/releases/OPERATOR-PACKET-v${VERSION}.md`);
  const packet = readFileSync(path, "utf8");
  assert.ok(packet.includes(`v${VERSION}`), "the operator packet does not name the proposed tag");
  assert.match(packet, /\b[0-9a-f]{40}\b/, "the operator packet names no full commit SHA");
  assert.match(packet, /sha256[:\s]/i, "the operator packet records no tarball digest");
});

// ── Gate B: the package contains what the notes promise ─────────────────────

/**
 * Every claim the current release notes make, mapped to the evidence that would
 * be missing if the claim were false for an installed user.
 *
 * `command` must appear in the CLI registry (so `aether --help` names it);
 * `packaged` paths must all appear in the packed tarball's file list.
 *
 * Adding a headline feature to the notes without adding a row here is the drift
 * this gate cannot catch by itself; the row is the contract.
 */
const FEATURE_MANIFEST: Array<{ claim: string; command?: string; packaged: string[] }> = [
  {
    claim: "portable handoffs — `aether resume export` / `aether agent --resume`",
    command: "resume",
    packaged: ["dist/src/core/handoff.js", "dist/src/commands/resume.js"],
  },
  {
    claim: "agent skills runtime — `aether skills`",
    command: "skills",
    packaged: [
      "dist/src/commands/skills.js",
      "dist/src/core/skills/skill_schema.js",
      "dist/src/core/skills/skill_trust.js",
      "dist/src/core/skills/skill_session.js",
    ],
  },
  {
    claim: "built-in skills ship inside the package, not as a separate download",
    packaged: [
      "dist/src/skills/builtin/review-pr/SKILL.md",
      "dist/src/skills/builtin/fix-ci/SKILL.md",
      "dist/src/skills/builtin/ship/SKILL.md",
    ],
  },
  {
    claim: "capability contract — `aether capabilities`",
    command: "capabilities",
    packaged: ["dist/src/commands/capabilities.js", "dist/src/generated/agent_capabilities.js"],
  },
  {
    claim: "redacted support bundle — `aether support-bundle`",
    command: "support-bundle",
    packaged: ["dist/src/commands/support_bundle.js", "dist/src/core/support_bundle.js"],
  },
  {
    claim: "the offline path ships in the package (`aether agent --local`)",
    packaged: ["dist/src/core/brain_ollama.js", "dist/src/core/ollama.js"],
  },
  {
    claim: "async tool execution with process-tree teardown",
    packaged: ["dist/src/core/tool_executor.js"],
  },
];

test("every CLI command the release notes promise is in the CLI registry", () => {
  const registry = read("src", "commands", "cli_registry.ts");
  for (const feature of FEATURE_MANIFEST) {
    if (!feature.command) continue;
    assert.ok(
      new RegExp(`name:\\s*"${feature.command}"`).test(registry),
      `${feature.claim}: cli_registry.ts declares no "${feature.command}" command`,
    );
  }
});

test(
  "every feature the release notes promise is present in the packed tarball",
  { timeout: 120_000 },
  () => {
    // The source checkout's dist/ is NOT the package: the files allowlist is
    // dist/src plus four docs, so dist/scripts and dist/test exist on disk and
    // ship to nobody. Ask npm what would actually be packed.
    const packed = createPackReport(root);
    const paths = new Set(packed.files.map((file) => file.path.replaceAll("\\", "/")));

    assert.equal(packed.version, VERSION, "npm pack reports a version the manifest does not");
    assert.equal(packed.name, pkg.name);

    const missing: string[] = [];
    for (const feature of FEATURE_MANIFEST) {
      for (const path of feature.packaged) {
        if (!paths.has(path)) missing.push(`${path}  (${feature.claim})`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      `the release notes promise features whose code is not in the tarball:\n  ${missing.join("\n  ")}`,
    );

    // Guard the guard: if npm ever changed the shape of its file list, every
    // lookup above would miss and the assertion would still read as coverage.
    assert.ok(paths.has("package.json"), "the packed file list does not look like a file list");
    assert.ok(paths.size > 50, `only ${paths.size} packed paths — the pack report is not what this gate assumes`);
  },
);

test("release documents never state that this version is installable from npm", () => {
  // This lane cannot prove registry availability, and an unpublished version is
  // unknown, not available — never "supported" or "shipped". Any sentence
  // promising that `npm i -g aether-agents` yields the CURRENT version must not
  // exist until a publish has actually been observed on the registry.
  //
  // The claim is matched against a NORMALIZED document — blockquote markers
  // stripped and whitespace collapsed — because both files wrap prose across
  // lines and inside `>` quotes, so a line-anchored regex would miss the exact
  // sentence it exists to catch. The window after the install command is bounded
  // so the collapsed document cannot make the match vacuously greedy.
  const escaped = VERSION.replaceAll(".", "\\.");
  const claim = new RegExp(
    `npm\\s+i(?:nstall)?\\s+-g\\s+["']?aether-agents.{0,160}?\\b(?:gives you|gives|installs|resolves to|is now|upgrades you to)\\b.{0,40}?${escaped}`,
    "i",
  );
  const normalize = (text: string): string => text.replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ");
  for (const file of ["README.md", "RELEASE_NOTES.md"]) {
    assert.equal(
      claim.test(normalize(read(file))),
      false,
      `${file} claims npm serves ${VERSION} without registry proof`,
    );
  }

  // Guard the guard: the same pattern must fire on a sentence that DOES make the
  // claim, or the four assertions above prove only that the regex is broken.
  assert.equal(
    claim.test(normalize(`> A plain \`npm i -g aether-agents --ignore-scripts\`\n> now installs ${VERSION}.`)),
    true,
    "the availability tripwire does not match a claim it is supposed to catch",
  );
});
