// aether skills — inspect, trust, and manage Agent Skills.
//
// Everything here is metadata-level: bodies (SKILL.md) are never printed and
// never loaded. Trust mutations are CLI-only by design — the REPL handler
// (skillsSlash) supports read/toggle subcommands and redirects trust to the
// CLI so a trust decision is always a deliberate, visible action.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import { discoverSkills, projectSkillsRoot, userSkillsRoot } from "../core/skills/skill_discovery.js";
import { calculateSkillDigest, digestFileList } from "../core/skills/skill_digest.js";
import {
  compareLock, projectLockPath, readSkillLock, writeSkillLock,
  type LockDrift, type SkillLockEntry,
} from "../core/skills/skill_lock.js";
import { TOOL_PERMISSIONS } from "../core/skills/permission_vocabulary.js";
import { dependencyOrder } from "../core/skills/skill_resolver.js";
import { validateSkillManifest, type SkillManifest, type SkillScope } from "../core/skills/skill_schema.js";
import { loadSkillSettings, lookupSkillSetting, saveSkillSetting } from "../core/skills/skill_settings.js";
import { recordTrust, removeTrust } from "../core/skills/skill_trust.js";
import type { SkillDescriptor, SkillIndex } from "../core/skills/skill_types.js";
import type { ToolName } from "../core/brain_protocol.js";

export interface SkillsCommandOptions {
  out?: Writable;
  /** --scope for create/install (project|user; default project). */
  scope?: string;
  /** --all for check. */
  all?: boolean;
  /** --ci for check: exit 1 on any failure. */
  ci?: boolean;
}

const USAGE =
  "usage: aether skills <subcommand>\n" +
  "  list                                   index of discovered skills (--json)\n" +
  "  show <id>                              metadata, digest, declared policy\n" +
  "  explain <id>                           show + files that would load + effective tools\n" +
  "  create <name> [--scope project|user]   scaffold a new skill directory\n" +
  "  install <path> [--scope project|user]  install a local skill directory\n" +
  "  enable <id> | disable <id>             toggle a skill locally\n" +
  "  trust <id> | untrust <id>              record / remove a local trust decision\n" +
  "  lock                                   write .aether/skills.lock.json\n" +
  "  check [id|--all] [--ci]                static health checks (--json)\n";

export async function cmdSkills(
  ctx: AppContext,
  argv: string[] = [],
  options: SkillsCommandOptions = {},
): Promise<number> {
  const out = options.out ?? process.stdout;
  // Flags are parsed by main.ts; drop any stray --tokens (REPL passthrough).
  const positional = argv.filter((token) => !token.startsWith("--"));
  const sub = (positional[0] ?? "list").toLowerCase();
  const target = positional[1];

  switch (sub) {
    case "list":
      return runList(ctx, out);
    case "show":
    case "explain":
      if (!target) return usage(out);
      return runShow(ctx, out, target, sub === "explain");
    case "create":
      if (!target) return usage(out);
      return runCreate(ctx, out, target, options.scope);
    case "install":
      if (!target) return usage(out);
      return runInstall(ctx, out, target, options.scope);
    case "enable":
    case "disable":
      if (!target) return usage(out);
      return runSetEnabled(ctx, out, target, sub === "enable");
    case "trust":
      if (!target) return usage(out);
      return runTrust(ctx, out, target);
    case "untrust":
      if (!target) return usage(out);
      return runUntrust(ctx, out, target);
    case "lock":
      return runLock(ctx, out);
    case "check":
      return runCheck(ctx, out, options.all ? undefined : target, options.ci === true);
    default:
      return usage(out);
  }
}

/** `/skills` REPL handler: read/toggle only — trust mutations stay in the CLI. */
export async function skillsSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.trim() ? arg.trim().split(/\s+/) : [];
  const sub = (parts[0] ?? "list").toLowerCase();
  if (sub === "trust" || sub === "untrust") {
    out.write(`trust is a deliberate CLI action — use: aether skills ${sub} ${parts[1] ?? "<id>"}\n`);
    return;
  }
  if (sub === "list" || sub === "show" || sub === "enable" || sub === "disable") {
    await cmdSkills(ctx, parts, { out });
    return;
  }
  out.write("usage: /skills [list|show <id>|enable <id>|disable <id>]\n");
}

function usage(out: Writable): number {
  out.write(USAGE);
  return 2;
}

function discover(ctx: AppContext): SkillIndex {
  return discoverSkills({ projectRoot: ctx.flags.cwd });
}

