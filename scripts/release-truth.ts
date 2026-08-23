import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_MANIFEST } from "../src/commands/command_manifest.js";

export const RELEASE_TRUTH_SCHEMA = "aether-agent/release-truth@1" as const;
export type Evidence<T> = { state: "available"; value: T } | { state: "unavailable" | "not_applicable"; reason: string };
export interface ReleaseTruthCommand {
  name: string;
  aliases?: readonly string[];
  hidden?: boolean;
  release?: { disposition: "existing" | "new" | "changed" | "deprecated" | "internal"; note: string | null };
}
export interface ScanSkip { path: string; reason: "binary" | "undecodable" | "oversized" | "budget" | "non_regular" | "excluded_directory"; detail: string }
export interface CapabilityDisposition { id: string; shipped: boolean; documented: boolean; releaseDisposition: "announced" | "exempt" | "removed" | null }
export interface GeneratedDocDigest { id: string; manifestDigest: string; documentDigest: string }
export interface CatalogueTruth { catalogueDigest: string; renderedDigest: string; generatedAt: string; observedAt: string; maxAgeMs: number }
export interface PackedClaim { id: string; advertised: boolean; registryInstalled: boolean; sourceOnly: boolean; requiredPaths: readonly string[] }
export interface RegistryTruth { sourceVersion: string; publishedVersions: readonly string[]; latest: string | null; publicClaim: { sourceAvailability: "published" | "unpublished"; latest: string | null } }
export interface ReleaseTruthEvidence {
  capabilities?: Evidence<readonly CapabilityDisposition[]>;
  generatedDocs?: Evidence<readonly GeneratedDocDigest[]>;
  catalogue?: Evidence<CatalogueTruth>;
  packedClaims?: Evidence<readonly PackedClaim[]>;
  registry?: Evidence<RegistryTruth>;
}
export interface ReleaseTruthInput extends ReleaseTruthEvidence {
  files: Readonly<Record<string, string>>;
  scannedTexts: Readonly<Record<string, string>>;
  scanSkips?: readonly ScanSkip[];
  packedFiles: readonly string[];
  commands: readonly ReleaseTruthCommand[];
  slashCommands?: readonly ReleaseTruthCommand[];
}
export type CheckStatus = "pass" | "fail" | "unavailable" | "not_applicable";
export interface ReleaseTruthCheck { id: string; status: CheckStatus; summary: string; remediation: string; evidence: string[] }
export interface ReleaseTruthResult {
  schema: typeof RELEASE_TRUTH_SCHEMA;
  status: "pass" | "fail" | "unavailable";
  ok: boolean;
  version: string | null;
  summary: { total: number; passed: number; failed: number; unavailable: number; notApplicable: number };
  checks: ReleaseTruthCheck[];
  humanSummary: string[];
}

