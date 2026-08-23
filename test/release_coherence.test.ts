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
import { ALL_CLI_COMMANDS } from "../src/commands/cli_registry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]): string => readFileSync(join(root, ...parts), "utf8");

const pkg = JSON.parse(read("package.json")) as { name: string; version: string };
const VERSION = pkg.version;
let cachedPackReport: ReturnType<typeof createPackReport> | undefined;

function currentPackReport(): ReturnType<typeof createPackReport> {
  cachedPackReport ??= createPackReport(root);
  return cachedPackReport;
}

function packetNumber(packet: string, pattern: RegExp, label: string): number {
  const value = pattern.exec(packet)?.[1];
  assert.ok(value, `the operator packet does not record ${label}`);
  return Number.parseInt(value.replaceAll(",", ""), 10);
}

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

test(
  "the operator packet's current package measurements match npm pack",
  { timeout: 120_000 },
  () => {
    const packet = read("docs", "releases", `OPERATOR-PACKET-v${VERSION}.md`);
    const packed = currentPackReport();
    const headerEntries = packetNumber(packet, /\| Packed entries \| ([\d,]+) \|/, "the header entry count");
    const headerPackedBytes = packetNumber(
      packet,
      /\| Tarball size \| ([\d,]+) bytes packed \/ [\d,]+ unpacked \|/,
      "the header packed byte count",
    );
    const headerBytes = packetNumber(
      packet,
      /\| Tarball size \| [\d,]+ bytes packed \/ ([\d,]+) unpacked \|/,
      "the header unpacked byte count",
    );
    const manifest = /### Packaged file manifest\s+([\d,]+) entries, ([\d,]+) bytes unpacked\./.exec(packet);
    assert.ok(manifest, "the operator packet has no parseable packaged-file manifest summary");
    const manifestEntries = Number.parseInt(manifest[1]!.replaceAll(",", ""), 10);
    const manifestBytes = Number.parseInt(manifest[2]!.replaceAll(",", ""), 10);

    assert.deepEqual(
      { headerEntries, headerPackedBytes, headerBytes, manifestEntries, manifestBytes },
      {
        headerEntries: packed.entryCount,
        headerPackedBytes: packed.size,
        headerBytes: packed.unpackedSize,
        manifestEntries: packed.entryCount,
        manifestBytes: packed.unpackedSize,
      },
      "the operator packet mixes package measurements from different release bases",
    );
  },
);

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
    claim: "the review → commit → pull request rail — `aether review`",
    command: "review",
    packaged: [
      "dist/src/commands/review.js",
      "dist/src/core/review_state.js",
      "dist/src/core/review_actions.js",
      "dist/src/core/verification_record.js",
      "dist/src/core/diff_counts.js",
    ],
  },
  {
    claim: "publishing the head branch and opening the pull request — `aether ship`",
    command: "ship",
    packaged: [
      "dist/src/commands/ship.js",
      "dist/src/core/publish.js",
      "dist/src/core/ship_record.js",
    ],
  },
  {
    claim: "the project session library — `aether sessions`",
    command: "sessions",
    packaged: [
      "dist/src/commands/sessions.js",
      "dist/src/core/session_index.js",
      "dist/src/ui/continuity.js",
    ],
  },
  {
    claim: "skills and AGENTS.md are composed into real runs, and their policy is enforced",
    packaged: ["dist/src/core/skills/run_session.js"],
  },
  {
    claim: "win32 URLs open through rundll32, so the device-approval page appears",
    packaged: ["dist/src/core/opener.js"],
  },
  {
    claim: "the token store refuses planted links and writes atomically",
    packaged: ["dist/src/core/auth.js"],
  },
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
  // Read the registry STRUCTURALLY, by importing it, not by regex over its
  // source. #98 replaced "reachability asserted by a regex over main.ts" with a
  // real dispatch table for exactly this reason, and it immediately split the
  // commands across two arrays — CLI_COMMANDS and DISPATCH_COMMANDS — which a
  // source regex keyed on one of them would have silently stopped covering.
  const registered = new Set(ALL_CLI_COMMANDS.map((command) => command.name));
  for (const feature of FEATURE_MANIFEST) {
    if (!feature.command) continue;
    assert.ok(
      registered.has(feature.command),
      `${feature.claim}: the CLI registry declares no "${feature.command}" command`,
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
    const packed = currentPackReport();
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

// ── Gate C: the package promises nothing the notes are silent about ─────────
//
// Gate B runs notes -> package: a claim with no code behind it fails. That is
// only one direction, and it is not the direction that actually keeps happening.
//
// The other direction is a user-visible command that ships with NO claim
// anywhere in the notes. It happened while this very lane's PR was open: #98
// landed on main after the v0.3.0 notes were written, and the notes said nothing
// about it. It will happen again for every lane that lands between the note
// being written and the tag being cut. A release that silently ships a command
// nobody announced is the same defect as a note that promises one nobody built,
// arriving from the side nothing was watching.
//
// The rule: every user-visible command is either announced by SOME release note,
// or named here with a reason. An explicit list is fine. Silence is not.

/**
 * Commands that ship without a release note, each with the reason it is
 * acceptable. Entries are enforced in both directions — a stale entry fails,
 * and an entry that IS announced fails — so this cannot rot into a permanent
 * bypass that quietly absorbs the next unannounced command.
 *
 * Every entry must also be named in the operator packet, so the founder cutting
 * the tag reads the full unannounced set before creating it.
 */
const SHIPPED_WITHOUT_A_NOTE: Record<string, string> = {
  help: "predates the release log; the CLI has never shipped without it",
  chat: "predates the release log",
  run: "predates the release log",
  agents: "predates the release log",
  github: "predates the release log",
  vault: "the June 2026 entry announces the vault surface, not the command token",
  workflow: "the June 2026 entry announces workflows, not the command token",
  memory: "the June 2026 entry announces the memory bridge, not the command token",
  image: "the June 2026 entry announces media generation, not the command token",
  video: "the June 2026 entry announces media generation, not the command token",
  output: "the 2026-08-14 entry announces the durable media output history, not the command token",
  audit: "the June 2026 entry announces the audit trail, not the command token",
  receipt: "the June 2026 entry announces audit receipts, not the command token",
  mcp: "the June 2026 entry announces the MCP manager, not the command token",
  config: "predates the release log",
};

/**
 * A command is announced only where the notes name the form a user actually
 * types: `aether <name>`.
 *
 * This used to also accept the name inside bare backticks, and that made the
 * gate vacuous in exactly the case it was built for. When #102 landed
 * `aether review` and `aether ship`, both were already "announced" — because
 * the notes mention the built-in SKILLS named `review-pr` and `ship`. A gate
 * that reports coverage it does not have is worse than no gate, so the bare
 * backtick form is gone: a skill, a flag, or a hyphenated neighbour that merely
 * contains the command's letters no longer speaks for the command.
 */
function announcedInNotes(notes: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("aether " + escaped + "\\b").test(notes);
}

test("no user-visible command ships without either a release note or a named exemption", () => {
  const notes = read("RELEASE_NOTES.md");

  // Hidden commands are exempt by rule: `login` and `logout` are legacy
  // shortcuts deliberately kept out of `aether --help`, so there is no surface
  // to announce. The exemption is narrow — it follows the registry's own
  // `hidden` flag, not a list somebody maintains here.
  const visible = ALL_CLI_COMMANDS.filter((command) => !command.hidden);
  assert.ok(visible.length > 0, "the registry exposes no visible commands — this gate is not reading it");

  const unannounced = visible
    .filter((command) => !announcedInNotes(notes, command.name))
    .filter((command) => !(command.name in SHIPPED_WITHOUT_A_NOTE))
    .map((command) => `${command.name} — ${command.summary}`);

  assert.deepEqual(
    unannounced,
    [],
    "these commands ship to users with no claim in RELEASE_NOTES.md and no named exemption:\n  " +
      `${unannounced.join("\n  ")}\n` +
      "Announce them in the current release entry, or add them to SHIPPED_WITHOUT_A_NOTE with a reason.",
  );
});

test("the announcement matcher does not accept a lookalike as an announcement", () => {
  // Guard the guard. Every assertion in this section is only as good as this
  // function, and its previous form said yes to all three of these.
  assert.equal(announcedInNotes("the built-in `review-pr` skill", "review"), false);
  assert.equal(announcedInNotes("six ship built in: `ship`, `fix-ci`", "ship"), false);
  assert.equal(announcedInNotes("pass `--skills` to narrow the run", "skills"), false);
  // ...and still says yes to a real announcement.
  assert.equal(announcedInNotes("run `aether review --files x` to pick", "review"), true);
  assert.equal(announcedInNotes("aether ship publishes HEAD", "ship"), true);
});

test("the unannounced-command list cannot rot into a permanent bypass", () => {
  const notes = read("RELEASE_NOTES.md");
  const registered = new Map(ALL_CLI_COMMANDS.map((command) => [command.name, command]));

  for (const [name, reason] of Object.entries(SHIPPED_WITHOUT_A_NOTE)) {
    // A stale entry is worse than no entry: it holds an exemption open for a
    // command that no longer exists, and the next command to take that name
    // inherits the silence.
    assert.ok(registered.has(name), `SHIPPED_WITHOUT_A_NOTE names "${name}", which is not a registered command`);
    assert.equal(registered.get(name)?.hidden ?? false, false, `"${name}" is hidden and needs no exemption`);
    assert.ok(reason.trim().length > 10, `"${name}" is exempted without a real reason`);
    assert.equal(
      announcedInNotes(notes, name),
      false,
      `"${name}" IS announced in RELEASE_NOTES.md — remove it from SHIPPED_WITHOUT_A_NOTE ` +
        "so the list keeps meaning what it says",
    );
  }
});

test("the operator packet names every command that ships unannounced", () => {
  // The founder creating the tag is the person who needs to know what goes out
  // without a note. Keeping the list only in a test file would tell the release
  // engineer and nobody else.
  const packet = read("docs", "releases", `OPERATOR-PACKET-v${VERSION}.md`);
  const missing = Object.keys(SHIPPED_WITHOUT_A_NOTE).filter(
    (name) => !new RegExp("`aether " + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "`").test(packet),
  );
  assert.deepEqual(missing, [], `the operator packet does not name these unannounced commands: ${missing.join(", ")}`);
});

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