/** Trust/settings key convention (skill_trust.ts): "*" except project scope. */
function storeKey(ctx: AppContext, scope: SkillScope): string {
  return scope === "project" ? resolve(ctx.flags.cwd) : "*";
}

function findSkill(index: SkillIndex, reference: string): { descriptor?: SkillDescriptor; error?: string } {
  const query = reference.trim().toLowerCase();
  if (!query) return { error: "missing skill id" };
  const matches = query.includes("/")
    ? index.skills.filter((descriptor) => descriptor.id === query)
    : index.skills.filter((descriptor) => (descriptor.id.split("/")[1] ?? descriptor.id) === query);
  if (matches.length === 0) return { error: `no skill matches '${reference}' — see: aether skills list` };
  if (matches.length > 1) {
    return { error: `'${reference}' is ambiguous: ${matches.map((descriptor) => descriptor.id).join(", ")} — use the fully qualified id` };
  }
  return { descriptor: matches[0] };
}

function listOrNone(values: readonly string[]): string {
  return values.length ? values.join(", ") : "(none)";
}

function normalizeScope(value: string | undefined): "project" | "user" | null {
  if (value == null || value === "") return "project";
  return value === "project" || value === "user" ? value : null;
}

// ── list ────────────────────────────────────────────────────────────────────

function runList(ctx: AppContext, out: Writable): number {
  const index = discover(ctx);
  if (ctx.flags.json) {
    out.write(JSON.stringify(index) + "\n");
    return 0;
  }
  if (index.skills.length === 0) out.write("no skills discovered.\n");
  const width = Math.max(0, ...index.skills.map((d) => (d.id + "@" + d.version).length)) + 2;
  for (const d of index.skills) {
    out.write(
      (d.id + "@" + d.version).padEnd(width) +
      d.scope.padEnd(9) +
      d.trust.padEnd(11) +
      (d.enabled ? "enabled" : "disabled").padEnd(10) +
      (d.automatic ? "auto" : "manual").padEnd(8) +
      "~" + d.approxTokens + " tok\n",
    );
  }
  if (index.errors.length) {
    out.write("\nindex errors:\n");
    for (const error of index.errors) {
      out.write("  " + error.root + " (" + error.scope + "): " + error.errors.join("; ") + "\n");
    }
  }
  return 0;
}

// ── show / explain ──────────────────────────────────────────────────────────

function runShow(ctx: AppContext, out: Writable, reference: string, explain: boolean): number {
  const found = findSkill(discover(ctx), reference);
  if (!found.descriptor) {
    out.write(found.error + "\n");
    return 1;
  }
  const d = found.descriptor;
  const m = d.manifest;
  out.write(d.id + "@" + d.version + " — " + m.name + "\n");
  out.write("  " + m.description + "\n");
  out.write(
    "  scope: " + d.scope + "   trust: " + d.trust +
    "   enabled: " + (d.enabled ? "yes" : "no") +
    "   automatic: " + (d.automatic ? "yes" : "no") + "\n",
  );
  out.write("  root: " + d.root + "\n");
  out.write("  digest: sha256:" + d.sha256 + "\n");
  out.write("  entrypoint: " + m.entrypoint + "   approx tokens: " + d.approxTokens + "\n");
  out.write("  tools allowed: " + listOrNone(m.tools.allowed) + "\n");
  out.write("  tools required: " + listOrNone(m.tools.required) + "\n");
  out.write("  tools denied: " + listOrNone(m.tools.denied) + "\n");
  out.write("  permissions requires: " + listOrNone(m.permissions.requires) + "\n");
  out.write("  permissions may_request: " + listOrNone(m.permissions.mayRequest) + "\n");
  out.write("  permissions forbids: " + listOrNone(m.permissions.forbids) + "\n");
  out.write("  resources: " + listOrNone(m.context.resources) + "\n");
  out.write(
    "  triggers: automatic=" + (m.triggers.automatic ? "yes" : "no") +
    "  commands=" + listOrNone(m.triggers.commands) +
    "  phrases=" + listOrNone(m.triggers.phrases) + "\n",
  );
  out.write("  dependencies: " + listOrNone(m.dependencies.skills) + "\n");
  if (!explain) return 0;

  out.write("\nwould load (digest-covered files):\n");
  for (const file of digestFileList(m)) out.write("  " + file + "\n");
  out.write("effective tool policy (allowed minus forbidden-permission tools):\n");
  const effective = effectiveTools(m);
  if (effective.length === 0) out.write("  (none)\n");
  for (const entry of effective) out.write("  " + entry.tool + " (needs " + entry.permission + ")\n");
  return 0;
}