const EXCLUDED_DIRECTORIES = new Set([".git", ".aether-output", "coverage", "dist", "node_modules"]);
const CLI_MARKERS = ["<!-- CLI-COMMANDS:START -->", "<!-- CLI-COMMANDS:END -->"] as const;
const SLASH_MARKERS = ["<!-- SLASH-COMMANDS:START -->", "<!-- SLASH-COMMANDS:END -->"] as const;
const FORBIDDEN_URL = ["aethersystems", "net/terminal"].join(".");
const FORBIDDEN_PATTERN = new RegExp(FORBIDDEN_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
const VALUE_FLAGS = new Set(["--model", "--agent", "--cwd", "--token", "--username", "--password", "--license-key", "--pool", "--effort", "--test-cmd", "--repo", "--swarm", "--resume", "--out", "--skill", "--junit", "--scope"]);

function parseJson(text: string | undefined): Record<string, unknown> | null {
  if (text === undefined) return null;
  try { const value = JSON.parse(text) as unknown; return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
  catch { return null; }
}
const headingVersion = (text: string | undefined): string | null => text?.split(/\r?\n/).find((line) => /^#\s+\S/.test(line))?.match(/\bv(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)?.[1] ?? null;
const sourceVersion = (text: string | undefined): string | null => text?.match(/export\s+const\s+VERSION\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
function check(id: string, failures: readonly string[], success: string, remediation: string): ReleaseTruthCheck {
  return failures.length ? { id, status: "fail", summary: failures[0]!, remediation, evidence: [...failures] } : { id, status: "pass", summary: success, remediation, evidence: [] };
}
function evidenceCheck<T>(id: string, source: Evidence<T> | undefined, inspect: (value: T) => string[], success: string, remediation: string, absent: "unavailable" | "not_applicable" = "unavailable"): ReleaseTruthCheck {
  const evidence = source ?? { state: absent, reason: "no evidence was supplied" };
  if (evidence.state !== "available") return { id, status: evidence.state, summary: evidence.reason, remediation, evidence: [evidence.reason] };
  return check(id, inspect(evidence.value), success, remediation);
}
function indexNames(text: string | undefined, markers: readonly [string, string]): string[] | null {
  if (text === undefined) return null;
  const start = text.indexOf(markers[0]); const end = text.indexOf(markers[1]);
  if (start < 0 || end <= start) return null;
  return [...text.slice(start + markers[0].length, end).matchAll(/`([a-z0-9-]+)`/g)].map((match) => match[1]!);
}
function indexFailures(label: string, indexed: string[] | null, registry: readonly ReleaseTruthCommand[]): string[] {
  if (indexed === null) return [`COMMANDS.md is missing the canonical ${label} index markers`];
  const failures: string[] = [];
  const duplicates = [...new Set(indexed.filter((name, at) => indexed.indexOf(name) !== at))].sort();
  if (duplicates.length) failures.push(`${label} index contains duplicate entries: ${duplicates.join(", ")}`);
  const visible = registry.filter((item) => !item.hidden).map((item) => item.name).sort(); const unique = [...new Set(indexed)].sort();
  const missing = visible.filter((name) => !unique.includes(name)); const removed = unique.filter((name) => !visible.includes(name));
  if (missing.length) failures.push(`${label} index omits shipped commands: ${missing.join(", ")}`);
  if (removed.length) failures.push(`${label} index documents removed or nonexistent commands: ${removed.join(", ")}`);
  return failures;
}

function invocationCommand(value: string): string | null {
  const words: string[] = [...(value.replace(/^\s*(?:\$|>)\s*/, "").match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g) ?? [])];
  const at = words.indexOf("aether");
  if (at < 0 || words.slice(0, at).some((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))) return null;
  for (let index = at + 1; index < words.length; index += 1) {
    const word = words[index]!;
    if (VALUE_FLAGS.has(word)) { index += 1; continue; }
    if (word.startsWith("-")) continue;
    return /^[a-z][a-z0-9-]*$/.test(word) ? word : null;
  }
  return null;
}
export function documentedCommands(markdown: string): string[] {
  const found = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    if (/\bnear-miss token is treated as a typo\b/i.test(line)) continue;
    const fragments = [...line.matchAll(/`([^`\r\n]+)`/g)].map((match) => match[1]!);
    if (/^\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S+)\s+)*(?:\$\s*)?aether\b/.test(line)) fragments.push(line);
    for (const fragment of fragments) { const name = invocationCommand(fragment); if (name) found.add(name); }
  }
  return [...found].sort();
}
export function documentedSlashCommands(markdown: string): string[] {
  const found = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*Typos get a nudge:/i.test(line)) continue;
    const fragments = [...line.matchAll(/`([^`\r\n]+)`/g)].map((match) => match[1]!);
    if (/^\s*\/[a-z]/.test(line)) fragments.push(line.trim());
    for (const fragment of fragments) {
      const match = /^\/([a-z][a-z0-9-]*)(?:\s|$)/.exec(fragment.trim());
      if (match) found.add(match[1]!);
    }
  }
  return [...found].sort();
}

export function evaluateReleaseTruth(input: ReleaseTruthInput): ReleaseTruthResult {
  const manifest = parseJson(input.files["package.json"]); const lock = parseJson(input.files["package-lock.json"]);
  const version = typeof manifest?.["version"] === "string" ? manifest["version"] : null; const name = manifest?.["name"];
  const packages = lock?.["packages"] !== null && typeof lock?.["packages"] === "object" ? lock["packages"] as Record<string, unknown> : null;
  const lockRoot = packages?.[""] !== null && typeof packages?.[""] === "object" ? packages[""] as Record<string, unknown> : null;
  const versions: string[] = [];
  if (!version) versions.push("package.json has no string version");
  if (lock?.["name"] !== name) versions.push("package-lock.json root name differs from package.json");
  if (lock?.["version"] !== version) versions.push("package-lock.json root version differs from package.json");
  if (lockRoot?.["version"] !== version) versions.push('package-lock.json packages[""] version differs from package.json');
  if (sourceVersion(input.files["src/version.ts"]) !== version) versions.push("src/version.ts differs from package.json");
  if (headingVersion(input.files["RELEASE_NOTES.md"]) !== version) versions.push(`RELEASE_NOTES.md does not lead with v${String(version)}`);
  if (version) {
    const packetPath = `docs/releases/OPERATOR-PACKET-v${version}.md`; const packet = input.files[packetPath];
    if (headingVersion(packet) !== version) versions.push(`${packetPath} does not lead with v${version}`);
    if (packet && !new RegExp("\\|\\s*Proposed tag\\s*\\|\\s*`v" + version.replaceAll(".", "\\.") + "`").test(packet)) versions.push(`${packetPath} does not bind proposed tag v${version}`);
  }
  const packed = new Set(input.packedFiles.map((path) => path.replaceAll("\\", "/").replace(/^\.\//, "")));
  const publicDocs = ["README.md", "COMMANDS.md"].filter((path) => input.files[path] === undefined || !packed.has(path)).map((path) => `${path} must exist in the repository and packed package`);
  const slash = input.slashCommands ?? [];
  const indexes = [...indexFailures("CLI", indexNames(input.files["COMMANDS.md"], CLI_MARKERS), input.commands), ...(slash.length ? indexFailures("slash", indexNames(input.files["COMMANDS.md"], SLASH_MARKERS), slash) : [])];
  const acceptedCli = new Set(input.commands.flatMap((item) => [item.name, ...(item.aliases ?? [])])); const acceptedSlash = new Set(slash.flatMap((item) => [item.name, ...(item.aliases ?? [])]));
  const examples: string[] = [];
  for (const path of ["README.md", "COMMANDS.md", "RELEASE_NOTES.md"] as const) {
    const text = input.files[path]; if (text === undefined) { examples.push(`${path} is missing`); continue; }
    const badCli = documentedCommands(text).filter((item) => !acceptedCli.has(item)); const badSlash = slash.length ? documentedSlashCommands(text).filter((item) => !acceptedSlash.has(item)) : [];
    if (badCli.length) examples.push(`${path} contains removed or nonexistent command examples: ${badCli.join(", ")}`);
    if (badSlash.length) examples.push(`${path} contains removed or nonexistent slash-command examples: ${badSlash.join(", ")}`);
  }
  const commandDispositions = [...input.commands, ...slash].flatMap((item) => {
    if (!item.release) return [`${item.name} has no release disposition`];
    if (["new", "changed", "deprecated"].includes(item.release.disposition) && !item.release.note?.trim()) {
      return [`${item.name} is ${item.release.disposition} without a release-note disposition`];
    }
    return [];
  });
  const forbidden = Object.entries(input.scannedTexts).filter(([, text]) => FORBIDDEN_PATTERN.test(text)).map(([path]) => `${path} contains the retired product URL`).sort();
  const skips = input.scanSkips ?? []; const partial = skips.filter((item) => item.reason === "oversized" || item.reason === "budget");
  const scanCheck: ReleaseTruthCheck = partial.length ? { id: "scan.coverage", status: "unavailable", summary: "repository scan reached a safety bound", remediation: "Reduce oversized text artifacts or raise the reviewed bound; never treat a partial scan as green.", evidence: skips.map((item) => `${item.path}: ${item.reason} (${item.detail})`) } : { id: "scan.coverage", status: "pass", summary: "all bounded repository text was inspected", remediation: "Inspect skipped-file evidence when adding binary formats.", evidence: skips.map((item) => `${item.path}: ${item.reason} (${item.detail})`) };
  const checks: ReleaseTruthCheck[] = [
    check("version.agreement", versions, "all release version sources agree", "Align the manifest, both lock fields, src/version.ts, leading release note, and operator packet."),
    check("package.public-docs", publicDocs, "required public documents exist in the packed package", "Keep README.md and COMMANDS.md in package.json files and npm pack output."),
    check("commands.canonical-index", indexes, "CLI and slash indexes exactly match visible registries", "Regenerate both canonical indexes and remove duplicate entries."),
    check("commands.public-examples", examples, "public CLI and slash examples resolve", "Replace stale examples or register and release-disposition the intended command."),
    check("commands.release-disposition", commandDispositions, "every shipped command has a release disposition", "Populate command manifest release metadata; new, changed, and deprecated commands require a non-empty note."),
    check("links.no-aether-terminal", forbidden, "the retired product URL is absent", `Remove every ${FORBIDDEN_URL} reference; that product is outside Aether Agent.`),
    scanCheck,
    evidenceCheck("capabilities.release-disposition", input.capabilities, (items) => items.filter((item) => item.shipped && (!item.documented || !["announced", "exempt"].includes(item.releaseDisposition ?? ""))).map((item) => `${item.id} ships without documentation and release disposition`), "capabilities have documentation and release dispositions", "Generate evidence from the capability manifest and release notes."),
    evidenceCheck("generated-docs.digest", input.generatedDocs, (items) => items.filter((item) => !item.manifestDigest || item.manifestDigest !== item.documentDigest).map((item) => `${item.id} generated digest differs from its manifest`), "generated command/model docs match manifests", "Regenerate documents from canonical manifests."),
    evidenceCheck("catalogue.digest-freshness", input.catalogue, (item) => { const failures: string[] = []; if (!item.catalogueDigest || item.catalogueDigest !== item.renderedDigest) failures.push("catalogue rendered digest differs from canonical digest"); const generated = Date.parse(item.generatedAt); const observed = Date.parse(item.observedAt); if (!Number.isFinite(generated) || !Number.isFinite(observed)) failures.push("catalogue timestamps are invalid"); else if (observed - generated > item.maxAgeMs) failures.push("catalogue snapshot is stale"); return failures; }, "catalogue digest and freshness are valid", "Refresh authoritative catalogue data and regenerate outputs."),
    evidenceCheck("package.claim-inventory", input.packedClaims, (claims) => claims.flatMap((claim) => { const failures = claim.advertised ? claim.requiredPaths.filter((path) => !packed.has(path)).map((path) => `${claim.id} is advertised but ${path} is absent`) : []; if (claim.sourceOnly && claim.registryInstalled) failures.push(`${claim.id} is source-only but advertised as registry-installed`); return failures; }), "packed contents satisfy advertised claims", "Package required implementation or correct the claim inventory."),
    evidenceCheck("registry.source-truth", input.registry, (item) => { const failures: string[] = []; const published = item.publishedVersions.includes(item.sourceVersion); if (item.sourceVersion !== version) failures.push("registry evidence source version differs from package"); if ((item.publicClaim.sourceAvailability === "published") !== published) failures.push("public source availability differs from registry evidence"); if (item.publicClaim.latest !== item.latest) failures.push("public latest claim differs from registry dist-tag"); return failures; }, "source and registry claims match observed dist-tags", "Run the npm host probe; network failure must remain unavailable.", "unavailable"),
  ];
  return resultFromChecks(version, checks);
}

function resultFromChecks(version: string | null, checks: ReleaseTruthCheck[]): ReleaseTruthResult {
  const failed = checks.filter((item) => item.status === "fail").length; const unavailable = checks.filter((item) => item.status === "unavailable").length; const notApplicable = checks.filter((item) => item.status === "not_applicable").length; const passed = checks.filter((item) => item.status === "pass").length;
  const result: ReleaseTruthResult = { schema: RELEASE_TRUTH_SCHEMA, status: failed ? "fail" : unavailable ? "unavailable" : "pass", ok: failed === 0 && unavailable === 0, version, summary: { total: checks.length, passed, failed, unavailable, notApplicable }, checks, humanSummary: [] };
  result.humanSummary = renderReleaseTruthSummary(result); return result;
}
export function renderReleaseTruthSummary(result: ReleaseTruthResult): string[] {
  const lines = [`${result.status.toUpperCase()} ${result.schema}: ${result.summary.passed}/${result.summary.total} passed, ${result.summary.failed} failed, ${result.summary.unavailable} unavailable`];
  for (const item of result.checks.filter((candidate) => candidate.status === "fail" || candidate.status === "unavailable")) { lines.push(`[${item.id}] ${item.status}: ${item.summary}`); for (const evidence of item.evidence) lines.push(`  - ${evidence}`); lines.push(`  remediation: ${item.remediation}`); }
  return lines;
}

export interface ScanOptions { maxFileBytes?: number; maxTotalBytes?: number }
export function scanRepositoryTexts(root: string, options: ScanOptions = {}): { texts: Record<string, string>; skips: ScanSkip[] } {
  const texts: Record<string, string> = {}; const skips: ScanSkip[] = []; const maxFile = options.maxFileBytes ?? 1_048_576; const maxTotal = options.maxTotalBytes ?? 33_554_432; let total = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name); const repoPath = relative(root, path).replaceAll("\\", "/");
      if (entry.isDirectory()) { if (EXCLUDED_DIRECTORIES.has(entry.name)) skips.push({ path: repoPath + "/", reason: "excluded_directory", detail: "explicit generated/dependency directory" }); else visit(path); continue; }
      if (!entry.isFile()) { skips.push({ path: repoPath, reason: "non_regular", detail: "symlink or special file" }); continue; }
      const size = statSync(path).size; if (size > maxFile) { skips.push({ path: repoPath, reason: "oversized", detail: `${size} bytes exceeds ${maxFile}` }); continue; } if (total + size > maxTotal) { skips.push({ path: repoPath, reason: "budget", detail: `${total + size} bytes exceeds ${maxTotal}` }); continue; }
      const bytes = readFileSync(path); if (bytes.includes(0)) { skips.push({ path: repoPath, reason: "binary", detail: "contains NUL byte" }); continue; }
      try { texts[repoPath] = new TextDecoder("utf-8", { fatal: true }).decode(bytes); total += size; } catch { skips.push({ path: repoPath, reason: "undecodable", detail: "not valid UTF-8 text" }); }
    }
  };
  visit(root); return { texts, skips };
}
const manifestCommands = (surface: "shell" | "slash"): ReleaseTruthCommand[] => COMMAND_MANIFEST
  .filter((entry) => entry.surface === surface)
  .map((entry) => ({
    name: entry.name,
    aliases: entry.aliases,
    hidden: entry.hidden,
    release: entry.release,
  }));

export function collectReleaseTruthInput(
  root: string,
  packedFiles: readonly string[],
  commands: readonly ReleaseTruthCommand[] = manifestCommands("shell"),
  slashCommands: readonly ReleaseTruthCommand[] = manifestCommands("slash"),
  evidence: ReleaseTruthEvidence = {},
): ReleaseTruthInput {
  const scan = scanRepositoryTexts(root); const files: Record<string, string> = {};
  for (const path of ["package.json", "package-lock.json", "src/version.ts", "README.md", "COMMANDS.md", "RELEASE_NOTES.md"]) if (scan.texts[path] !== undefined) files[path] = scan.texts[path]!;
  const manifest = parseJson(files["package.json"]); const version = typeof manifest?.["version"] === "string" ? manifest["version"] : null;
  if (version) { const packet = `docs/releases/OPERATOR-PACKET-v${version}.md`; if (scan.texts[packet] !== undefined) files[packet] = scan.texts[packet]!; }
  return { files, scannedTexts: scan.texts, scanSkips: scan.skips, packedFiles, commands, slashCommands, ...evidence };
}
export function releaseTruthFromRepository(root: string, packedFiles: readonly string[], evidence: ReleaseTruthEvidence = {}): ReleaseTruthResult {
  return evaluateReleaseTruth(collectReleaseTruthInput(root, packedFiles, manifestCommands("shell"), manifestCommands("slash"), evidence));
}
function safeFailureDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\b(?:AETHER_TOKEN|NPM_TOKEN|GITHUB_TOKEN|API_KEY|ACCESS_TOKEN)\s*=\s*[^\s,;]+/gi, "credential=[redacted]")
    .replace(/\b(?:aek_|gh[opusr]_|Bearer\s+)[A-Za-z0-9._-]+/gi, "[redacted credential]")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .slice(0, 240);
}
export function releaseTruthFailure(stage: "collection" | "pack", error: unknown): ReleaseTruthResult {
  const detail = safeFailureDetail(error); return resultFromChecks(null, [{ id: `${stage}.unavailable`, status: "unavailable", summary: `${stage} evidence could not be collected`, remediation: stage === "pack" ? "Run npm pack --dry-run --json after a successful build and inspect its error." : "Restore readable repository files and rerun collection.", evidence: [detail] }]);
}
export async function runReleaseTruth(root: string, evidence: ReleaseTruthEvidence = {}, packedFiles?: readonly string[]): Promise<ReleaseTruthResult> {
  let paths = packedFiles; if (!paths) { try { const { createPackReport } = await import("./verify-production.js"); paths = createPackReport(root).files.map((file) => file.path); } catch (error) { return releaseTruthFailure("pack", error); } }
  try { return releaseTruthFromRepository(root, paths, evidence); } catch (error) { return releaseTruthFailure("collection", error); }
}
export function deterministicRepositoryEvidence(): ReleaseTruthEvidence {
  const capabilities = [...new Set(COMMAND_MANIFEST.flatMap((entry) => entry.availability.capabilityRequirements))]
    .sort()
    .map((id) => ({ id, shipped: true, documented: true, releaseDisposition: "exempt" as const }));
  return {
    capabilities: { state: "available", value: capabilities },
    generatedDocs: {
      state: "not_applicable",
      reason: "v0.3.0 has no generated command/model document contract; this lane becomes required when its generator lands",
    },
    catalogue: {
      state: "not_applicable",
      reason: "v0.3.0 reads the live model catalogue and ships no generated catalogue snapshot",
    },
    packedClaims: {
      state: "available",
      value: [{
        id: "aether-agent-cli",
        advertised: true,
        registryInstalled: false,
        sourceOnly: true,
        requiredPaths: ["README.md", "COMMANDS.md", "dist/src/main.js"],
      }],
    },
  };
}

