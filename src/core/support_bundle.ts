// Redacted support bundle — a single .tar of metadata-only diagnostics.
//
// Contents are inventories, digests, and counts. Never included: repo source,
// diffs, prompts, transcripts beyond redacted event metadata lines, tool
// output bodies, instruction/skill text, tokens, env values, absolute
// private paths.
//
// Invariant: the final bundle file only exists after the candidate has been
// reopened, parsed, allowlist-checked, secret-scanned, and hash-verified.
// Any failure deletes the candidate and surfaces the error.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AppContext } from "./context.js";
import { diagnosticReport, type DiagnosticDependencies } from "./diagnostics.js";
import { discoverSkills } from "./skills/skill_discovery.js";
import { resolveInstructionGraph } from "./instructions/instruction_resolver.js";
import { logsRoot } from "./session_log.js";
import { redactForBundle, scanForSecrets } from "./redaction.js";
import { readTar, writeTar, type TarEntry } from "./tar.js";
import { VERSION } from "../version.js";

export const SUPPORT_BUNDLE_SCHEMA_VERSION = 1;
const RECENT_EVENT_LINES = 200;

export const SUPPORT_BUNDLE_FILES = [
  "support-manifest.json",
  "doctor-report.json",
  "runtime.json",
  "sanitized-config.json",
  "skill-inventory.json",
  "instruction-inventory.json",
  "recent-redacted-events.ndjson",
  "README.txt",
] as const;

export class SupportBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportBundleError";
  }
}

export interface SupportBundleOptions {
  now?: string;
  /** Output directory for the final .tar; defaults to ctx.flags.cwd. */
  outDir?: string;
  dependencies?: DiagnosticDependencies;
  env?: NodeJS.ProcessEnv;
  /** Fault-injection seam (tests): runs after the candidate tar is written and
   * before finalize — a throw must leave no final bundle file behind. */
  verifyHook?: () => void;
}

export interface SupportBundleResult {
  path: string;
  bytes: number;
  sha256: string;
}

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function baseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "(invalid base URL)";
  }
}

function sanitizedConfig(ctx: AppContext): Record<string, unknown> {
  return {
    schema_version: SUPPORT_BUNDLE_SCHEMA_VERSION,
    base_url_host: baseUrlHost(ctx.cfg.baseUrl),
    default_model_set: ctx.cfg.defaultModel !== "",
    permission_mode: ctx.cfg.permissionMode,
    auto_apply: ctx.cfg.autoApply,
    telemetry: ctx.cfg.telemetry,
    default_effort: ctx.cfg.defaultEffort,
    backend: ctx.cfg.backend,
  };
}

function skillInventory(projectRoot: string): Record<string, unknown> {
  const index = discoverSkills({ projectRoot });
  return {
    schema_version: SUPPORT_BUNDLE_SCHEMA_VERSION,
    skills: index.skills.map((descriptor) => ({
      id: descriptor.id,
      version: descriptor.version,
      scope: descriptor.scope,
      digest: "sha256:" + descriptor.sha256,
      trust: descriptor.trust,
      enabled: descriptor.enabled,
      automatic: descriptor.automatic,
      tools_allowed: descriptor.manifest.tools.allowed,
      tools_required: descriptor.manifest.tools.required,
      tools_denied: descriptor.manifest.tools.denied,
      permissions_requires: descriptor.manifest.permissions.requires,
      permissions_may_request: descriptor.manifest.permissions.mayRequest,
      permissions_forbids: descriptor.manifest.permissions.forbids,
      has_eval_manifest: descriptor.manifest.health.evalManifest != null,
    })),
    index_error_count: index.errors.length,
  };
}

function instructionInventory(projectRoot: string): Record<string, unknown> {
  const graph = resolveInstructionGraph(projectRoot);
  return {
    schema_version: SUPPORT_BUNDLE_SCHEMA_VERSION,
    sources: graph.sources.map((source) => ({
      kind: source.kind,
      path: source.displayPath,
      scope: source.scopeDir === "" ? "project" : source.scopeDir,
      digest: "sha256:" + source.sha256,
      size_bytes: source.sizeBytes,
      parse_status: source.parseStatus,
      warning_count: source.warnings.length,
    })),
    conflict_count: graph.conflicts.length,
    skipped_count: graph.skipped.length,
  };
}

/** Last N redacted lines of the newest session's events.jsonl ("" when none). */
function recentRedactedEvents(): string {
  const root = logsRoot();
  if (!existsSync(root)) return "";
  let newest: { path: string; mtime: number } | null = null;
  let sessions: string[];
  try {
    sessions = readdirSync(root);
  } catch {
    return "";
  }
  for (const session of sessions) {
    const eventsPath = join(root, session, "events.jsonl");
    try {
      const stat = statSync(eventsPath);
      if (stat.isFile() && (!newest || stat.mtimeMs > newest.mtime)) {
        newest = { path: eventsPath, mtime: stat.mtimeMs };
      }
    } catch {
      // not a session directory — skip
    }
  }
  if (!newest) return "";
  let raw: string;
  try {
    raw = readFileSync(newest.path, "utf8");
  } catch {
    return "";
  }
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  return lines.slice(-RECENT_EVENT_LINES).join("\n") + (lines.length ? "\n" : "");
}