/** Mirror of calculateSkillPolicy without loading the body: a tool whose
 * permission the skill itself forbids is never effective. */
function effectiveTools(manifest: SkillManifest): { tool: string; permission: string }[] {
  const out: { tool: string; permission: string }[] = [];
  for (const tool of manifest.tools.allowed) {
    const needed = TOOL_PERMISSIONS[tool as ToolName];
    if (needed && manifest.permissions.forbids.includes(needed)) continue;
    out.push({ tool, permission: needed });
  }
  return out;
}

// ── create ──────────────────────────────────────────────────────────────────

function runCreate(ctx: AppContext, out: Writable, name: string, scopeFlag: string | undefined): number {
  const scope = normalizeScope(scopeFlag);
  if (!scope) {
    out.write("--scope must be project or user\n");
    return 2;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
    out.write("skill name must be lowercase kebab (a-z, 0-9, -), at most 64 chars\n");
    return 2;
  }
  const root = scope === "project" ? projectSkillsRoot(resolve(ctx.flags.cwd)) : userSkillsRoot();
  const dir = join(root, name);
  if (existsSync(dir)) {
    out.write("directory already exists: " + dir + "\n");
    return 1;
  }
  const template = {
    schema_version: 1,
    id: scope + "/" + name,
    version: "0.1.0",
    name,
    description: "Describe when this skill applies and what it does.",
    entrypoint: "SKILL.md",
    triggers: { commands: [], phrases: [], automatic: false },
    tools: { allowed: [], required: [], denied: [] },
    permissions: { requires: [], may_request: [], forbids: [] },
    context: { max_tokens: 2000, resources: [] },
    outputs: { kinds: [], verification: [] },
    dependencies: { skills: [] },
    compatibility: { min_agent_version: "0.1.0", capability_contract: 1 },
    health: { eval_manifest: null },
  };
  // Invariant: the scaffold must always be schema-valid — a template that fails
  // its own validator would ship a broken starting point.
  const validation = validateSkillManifest(template, scope);
  if (!validation.ok) {
    out.write("internal error — scaffold template is invalid:\n");
    for (const error of validation.errors) out.write("  - " + error + "\n");
    return 1;
  }
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(join(dir, "skill.json"), JSON.stringify(template, null, 2) + "\n", "utf8");
  writeFileSync(
    join(dir, "SKILL.md"),
    "# " + name + "\n\nConcrete instructions for the agent when this skill is active.\n\n## Steps\n\n1. ...\n",
    "utf8",
  );
  out.write("created " + scope + "/" + name + " at " + dir + "\n");
  out.write("edit skill.json + SKILL.md, then verify: aether skills check " + scope + "/" + name + "\n");
  return 0;
}

// ── install ─────────────────────────────────────────────────────────────────

function runInstall(ctx: AppContext, out: Writable, sourceArg: string, scopeFlag: string | undefined): number {
  const scope = normalizeScope(scopeFlag);
  if (!scope) {
    out.write("--scope must be project or user\n");
    return 2;
  }
  const source = resolve(ctx.flags.cwd, sourceArg);
  const manifestPath = join(source, "skill.json");
  if (!existsSync(manifestPath)) {
    out.write("no skill.json found at " + source + "\n");
    return 1;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    out.write("skill.json is not valid JSON: " + manifestPath + "\n");
    return 1;
  }
  const validation = validateSkillManifest(raw, scope);
  if (!validation.ok) {
    out.write("invalid skill manifest for scope '" + scope + "':\n");
    for (const error of validation.errors) out.write("  - " + error + "\n");
    return 1;
  }
  const manifest = validation.manifest;
  const digest = calculateSkillDigest(source, manifest, raw);
  if (!digest.ok) {
    out.write(digest.error + "\n");
    return 1;
  }
  const shortName = manifest.id.split("/")[1] ?? manifest.id;
  const root = scope === "project" ? projectSkillsRoot(resolve(ctx.flags.cwd)) : userSkillsRoot();
  const destination = join(root, shortName);
  if (existsSync(destination)) {
    out.write("destination already exists: " + destination + "\n");
    return 1;
  }
  mkdirSync(root, { recursive: true });
  cpSync(source, destination, { recursive: true });
  if (scope === "user") {
    recordTrust({
      projectRoot: "*",
      repository: null,
      skillId: manifest.id,
      version: manifest.version,
      sha256: digest.sha256,
      trustedAt: new Date().toISOString(),
      method: "install",
      requestedPermissions: [...manifest.permissions.requires, ...manifest.permissions.mayRequest],
    });
  }
  out.write("installed " + manifest.id + "@" + manifest.version + " → " + destination + "\n");
  if (scope === "project") {
    out.write("project skills need trust before they run: aether skills trust " + manifest.id + "\n");
  }
  return 0;
}

