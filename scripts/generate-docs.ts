import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMAND_MANIFEST,
  validateCommandManifest,
  type CommandManifestEntry,
  type CommandSurface,
} from "../src/commands/command_manifest.js";
import { GLOBAL_FLAGS } from "../src/commands/cli_registry.js";

export const PUBLIC_CATALOGUE_SCHEMA = "aether-agent/public-model-catalogue-source@1" as const;
export const GENERATED_CATALOGUE_SCHEMA = "aether-agent/public-model-catalogue@1" as const;

export interface PublicCatalogueModel {
  id: string;
  label: string;
  provider: string;
  kind: "model" | "orchestrator";
  tierMin: "free" | "solo" | "pro" | "team";
}

export interface PublicCatalogueSource {
  schema: typeof PUBLIC_CATALOGUE_SCHEMA;
  asOf: string;
  sourcePath: string;
  sourceSection: string;
  scopeNote: string;
  models: readonly PublicCatalogueModel[];
}

export interface GeneratedCatalogue {
  schema: typeof GENERATED_CATALOGUE_SCHEMA;
  generatedAt: string;
  digest: string;
  source: { path: string; section: string };
  scopeNote: string;
  models: readonly PublicCatalogueModel[];
}

export interface GeneratedOutput { path: string; content: string }
export interface GenerateDocsOptions {
  root: string;
  check?: boolean;
  commands?: readonly CommandManifestEntry[];
  catalogueSourceText?: string;
}

const COMMAND_MARKERS = [
  "<!-- GENERATED-COMMAND-REFERENCE:START -->",
  "<!-- GENERATED-COMMAND-REFERENCE:END -->",
] as const;
const CATALOGUE_MARKERS = [
  "<!-- MODEL-CATALOGUE:START -->",
  "<!-- MODEL-CATALOGUE:END -->",
] as const;
const ID = /^[a-z0-9][a-z0-9._-]*$/;
const PROVIDER = /^[A-Za-z0-9][A-Za-z0-9 .&+-]*$/;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex")}`;
}

function parseCatalogue(text: string): PublicCatalogueSource {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("public catalogue source is not valid JSON"); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("public catalogue source must be an object");
  const source = value as Partial<PublicCatalogueSource>;
  const sourceKeys = new Set(["schema", "asOf", "sourcePath", "sourceSection", "scopeNote", "models"]);
  const unexpectedSourceKeys = Object.keys(source).filter((key) => !sourceKeys.has(key));
  if (unexpectedSourceKeys.length) throw new Error(`public catalogue source contains unsupported fields: ${unexpectedSourceKeys.join(", ")}`);
  if (source.schema !== PUBLIC_CATALOGUE_SCHEMA) throw new Error(`public catalogue source must use schema ${PUBLIC_CATALOGUE_SCHEMA}`);
  if (typeof source.asOf !== "string" || !Number.isFinite(Date.parse(source.asOf))) throw new Error("public catalogue source has an invalid asOf timestamp");
  if (typeof source.sourcePath !== "string" || !/^(?![A-Za-z]:|\/|.*\.\.)(?:[A-Za-z0-9._/-]+)$/.test(source.sourcePath)) throw new Error("public catalogue sourcePath must be a repository-relative path");
  if (typeof source.sourceSection !== "string" || !source.sourceSection.trim()) throw new Error("public catalogue sourceSection is required");
  if (typeof source.scopeNote !== "string" || !source.scopeNote.trim()) throw new Error("public catalogue scopeNote is required");
  if (!Array.isArray(source.models) || source.models.length === 0) throw new Error("public catalogue refresh is empty; last-known-good outputs were preserved");
  const ids = new Set<string>();
  for (const [index, item] of source.models.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error(`public catalogue model ${index} must be an object`);
    const model = item as Partial<PublicCatalogueModel>;
    const modelKeys = new Set(["id", "label", "provider", "kind", "tierMin"]);
    const unexpectedModelKeys = Object.keys(model).filter((key) => !modelKeys.has(key));
    if (unexpectedModelKeys.length) throw new Error(`public catalogue model ${index} contains unsupported fields: ${unexpectedModelKeys.join(", ")}`);
    if (typeof model.id !== "string" || !ID.test(model.id)) throw new Error(`public catalogue model ${index} has an invalid id`);
    if (ids.has(model.id)) throw new Error(`public catalogue contains duplicate model id ${model.id}`);
    ids.add(model.id);
    if (typeof model.label !== "string" || !model.label.trim()) throw new Error(`public catalogue model ${model.id} has no label`);
    if (typeof model.provider !== "string" || !PROVIDER.test(model.provider)) throw new Error(`public catalogue model ${model.id} has an invalid provider`);
    if (model.kind !== "model" && model.kind !== "orchestrator") throw new Error(`public catalogue model ${model.id} has an invalid kind`);
    if (!(["free", "solo", "pro", "team"] as const).includes(model.tierMin as "free")) throw new Error(`public catalogue model ${model.id} has an invalid tierMin`);
  }
  return source as PublicCatalogueSource;
}

