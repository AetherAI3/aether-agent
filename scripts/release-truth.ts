import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_CLI_COMMANDS } from "../src/commands/cli_registry.js";

export const RELEASE_TRUTH_SCHEMA = "aether-agent/release-truth@1" as const;

export interface ReleaseTruthCommand {
  name: string;
  aliases?: readonly string[];
  hidden?: boolean;
}

export interface ReleaseTruthInput {
  files: Readonly<Record<string, string>>;
  scannedTexts: Readonly<Record<string, string>>;
  packedFiles: readonly string[];
  commands: readonly ReleaseTruthCommand[];
}

export interface ReleaseTruthCheck {
  id: string;
  status: "pass" | "fail";
  summary: string;
  remediation: string;
  evidence: string[];
}

export interface ReleaseTruthResult {
  schema: typeof RELEASE_TRUTH_SCHEMA;
  status: "pass" | "fail";
  ok: boolean;
  version: string | null;
  summary: { total: number; passed: number; failed: number };
  checks: ReleaseTruthCheck[];
  humanSummary: string[];
}

const TEXT_EXTENSIONS = new Set([
  "", ".css", ".example", ".html", ".js", ".json", ".lock", ".md", ".mjs", ".ps1", ".sh", ".svg", ".toml",
  ".ts", ".txt", ".yaml", ".yml",
]);
const SKIP_DIRECTORIES = new Set([".git", "dist", "node_modules"]);
const COMMAND_INDEX_START = "<!-- CLI-COMMANDS:START -->";
const COMMAND_INDEX_END = "<!-- CLI-COMMANDS:END -->";
const FORBIDDEN_TERMINAL_URL = ["aethersystems", "net/terminal"].join(".");
const FORBIDDEN_TERMINAL_PATTERN = new RegExp(FORBIDDEN_TERMINAL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");

function parseJson(text: string | undefined): Record<string, unknown> | null {
  if (text === undefined) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function sourceVersion(text: string | undefined): string | null {
  return text?.match(/export\s+const\s+VERSION\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
}

function releaseHeadingVersion(text: string | undefined): string | null {
  const heading = text?.split(/\r?\n/).find((line) => /^#\s+\S/.test(line));
  return heading?.match(/\bv(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)?.[1] ?? null;
}

function canonicalCommandIndex(text: string | undefined): string[] | null {
  if (text === undefined) return null;
  const start = text.indexOf(COMMAND_INDEX_START);
  const end = text.indexOf(COMMAND_INDEX_END);
  if (start < 0 || end <= start) return null;
  return [...text.slice(start + COMMAND_INDEX_START.length, end).matchAll(/`([a-z0-9-]+)`/g)]
    .map((match) => match[1]!)
    .sort();
}

/**
 * Extract only command-shaped examples, not ordinary prose beginning with the
 * product name. Backticks and shell-style lines are deliberate user input and
 * therefore must resolve to a live command or compatibility alias.
 */
export function documentedCommands(markdown: string): string[] {
  const names = new Set<string>();
  for (const match of markdown.matchAll(/`aether\s+([a-z][a-z0-9-]*)\b[^`]*`/gi)) {
    names.add(match[1]!.toLowerCase());
  }
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\s*(?:\$\s*)?aether\s+([a-z][a-z0-9-]*)\b/.exec(line);
    if (match) names.add(match[1]!.toLowerCase());
  }
  return [...names].sort();
}

function check(
  id: string,
  failures: readonly string[],
  success: string,
  remediation: string,
): ReleaseTruthCheck {
  return failures.length === 0
    ? { id, status: "pass", summary: success, remediation, evidence: [] }
    : { id, status: "fail", summary: failures[0]!, remediation, evidence: [...failures] };
}

/** Pure deterministic core for aether-agent/release-truth@1. */
export function evaluateReleaseTruth(input: ReleaseTruthInput): ReleaseTruthResult {
  const manifest = parseJson(input.files["package.json"]);
  const lock = parseJson(input.files["package-lock.json"]);
  const version = typeof manifest?.["version"] === "string" ? manifest["version"] : null;
  const packageName = typeof manifest?.["name"] === "string" ? manifest["name"] : null;
  const lockPackages = lock?.["packages"] !== null && typeof lock?.["packages"] === "object"
    ? lock["packages"] as Record<string, unknown>
    : null;
  const lockRoot = lockPackages?.[""] !== null && typeof lockPackages?.[""] === "object"
    ? lockPackages[""] as Record<string, unknown>
    : null;

  const versionFailures: string[] = [];
  if (!version) versionFailures.push("package.json has no string version");
  if (lock?.["name"] !== packageName) versionFailures.push("package-lock.json root name differs from package.json");
  if (lock?.["version"] !== version) versionFailures.push("package-lock.json root version differs from package.json");
  if (lockRoot?.["version"] !== version) versionFailures.push('package-lock.json packages[""] version differs from package.json');
  const source = sourceVersion(input.files["src/version.ts"]);
  if (source !== version) versionFailures.push(`src/version.ts declares ${String(source)}, expected ${String(version)}`);
  const notes = releaseHeadingVersion(input.files["RELEASE_NOTES.md"]);
  if (notes !== version) versionFailures.push(`RELEASE_NOTES.md leads with ${String(notes)}, expected ${String(version)}`);
  if (version) {
    const packetPath = `docs/releases/OPERATOR-PACKET-v${version}.md`;
    const packet = input.files[packetPath];
    const packetVersion = releaseHeadingVersion(packet);
    if (packetVersion !== version) versionFailures.push(`${packetPath} leads with ${String(packetVersion)}, expected ${version}`);
    if (packet && !new RegExp("\\|\\s*Proposed tag\\s*\\|\\s*`v" + version.replaceAll(".", "\\.") + "`").test(packet)) {
      versionFailures.push(`${packetPath} does not bind proposed tag v${version}`);
    }
  }

  const packed = new Set(input.packedFiles.map((path) => path.replaceAll("\\", "/").replace(/^\.\//, "")));
  const publicPackageFailures = ["README.md", "COMMANDS.md"]
    .filter((path) => input.files[path] === undefined || !packed.has(path))
    .map((path) => `${path} must exist in the repository and packed package`);

  const visibleNames = input.commands.filter((command) => !command.hidden).map((command) => command.name).sort();
  const indexNames = canonicalCommandIndex(input.files["COMMANDS.md"]);
  const commandIndexFailures: string[] = [];
  if (indexNames === null) {
    commandIndexFailures.push("COMMANDS.md is missing the canonical CLI command index markers");
  } else {
    const missing = visibleNames.filter((name) => !indexNames.includes(name));
    const removed = indexNames.filter((name) => !visibleNames.includes(name));
    if (missing.length) commandIndexFailures.push(`COMMANDS.md omits shipped commands: ${missing.join(", ")}`);
    if (removed.length) commandIndexFailures.push(`COMMANDS.md documents removed or nonexistent commands: ${removed.join(", ")}`);
  }

  const acceptedNames = new Set<string>();
  for (const command of input.commands) {
    acceptedNames.add(command.name);
    for (const alias of command.aliases ?? []) acceptedNames.add(alias);
  }
  const exampleFailures: string[] = [];
  for (const path of ["README.md", "RELEASE_NOTES.md"] as const) {
    const text = input.files[path];
    if (text === undefined) {
      exampleFailures.push(`${path} is missing`);
      continue;
    }
    const removed = documentedCommands(text).filter((name) => !acceptedNames.has(name));
    if (removed.length) exampleFailures.push(`${path} contains removed or nonexistent command examples: ${removed.join(", ")}`);
  }

  const forbiddenFailures = Object.entries(input.scannedTexts)
    .filter(([, text]) => FORBIDDEN_TERMINAL_PATTERN.test(text))
    .map(([path]) => `${path} contains the forbidden Aether Terminal URL`)
    .sort();

  const checks = [
    check(
      "version.agreement",
      versionFailures,
      "manifest, lockfile, source, release notes, and operator packet agree",
      "Set one release version, update both lockfile version fields and src/version.ts, then make that version the leading release note and operator packet.",
    ),
    check(
      "package.public-docs",
      publicPackageFailures,
      "required public documents exist in the packed package",
      "Keep README.md and COMMANDS.md in package.json files and verify their presence with npm pack --dry-run --json.",
    ),
    check(
      "commands.canonical-index",
      commandIndexFailures,
      "the canonical command index exactly matches the visible registry",
      "Regenerate the COMMANDS.md canonical CLI index from the command registry; do not hand-add removed commands.",
    ),
    check(
      "commands.public-examples",
      exampleFailures,
      "public command examples resolve to a live command or compatibility alias",
      "Replace the stale example with a registered command, or add the intended command through the canonical registry and its tests.",
    ),
    check(
      "links.no-aether-terminal",
      forbiddenFailures,
      "the forbidden Aether Terminal URL is absent from repository text",
      `Remove every ${FORBIDDEN_TERMINAL_URL} reference; ATS/Aether Terminal is not part of Aether Agent.`,
    ),
  ];
  const failed = checks.filter((item) => item.status === "fail").length;
  const result: ReleaseTruthResult = {
    schema: RELEASE_TRUTH_SCHEMA,
    status: failed === 0 ? "pass" : "fail",
    ok: failed === 0,
    version,
    summary: { total: checks.length, passed: checks.length - failed, failed },
    checks,
    humanSummary: [],
  };
  result.humanSummary = renderReleaseTruthSummary(result);
  return result;
}

export function renderReleaseTruthSummary(result: ReleaseTruthResult): string[] {
  const lines = [
    `${result.ok ? "PASS" : "FAIL"} ${result.schema}: ${result.summary.passed}/${result.summary.total} checks passed`,
  ];
  for (const item of result.checks.filter((candidate) => candidate.status === "fail")) {
    lines.push(`[${item.id}] ${item.summary}`);
    for (const evidence of item.evidence) lines.push(`  - ${evidence}`);
    lines.push(`  remediation: ${item.remediation}`);
  }
  return lines;
}

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

function collectRepositoryTexts(root: string, directory = root, output: Record<string, string> = {}): Record<string, string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) collectRepositoryTexts(root, join(directory, entry.name), output);
      continue;
    }
    if (!entry.isFile()) continue;
    const path = join(directory, entry.name);
    const repoPath = relative(root, path).replaceAll("\\", "/");
    if (TEXT_EXTENSIONS.has(extension(repoPath))) output[repoPath] = readFileSync(path, "utf8");
  }
  return output;
}

export function collectReleaseTruthInput(
  root: string,
  packedFiles: readonly string[],
  commands: readonly ReleaseTruthCommand[] = ALL_CLI_COMMANDS,
): ReleaseTruthInput {
  const scannedTexts = collectRepositoryTexts(root);
  const files: Record<string, string> = {};
  for (const path of ["package.json", "package-lock.json", "src/version.ts", "README.md", "COMMANDS.md", "RELEASE_NOTES.md"]) {
    const value = scannedTexts[path];
    if (value !== undefined) files[path] = value;
  }
  const manifest = parseJson(files["package.json"]);
  const version = typeof manifest?.["version"] === "string" ? manifest["version"] : null;
  if (version) {
    const packet = `docs/releases/OPERATOR-PACKET-v${version}.md`;
    const value = scannedTexts[packet];
    if (value !== undefined) files[packet] = value;
  }
  return { files, scannedTexts, packedFiles, commands };
}

export function releaseTruthFromRepository(
  root: string,
  packedFiles: readonly string[],
  commands: readonly ReleaseTruthCommand[] = ALL_CLI_COMMANDS,
): ReleaseTruthResult {
  return evaluateReleaseTruth(collectReleaseTruthInput(root, packedFiles, commands));
}

async function main(): Promise<void> {
  const { createPackReport } = await import("./verify-production.js");
  const root = process.cwd();
  const packedFiles = createPackReport(root).files.map((file) => file.path);
  const result = releaseTruthFromRepository(root, packedFiles);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.stderr.write(`${result.humanSummary.join("\n")}\n`);
  if (!result.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) void main();
