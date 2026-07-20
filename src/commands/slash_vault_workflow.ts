// In-REPL Vault + Workflow slash commands: /vault-* /workflow*. Split out of
// slash.ts (was 1807 lines) to keep each command group under the repo's
// ~800-line file convention.

import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import { getVaultSnapshot, searchNotes, notesByTag, getNotesTree } from "../core/vault.js";
import { WORKFLOW_TEMPLATES, listWorkflows } from "../core/workflow.js";

// ── Vault slash handlers ────────────────────────

export async function vaultStatusSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    const r = await getVaultSnapshot(ctx.api, 800);
    out.write(`vault: ${r.note_count} notes\n`);
  } catch {
    out.write("vault: unreachable\n");
  }
}

export async function vaultContextSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    await getVaultSnapshot(ctx.api, 2000);
    out.write("vault context loaded for next agent turn.\n");
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export async function vaultSearchSlash(ctx: AppContext, out: Writable, query: string): Promise<void> {
  if (!query) { out.write("usage: /vault-search <query>\n"); return; }
  try {
    const r = await searchNotes(ctx.api, query, { limit: 10 });
    if (r.results.length === 0) { out.write("no results.\n"); return; }
    for (const n of r.results) {
      out.write(`  ${n.title || n.path}  (${n.path})\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export async function vaultRecentSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  try {
    const n = Math.min(parseInt(arg) || 10, 50);
    const r = await searchNotes(ctx.api, "", { limit: n });
    if (r.results.length === 0) { out.write("(empty vault)\n"); return; }
    for (const row of r.results) {
      out.write(`  ${row.title || row.path}\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export async function vaultProjectSlash(ctx: AppContext, out: Writable, name: string): Promise<void> {
  if (!name) { out.write("usage: /vault-project <name>\n"); return; }
  try {
    const r = await searchNotes(ctx.api, "", { project: name, limit: 20 });
    if (r.results.length === 0) { out.write(`no notes for project: ${name}\n`); return; }
    for (const n of r.results) {
      out.write(`  ${n.title || n.path}  [${n.tags.join(", ")}]\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export async function vaultTagSlash(ctx: AppContext, out: Writable, tag: string): Promise<void> {
  if (!tag) { out.write("usage: /vault-tag <tag>\n"); return; }
  try {
    const r = await notesByTag(ctx.api, tag, 20);
    if (r.results.length === 0) { out.write(`no notes with tag: ${tag}\n`); return; }
    for (const n of r.results) {
      out.write(`  ${n.title || n.path}  (${n.path})\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export async function vaultTreeSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    const r = await getNotesTree(ctx.api);
    if (r.tree.length === 0) { out.write("(empty vault)\n"); return; }
    for (const e of r.tree) {
      out.write(`  ${e.folder || "/"}  (${e.count} notes)\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── Workflow slash handlers ─────────────────────

export async function workflowSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    const workflows = await listWorkflows(ctx.api);
    out.write(`workflow: ${workflows.length} in vault  ·  ${WORKFLOW_TEMPLATES.length} templates available\n`);
    if (workflows.length > 0) {
      for (const w of workflows.slice(0, 5)) out.write(`  ${w.name}  (${Math.round(w.size/1024)} KB)\n`);
    }
  } catch {
    out.write("workflow: unavailable\n");
  }
}

export async function workflowTemplatesSlash(_ctx: AppContext, out: Writable): Promise<void> {
  for (let i = 0; i < WORKFLOW_TEMPLATES.length; i++) {
    const t = WORKFLOW_TEMPLATES[i]!;
    out.write(`  ${String(i+1)}. ${t.icon} ${t.name}  (${t.category}, ${t.difficulty})\n`);
  }
  out.write("load: /workflow-template <n>\n");
}

export async function workflowTemplateSlash(_ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const n = parseInt(arg);
  if (isNaN(n) || n < 1 || n > WORKFLOW_TEMPLATES.length) {
    out.write(`invalid: ${arg} (1-${WORKFLOW_TEMPLATES.length})\n`);
    return;
  }
  const t = WORKFLOW_TEMPLATES[n - 1]!;
  out.write(`${t.icon} ${t.name}: ${t.subtitle}\n`);
  out.write(`  ${t.workflow.nodes?.length || 0} nodes · ${t.workflow.edges?.length || 0} edges\n`);
  out.write(`  save with: aether workflow save ${t.id}\n`);
}