// ── enable / disable ────────────────────────────────────────────────────────

function runSetEnabled(ctx: AppContext, out: Writable, reference: string, enabled: boolean): number {
  const found = findSkill(discover(ctx), reference);
  if (!found.descriptor) {
    out.write(found.error + "\n");
    return 1;
  }
  const d = found.descriptor;
  const key = storeKey(ctx, d.scope);
  const existing = lookupSkillSetting(loadSkillSettings(), key, d.id);
  saveSkillSetting({ projectRoot: key, skillId: d.id, enabled, automatic: existing?.automatic === true });
  out.write(d.id + " " + (enabled ? "enabled" : "disabled") + "\n");
  return 0;
}

// ── trust / untrust ─────────────────────────────────────────────────────────

async function runTrust(ctx: AppContext, out: Writable, reference: string): Promise<number> {
  const found = findSkill(discover(ctx), reference);
  if (!found.descriptor) {
    out.write(found.error + "\n");
    return 1;
  }
  const d = found.descriptor;
  if (d.scope !== "project") {
    out.write(d.id + " is a " + d.scope + " skill — already trusted, nothing to record\n");
    return 0;
  }
  const m = d.manifest;
  out.write("trust decision for " + d.id + "@" + d.version + "\n");
  out.write("  digest: sha256:" + d.sha256 + "\n");
  out.write("  requires: " + listOrNone(m.permissions.requires) + "\n");
  out.write("  may_request: " + listOrNone(m.permissions.mayRequest) + "\n");
  out.write("  forbids: " + listOrNone(m.permissions.forbids) + "\n");
  out.write("  tools: " + listOrNone(m.tools.allowed) + "\n");
  if (!ctx.flags.yes && !process.stdin.isTTY) {
    // Fail closed: piped/CI stdin cannot confirm, and trust must never default on.
    out.write("not a TTY — re-run with --yes to trust non-interactively\n");
    return 1;
  }
  const confirmed = ctx.flags.yes || (await ctx.confirm("Trust this skill for this project? [y/N] "));
  if (!confirmed) {
    out.write("not trusted.\n");
    return 0;
  }
  recordTrust({
    projectRoot: resolve(ctx.flags.cwd),
    repository: null,
    skillId: d.id,
    version: d.version,
    sha256: d.sha256,
    trustedAt: new Date().toISOString(),
    method: "explicit",
    requestedPermissions: [...m.permissions.requires, ...m.permissions.mayRequest],
  });
  out.write(d.id + " trusted (digest-bound — content changes require re-trust)\n");
  return 0;
}

function runUntrust(ctx: AppContext, out: Writable, reference: string): number {
  const found = findSkill(discover(ctx), reference);
  const skillId = found.descriptor?.id ?? reference;
  const key = found.descriptor ? storeKey(ctx, found.descriptor.scope) : resolve(ctx.flags.cwd);
  const removed = removeTrust(key, skillId);
  out.write(removed ? skillId + " trust record removed\n" : "no trust record for " + skillId + "\n");
  return removed ? 0 : 1;
}

// ── lock ────────────────────────────────────────────────────────────────────

function runLock(ctx: AppContext, out: Writable): number {
  const index = discover(ctx);
  const projectRoot = resolve(ctx.flags.cwd);
  const entries: SkillLockEntry[] = index.skills
    .filter((d) => d.scope === "project")
    .map((d) => ({
      id: d.id,
      version: d.version,
      source: relative(projectRoot, d.root).replaceAll("\\", "/"),
      sha256: d.sha256,
      dependencies: d.manifest.dependencies.skills,
    }));
  const path = projectLockPath(projectRoot);
  writeSkillLock(path, entries);
  out.write("locked " + entries.length + " project skill" + (entries.length === 1 ? "" : "s") + " → " + path + "\n");
  return 0;
}

// ── check ───────────────────────────────────────────────────────────────────

interface CheckFinding {
  subject: string;
  check: "schema" | "trust" | "lock" | "dependencies" | "evals";
  ok: boolean;
  detail: string;
}