function escapeMarkdown(value: string): string { return value.replaceAll("|", "\\|").replaceAll("\n", " "); }
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function flagUsage(name: string, spec: { type: "boolean" | "string"; short?: string; multiple?: boolean }): string {
  const long = `--${name}${spec.type === "string" ? ` <value>${spec.multiple ? "…" : ""}` : ""}`;
  return spec.short ? `-${spec.short}, ${long}` : long;
}

export function renderCommandReference(commands: readonly CommandManifestEntry[]): string {
  const errors = validateCommandManifest(commands, { reservedShellFlags: GLOBAL_FLAGS });
  if (errors.length) throw new Error(`command manifest is invalid: ${errors.join("; ")}`);
  const visible = commands.filter((entry) => !entry.hidden && entry.docs.visible);
  if (!visible.some((entry) => entry.surface === "shell") || !visible.some((entry) => entry.surface === "slash")) {
    throw new Error("command manifest must expose at least one shell and one slash command");
  }
  const digest = sha256(commands);
  const lines = [
    "<!-- GENERATED FILE: run `npm run docs:generate`; do not edit by hand. -->",
    `<!-- manifest-digest: ${digest} -->`,
    "# Generated command reference",
    "",
    "This reference is generated from the validated runtime command manifest. Availability is evaluated at runtime; a listed command may still require authentication, a hosted capability, or local tooling.",
    "",
    "Global shell flags accepted by the manifest:",
    "",
    [...new Set(visible.filter((entry) => entry.surface === "shell").flatMap((entry) => entry.acceptedGlobalFlags))].sort().map((flag) => `\`--${flag}\``).join(", "),
    "",
  ];
  for (const surface of ["shell", "slash"] as const satisfies readonly CommandSurface[]) {
    lines.push(`## ${surface === "shell" ? "Shell commands" : "Interactive slash commands"}`, "");
    const sections = [...new Set(visible.filter((entry) => entry.surface === surface).map((entry) => entry.section))];
    for (const section of sections) {
      lines.push(`### ${section}`, "");
      for (const entry of visible.filter((candidate) => candidate.surface === surface && candidate.section === section)) {
        lines.push(`#### \`${escapeMarkdown(entry.docs.usage)}\``, "", escapeMarkdown(entry.summary), "");
        const metadata = [
          `Permission: \`${entry.permissionClass}\``,
          `Availability: \`${entry.availability.state}\``,
          `Telemetry: \`${entry.telemetryName}\``,
        ];
        if (entry.aliases.length) metadata.push(`Aliases: ${entry.aliases.map((alias) => `\`${surface === "slash" ? "/" : "aether "}${alias}\``).join(", ")}`);
        if (entry.availability.capabilityRequirements.length) metadata.push(`Requires: ${entry.availability.capabilityRequirements.map((item) => `\`${item}\``).join(", ")}`);
        lines.push(metadata.join(" · "), "");
        const owned = Object.entries(entry.ownedFlags);
        if (owned.length) {
          lines.push("Command flags:", "");
          for (const [name, spec] of owned) lines.push(`- \`${flagUsage(name, spec)}\``);
          lines.push("");
        }
      }
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function generatedCatalogue(source: PublicCatalogueSource): GeneratedCatalogue {
  const models = [...source.models].map((model) => ({ ...model })).sort((a, b) => a.id.localeCompare(b.id));
  const digest = sha256({ ...source, models });
  return {
    schema: GENERATED_CATALOGUE_SCHEMA,
    generatedAt: new Date(source.asOf).toISOString(),
    digest,
    source: { path: source.sourcePath, section: source.sourceSection },
    scopeNote: source.scopeNote,
    models,
  };
}