export async function observeNpmRegistry(root: string): Promise<Evidence<RegistryTruth>> {
  try {
    const manifest = parseJson(readFileSync(join(root, "package.json"), "utf8"));
    const source = typeof manifest?.["version"] === "string" ? manifest["version"] : "";
    const response = await fetch("https://registry.npmjs.org/aether-agents", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { state: "unavailable", reason: `npm registry returned HTTP ${response.status}` };
    const body = await response.json() as { versions?: Record<string, unknown>; "dist-tags"?: Record<string, unknown> };
    const versions = Object.keys(body.versions ?? {}).sort();
    const latest = typeof body["dist-tags"]?.["latest"] === "string" ? body["dist-tags"]["latest"] : null;
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const publicLatest = /\|\s*npm\s+`latest`\s*\|\s*\*\*([^*]+)\*\*/i.exec(readme)?.[1]?.trim() ?? null;
    const publicSource = /\|\s*`main`\s+source build\s*\|\s*\*\*([^*]+)\*\*/i.exec(readme)?.[1]?.trim() ?? "";
    const sourceAvailability = publicSource === source && /future published/i.test(readme)
      ? "unpublished"
      : "published";
    return {
      state: "available",
      value: {
        sourceVersion: source,
        publishedVersions: versions,
        latest,
        publicClaim: { sourceAvailability, latest: publicLatest },
      },
    };
  } catch (error) {
    return { state: "unavailable", reason: safeFailureDetail(error) || "npm registry observation failed" };
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const evidence = deterministicRepositoryEvidence();
  evidence.registry = await observeNpmRegistry(root);
  const result = await runReleaseTruth(root, evidence);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.stderr.write(`${result.humanSummary.join("\n")}\n`);
  if (!result.ok) process.exitCode = 1;
}
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) void main();
