import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RELEASE_TRUTH_SCHEMA,
  documentedCommands,
  evaluateReleaseTruth,
  type ReleaseTruthInput,
} from "../scripts/release-truth.js";

const commands = [
  { name: "agent", aliases: ["code"] },
  { name: "doctor" },
  { name: "skills" },
  { name: "login", hidden: true },
] as const;

function validInput(): ReleaseTruthInput {
  const packet = [
    "# Operator packet — Aether Agent v0.3.0",
    "",
    "| Proposed tag | `v0.3.0` |",
  ].join("\n");
  const commandsDoc = [
    "# Commands",
    "<!-- CLI-COMMANDS:START -->",
    "`agent` `doctor` `skills`",
    "<!-- CLI-COMMANDS:END -->",
  ].join("\n");
  const files = {
    "package.json": JSON.stringify({ name: "aether-agents", version: "0.3.0" }),
    "package-lock.json": JSON.stringify({
      name: "aether-agents",
      version: "0.3.0",
      packages: { "": { name: "aether-agents", version: "0.3.0" } },
    }),
    "src/version.ts": 'export const VERSION = "0.3.0";\n',
    "README.md": "Run `aether doctor`, `aether skills list`, or the `aether code` compatibility alias.\n",
    "COMMANDS.md": commandsDoc,
    "RELEASE_NOTES.md": "# Aether Agent v0.3.0 — release truth\n\nUse `aether agent`.\n",
    "docs/releases/OPERATOR-PACKET-v0.3.0.md": packet,
  };
  return {
    files,
    scannedTexts: { ...files, "src/example.ts": "export const safe = true;\n" },
    packedFiles: ["package.json", "README.md", "COMMANDS.md", "dist/src/main.js"],
    commands,
  };
}

test("release-truth@1 emits a stable machine-readable passing result", () => {
  const result = evaluateReleaseTruth(validInput());
  assert.equal(result.schema, RELEASE_TRUTH_SCHEMA);
  assert.equal(result.status, "pass");
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, { total: 5, passed: 5, failed: 0 });
  assert.match(JSON.stringify(result), /aether-agent\/release-truth@1/);
  assert.match(result.humanSummary[0]!, /^PASS/);
});

test("version disagreement fails with exact evidence and remediation", () => {
  const input = validInput();
  input.files = { ...input.files, "src/version.ts": 'export const VERSION = "0.2.0";\n' };
  const result = evaluateReleaseTruth(input);
  const finding = result.checks.find((item) => item.id === "version.agreement");
  assert.equal(result.ok, false);
  assert.equal(finding?.status, "fail");
  assert.match(finding?.evidence.join("\n") ?? "", /src\/version\.ts declares 0\.2\.0/);
  assert.match(finding?.remediation ?? "", /update both lockfile version fields/);
  assert.match(result.humanSummary.join("\n"), /remediation:/);
});

test("required public docs must exist in the actual packed file list", () => {
  const input = validInput();
  input.packedFiles = input.packedFiles.filter((path) => path !== "COMMANDS.md");
  const result = evaluateReleaseTruth(input);
  const finding = result.checks.find((item) => item.id === "package.public-docs");
  assert.equal(finding?.status, "fail");
  assert.deepEqual(finding?.evidence, ["COMMANDS.md must exist in the repository and packed package"]);
});

test("canonical docs reject removed commands and require every visible command", () => {
  const input = validInput();
  input.files = {
    ...input.files,
    "COMMANDS.md": [
      "<!-- CLI-COMMANDS:START -->",
      "`agent` `doctor` `removed-command`",
      "<!-- CLI-COMMANDS:END -->",
    ].join("\n"),
  };
  const finding = evaluateReleaseTruth(input).checks.find((item) => item.id === "commands.canonical-index");
  assert.equal(finding?.status, "fail");
  assert.match(finding?.evidence.join("\n") ?? "", /omits shipped commands: skills/);
  assert.match(finding?.evidence.join("\n") ?? "", /removed or nonexistent commands: removed-command/);
});

test("public examples accept aliases but reject nonexistent commands", () => {
  const input = validInput();
  input.files = { ...input.files, "README.md": "Use `aether code` or `aether teleport`.\n" };
  const finding = evaluateReleaseTruth(input).checks.find((item) => item.id === "commands.public-examples");
  assert.equal(finding?.status, "fail");
  assert.deepEqual(finding?.evidence, ["README.md contains removed or nonexistent command examples: teleport"]);
  assert.deepEqual(documentedCommands("Aether Agent is a product. `aether doctor --live` works."), ["doctor"]);
});

test("the repository-wide Aether Terminal regression guard is case-insensitive", () => {
  const input = validInput();
  input.scannedTexts = {
    ...input.scannedTexts,
    "docs/stale.md": "Visit HTTPS://" + ["AETHERSYSTEMS", "NET/TERMINAL"].join(".") + " today.",
  };
  const finding = evaluateReleaseTruth(input).checks.find((item) => item.id === "links.no-aether-terminal");
  assert.equal(finding?.status, "fail");
  assert.deepEqual(finding?.evidence, ["docs/stale.md contains the forbidden Aether Terminal URL"]);
  assert.match(finding?.remediation ?? "", /ATS\/Aether Terminal is not part/);
});