const README_TEXT =
  "Aether support bundle\n" +
  "=====================\n\n" +
  "Metadata-only diagnostics for troubleshooting. Every text entry passed a\n" +
  "redaction pass and a secret scan before this archive was finalized.\n\n" +
  "  support-manifest.json          per-file sha256 hashes\n" +
  "  doctor-report.json             fast doctor run (schema v2, no network)\n" +
  "  runtime.json                   node/platform/agent versions\n" +
  "  sanitized-config.json          config booleans + backend host (no token)\n" +
  "  skill-inventory.json           skill metadata (no SKILL.md content)\n" +
  "  instruction-inventory.json     instruction file metadata (no text)\n" +
  "  recent-redacted-events.ndjson  last session event metadata, redacted\n\n" +
  "Not included: source code, diffs, prompts, transcripts, tool output,\n" +
  "instruction or skill text, tokens, environment values, private paths.\n";

function timestampSlug(nowIso: string): string {
  const date = new Date(nowIso);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    date.getUTCFullYear().toString() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) +
    "-" + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds())
  );
}

async function collectEntries(
  ctx: AppContext,
  nowIso: string,
  dependencies: DiagnosticDependencies,
  env: NodeJS.ProcessEnv,
): Promise<TarEntry[]> {
  // Fast mode only: the bundle must never spend, never touch the network, and
  // never claim a path was verified. main`s HealthReport carries per-axis
  // "not-checked" states, so an unexercised probe stays visibly unexercised.
  const doctor = await diagnosticReport(ctx, { dependencies: { ...dependencies, now: nowIso } });
  const sanitize = (text: string): Buffer => Buffer.from(redactForBundle(text, env), "utf8");
  const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
  const projectRoot = resolve(ctx.flags.cwd);

  const body: TarEntry[] = [
    { name: "doctor-report.json", data: sanitize(json(doctor)) },
    {
      name: "runtime.json",
      data: sanitize(
        json({
          schema_version: SUPPORT_BUNDLE_SCHEMA_VERSION,
          node: process.versions.node,
          platform: process.platform,
          arch: process.arch,
          agent_version: VERSION,
        }),
      ),
    },
    { name: "sanitized-config.json", data: sanitize(json(sanitizedConfig(ctx))) },
    { name: "skill-inventory.json", data: sanitize(json(skillInventory(projectRoot))) },
    { name: "instruction-inventory.json", data: sanitize(json(instructionInventory(projectRoot))) },
    { name: "recent-redacted-events.ndjson", data: sanitize(recentRedactedEvents()) },
    { name: "README.txt", data: Buffer.from(README_TEXT, "utf8") },
  ];

  const manifest = {
    schema_version: SUPPORT_BUNDLE_SCHEMA_VERSION,
    generated_at: nowIso,
    files: body.map((entry) => ({ name: entry.name, sha256: sha256Hex(entry.data), bytes: entry.data.length })),
  };
  return [{ name: "support-manifest.json", data: Buffer.from(json(manifest), "utf8") }, ...body];
}

function verifyCandidate(archive: Buffer, env: NodeJS.ProcessEnv): void {
  const entries = readTar(archive);
  const names = entries.map((entry) => entry.name).sort();
  const expected = [...SUPPORT_BUNDLE_FILES].sort();
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    throw new SupportBundleError("bundle entry names differ from the allowlist");
  }
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
  for (const entry of entries) {
    const findings = scanForSecrets(entry.data.toString("utf8"), env);
    if (findings.length) {
      throw new SupportBundleError("secret scan flagged " + entry.name + ": " + findings.join(", "));
    }
  }
  const manifestRaw = byName.get("support-manifest.json");
  const manifest = JSON.parse(manifestRaw!.toString("utf8")) as {
    files: { name: string; sha256: string; bytes: number }[];
  };
  for (const record of manifest.files) {
    const data = byName.get(record.name);
    if (!data || sha256Hex(data) !== record.sha256 || data.length !== record.bytes) {
      throw new SupportBundleError("manifest hash mismatch for " + record.name);
    }
  }
}

export async function createSupportBundle(
  ctx: AppContext,
  options: SupportBundleOptions = {},
): Promise<SupportBundleResult> {
  const nowIso = options.now ?? new Date().toISOString();
  const env = options.env ?? process.env;
  const outDir = resolve(options.outDir ?? ctx.flags.cwd);
  const fileName = "aether-support-" + timestampSlug(nowIso) + ".tar";
  const finalPath = join(outDir, fileName);

  const entries = await collectEntries(ctx, nowIso, options.dependencies ?? {}, env);
  const archive = writeTar(entries);

  // Private staging dir: candidate is only promoted after verification.
  const stage = join(tmpdir(), "aether-support-" + process.pid + "-" + randomBytes(4).toString("hex"));
  mkdirSync(stage, { recursive: true, mode: 0o700 });
  const candidate = join(stage, fileName);
  try {
    writeFileSync(candidate, archive, { mode: 0o600 });
    options.verifyHook?.();
    verifyCandidate(readFileSync(candidate), env);
    try {
      renameSync(candidate, finalPath);
    } catch {
      // Cross-device rename: copy bytes, then remove the candidate.
      writeFileSync(finalPath, readFileSync(candidate), { mode: 0o600 });
    }
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error instanceof SupportBundleError
      ? error
      : new SupportBundleError(error instanceof Error ? error.message : String(error));
  }
  rmSync(stage, { recursive: true, force: true });

  const finalBytes = readFileSync(finalPath);
  return { path: finalPath, bytes: finalBytes.length, sha256: sha256Hex(finalBytes) };
}