export function renderCatalogueMarkdown(catalogue: GeneratedCatalogue): string {
  const lines = [
    "<!-- GENERATED FILE: run `npm run docs:generate`; do not edit by hand. -->",
    `<!-- catalogue-digest: ${catalogue.digest} -->`,
    "# Public model catalogue snapshot",
    "",
    catalogue.scopeNote,
    "",
    `- Snapshot time: \`${catalogue.generatedAt}\``,
    `- Source: [${escapeMarkdown(catalogue.source.section)}](../../${catalogue.source.path})`,
    `- Digest: \`${catalogue.digest}\``,
    "",
    "| Model | ID | Provider | Kind | Minimum documented tier |",
    "|---|---|---|---|---|",
    ...catalogue.models.map((model) => `| ${escapeMarkdown(model.label)} | \`${model.id}\` | ${escapeMarkdown(model.provider)} | ${model.kind} | ${model.tierMin} |`),
    "",
    "Runtime availability is account-scoped. Use `aether models` while signed in for the authoritative live result. This snapshot contains no prices, spend caps, internal routes, or credentials.",
  ];
  return `${lines.join("\n")}\n`;
}

export function renderCatalogueHtml(catalogue: GeneratedCatalogue): string {
  const providers = [...new Set(catalogue.models.map((model) => model.provider))].sort();
  const cards = catalogue.models.map((model) => `
      <article class="card" data-search="${escapeHtml(`${model.label} ${model.id} ${model.provider} ${model.kind} ${model.tierMin}`.toLowerCase())}" data-provider="${escapeHtml(model.provider)}" data-kind="${model.kind}">
        <h2>${escapeHtml(model.label)}</h2><p><code>${escapeHtml(model.id)}</code></p>
        <dl><div><dt>Provider</dt><dd>${escapeHtml(model.provider)}</dd></div><div><dt>Kind</dt><dd>${model.kind}</dd></div><div><dt>Minimum documented tier</dt><dd>${model.tierMin}</dd></div></dl>
      </article>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="aether-agent docs generator"><title>Aether Agent public model catalogue</title>
<style>:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.5}body{max-width:72rem;margin:auto;padding:clamp(1rem,4vw,3rem);background:#0c1018;color:#eef2ff}a{color:#8bd5ff}.lede{max-width:70ch}.meta{color:#bac4d8}.controls{display:none;grid-template-columns:2fr 1fr 1fr;gap:.75rem;margin:2rem 0}.controls label{display:grid;gap:.3rem}input,select{font:inherit;padding:.65rem;border:1px solid #65708a;border-radius:.45rem;background:#151c2a;color:inherit}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:1rem}.card{border:1px solid #3c465b;border-radius:.8rem;padding:1rem;background:#141b29}.card h2{margin:.1rem 0}.card p{margin:.2rem 0 1rem}dl{margin:0}dl div{display:flex;justify-content:space-between;gap:1rem;border-top:1px solid #30394b;padding:.4rem 0}dt{color:#bac4d8}dd{margin:0;text-align:right}body[data-enhanced] .controls{display:grid}.hidden{display:none}@media(max-width:38rem){body[data-enhanced] .controls{grid-template-columns:1fr}dl div{display:block}dd{text-align:left}}@media(prefers-reduced-motion:no-preference){.card{transition:opacity .15s}}</style></head>
<body><main><h1>Public model catalogue snapshot</h1><p class="lede">${escapeHtml(catalogue.scopeNote)}</p>
<p class="meta">Snapshot: <time datetime="${catalogue.generatedAt}">${catalogue.generatedAt}</time> · Source: <a href="../../${escapeHtml(catalogue.source.path)}">${escapeHtml(catalogue.source.section)}</a> · Digest: <code>${catalogue.digest}</code></p>
<p>This page is useful without JavaScript. Runtime availability is account-scoped; use <code>aether models</code> while signed in for the authoritative live result. No prices or spend caps are asserted here.</p>
<form class="controls" role="search" onsubmit="return false"><label>Search<input id="q" type="search" autocomplete="off" placeholder="Model, ID, or provider"></label><label>Provider<select id="provider"><option value="">All providers</option>${providers.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</select></label><label>Kind<select id="kind"><option value="">All kinds</option><option value="model">Model</option><option value="orchestrator">Orchestrator</option></select></label></form>
<p id="status" aria-live="polite"></p><section class="grid" aria-label="Documented catalogue models">${cards}
</section><noscript><p>Search and filters require JavaScript; every catalogue entry remains visible above.</p></noscript></main>
<script>document.body.dataset.enhanced="";const q=document.querySelector("#q"),p=document.querySelector("#provider"),k=document.querySelector("#kind"),s=document.querySelector("#status"),cards=[...document.querySelectorAll(".card")];function apply(){const needle=q.value.trim().toLowerCase();let shown=0;for(const card of cards){const visible=(!needle||card.dataset.search.includes(needle))&&(!p.value||card.dataset.provider===p.value)&&(!k.value||card.dataset.kind===k.value);card.classList.toggle("hidden",!visible);if(visible)shown++}s.textContent=shown+" of "+cards.length+" entries shown"}q.addEventListener("input",apply);p.addEventListener("change",apply);k.addEventListener("change",apply);apply();</script></body></html>\n`;
}

function replaceBounded(text: string, markers: readonly [string, string], body: string, path: string): string {
  const start = text.indexOf(markers[0]);
  const end = text.indexOf(markers[1]);
  if (start < 0 || end <= start || text.indexOf(markers[0], start + 1) >= 0 || text.indexOf(markers[1], end + 1) >= 0) throw new Error(`${path} must contain exactly one ordered ${markers[0]} marker pair`);
  return `${text.slice(0, start + markers[0].length)}\n${body.trim()}\n${text.slice(end)}`;
}

export function buildGeneratedOutputs(options: GenerateDocsOptions): GeneratedOutput[] {
  const root = resolve(options.root);
  const commands = options.commands ?? COMMAND_MANIFEST;
  const sourceText = options.catalogueSourceText ?? readFileSync(join(root, "docs", "model-catalogue", "catalogue.source.json"), "utf8");
  const source = parseCatalogue(sourceText);
  const catalogue = generatedCatalogue(source);
  const commandReference = renderCommandReference(commands);
  const commandsDoc = readFileSync(join(root, "COMMANDS.md"), "utf8");
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const commandBody = "The complete manifest-derived reference is [docs/generated/commands.md](docs/generated/commands.md). Regenerate it with `npm run docs:generate`; verify drift with `npm run docs:check`.";
  const catalogueBody = `A dated, sanitized public snapshot is available as [HTML](docs/model-catalogue/index.html), [JSON](docs/model-catalogue/catalogue.json), and [Markdown](docs/generated/model-catalogue.md). It was generated at \`${catalogue.generatedAt}\` from the repository's public release notes. Runtime availability remains account-scoped; use \`aether models\` while signed in.`;
  const json = `${JSON.stringify(catalogue, null, 2)}\n`;
  return [
    { path: "docs/generated/commands.md", content: commandReference },
    { path: "docs/generated/model-catalogue.md", content: renderCatalogueMarkdown(catalogue) },
    { path: "docs/model-catalogue/catalogue.json", content: json },
    { path: "docs/model-catalogue/index.html", content: renderCatalogueHtml(catalogue) },
    { path: "COMMANDS.md", content: replaceBounded(commandsDoc, COMMAND_MARKERS, commandBody, "COMMANDS.md") },
    { path: "README.md", content: replaceBounded(readme, CATALOGUE_MARKERS, catalogueBody, "README.md") },
  ];
}

function writeAtomically(root: string, outputs: readonly GeneratedOutput[]): void {
  const staged: { path: string; temp: string; prior: string | null }[] = [];
  try {
    for (const output of outputs) {
      const path = join(root, output.path); mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.docs-tmp-${process.pid}`;
      writeFileSync(temp, output.content, "utf8");
      staged.push({ path, temp, prior: existsSync(path) ? readFileSync(path, "utf8") : null });
    }
    for (const item of staged) renameSync(item.temp, item.path);
  } catch (error) {
    for (const item of staged) {
      if (existsSync(item.temp)) rmSync(item.temp, { force: true });
      if (item.prior !== null && (!existsSync(item.path) || readFileSync(item.path, "utf8") !== item.prior)) writeFileSync(item.path, item.prior, "utf8");
      if (item.prior === null && existsSync(item.path)) rmSync(item.path, { force: true });
    }
    throw error;
  }
}

export function generateDocumentation(options: GenerateDocsOptions): GeneratedOutput[] {
  const root = resolve(options.root);
  const outputs = buildGeneratedOutputs({ ...options, root });
  if (options.check) {
    const drift = outputs.filter((output) => !existsSync(join(root, output.path)) || readFileSync(join(root, output.path), "utf8") !== output.content).map((output) => output.path);
    if (drift.length) throw new Error(`generated documentation drift: ${drift.join(", ")}; run npm run docs:generate`);
  } else writeAtomically(root, outputs);
  return outputs;
}

function main(): void {
  const root = process.cwd();
  const check = process.argv.slice(2).includes("--check");
  const outputs = generateDocumentation({ root, check });
  const verb = check ? "checked" : "generated";
  process.stdout.write(`${verb} ${outputs.length} documentation outputs\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) main();