function runCheck(ctx: AppContext, out: Writable, reference: string | undefined, ci: boolean): number {
  const index = discover(ctx);
  const projectRoot = resolve(ctx.flags.cwd);

  let targets: readonly SkillDescriptor[];
  if (reference) {
    const found = findSkill(index, reference);
    if (!found.descriptor) {
      out.write(found.error + "\n");
      return 1;
    }
    targets = [found.descriptor];
  } else {
    targets = index.skills;
  }

  const findings: CheckFinding[] = [];
  if (!reference) {
    for (const error of index.errors) {
      findings.push({ subject: error.root, check: "schema", ok: false, detail: error.errors.join("; ") });
    }
  }

  const lockResult = readSkillLock(projectLockPath(projectRoot));
  if (!lockResult.ok && !lockResult.missing) {
    findings.push({ subject: projectLockPath(projectRoot), check: "lock", ok: false, detail: lockResult.error });
  }
  const drift: LockDrift | null = lockResult.ok
    ? compareLock(
        lockResult.lock,
        new Map(index.skills.filter((d) => d.scope === "project").map((d) => [d.id, d.sha256])),
      )
    : null;
  if (drift && !reference) {
    for (const id of drift.missing) {
      findings.push({ subject: id, check: "lock", ok: false, detail: "locked skill no longer discovered" });
    }
  }

  for (const d of targets) findings.push(...checkOne(index, d, drift));

  const failures = findings.filter((finding) => !finding.ok);
  if (ctx.flags.json) {
    out.write(JSON.stringify({ checked: targets.length, failures: failures.length, findings }) + "\n");
  } else {
    const failedSubjects = new Set(failures.map((finding) => finding.subject));
    for (const d of targets) {
      if (!failedSubjects.has(d.id)) out.write("✓ " + d.id + "@" + d.version + "\n");
    }
    for (const subject of failedSubjects) {
      out.write("✗ " + subject + "\n");
      for (const finding of failures.filter((f) => f.subject === subject)) {
        out.write("    " + finding.check + ": " + finding.detail + "\n");
      }
    }
    out.write(targets.length + " skill" + (targets.length === 1 ? "" : "s") + " checked · " + failures.length + " failure" + (failures.length === 1 ? "" : "s") + "\n");
  }
  return failures.length > 0 && ci ? 1 : 0;
}

function checkOne(index: SkillIndex, d: SkillDescriptor, drift: LockDrift | null): CheckFinding[] {
  const findings: CheckFinding[] = [];
  if (d.trust === "untrusted" || d.trust === "changed") {
    const hint = d.trust === "changed" ? "content changed since it was trusted" : "project skill is untrusted";
    findings.push({ subject: d.id, check: "trust", ok: false, detail: hint + " — aether skills trust " + d.id });
  } else {
    findings.push({ subject: d.id, check: "trust", ok: true, detail: d.trust });
  }
  try {
    dependencyOrder(index, d);
    findings.push({ subject: d.id, check: "dependencies", ok: true, detail: "resolvable" });
  } catch (error) {
    findings.push({
      subject: d.id,
      check: "dependencies",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  if (d.scope === "project" && drift) {
    if (drift.changed.includes(d.id)) {
      findings.push({ subject: d.id, check: "lock", ok: false, detail: "digest differs from skills.lock.json — review, then: aether skills lock" });
    } else if (drift.unlocked.includes(d.id)) {
      findings.push({ subject: d.id, check: "lock", ok: false, detail: "not recorded in skills.lock.json — run: aether skills lock" });
    } else {
      findings.push({ subject: d.id, check: "lock", ok: true, detail: "digest matches lock" });
    }
  }
  const evalManifest = d.manifest.health.evalManifest;
  if (evalManifest) {
    const result = checkEvalManifest(d.root, evalManifest);
    findings.push({ subject: d.id, check: "evals", ok: result.ok, detail: result.detail });
  }
  return findings;
}

function checkEvalManifest(root: string, relativePath: string): { ok: boolean; detail: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(root, relativePath), "utf8"));
  } catch {
    return { ok: false, detail: "eval manifest missing or not valid JSON: " + relativePath };
  }
  if (!Array.isArray(raw)) return { ok: false, detail: "eval manifest must be a JSON array: " + relativePath };
  for (const [i, item] of raw.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { ok: false, detail: "eval fixture " + i + " must be an object" };
    }
    const record = item as Record<string, unknown>;
    if (typeof record["id"] !== "string" || !("input" in record) || !("expected" in record)) {
      return { ok: false, detail: "eval fixture " + i + " must have id, input, expected" };
    }
  }
  return { ok: true, detail: raw.length + " fixture" + (raw.length === 1 ? "" : "s") + " valid" };
}
