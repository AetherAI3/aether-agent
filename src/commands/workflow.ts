// aether workflow — 15 subcommands for workflow management from the terminal
// Follows the exact pattern of aether vault and aether github

import type { AppContext } from "../core/context.js";
import {
  WORKFLOW_TEMPLATES,
  listWorkflows, getWorkflow, deleteWorkflow,
  assessWorkflow, brainstormWorkflow, planWorkflow, finalizeWorkflow,
  formatWorkflowSummary, formatWorkflowDetail,
  type Workflow, type TemplateInfo,
  type WorkflowAssessResponse, type WorkflowBrainstormResponse,
} from "../core/workflow.js";

export async function cmdWorkflow(ctx: AppContext, argv: string[]): Promise<number> {
  const sub = (argv[0] ?? "status").toLowerCase();
  switch (sub) {
    case "new":        return workflowNew(ctx, argv.slice(1).join(" "));
    case "list":       return workflowList(ctx);
    case "view":       return workflowView(ctx, argv[1]);
    case "save":       return notYet("workflow save");
    case "delete":     return workflowDelete(ctx, argv[1]);
    case "export":     return notYet("workflow export");
    case "import":     return notYet("workflow import");
    case "assess":     return workflowAssess(ctx, argv[1]);
    case "brainstorm": return workflowBrainstorm(ctx, argv[1]);
    case "plan":       return workflowPlan(ctx, argv[1]);
    case "finalize":   return workflowFinalize(ctx, argv[1]);
    case "templates":  return workflowTemplates(ctx);
    case "template":   return workflowTemplateLoad(ctx, argv[1]);
    case "status":     return workflowStatus(ctx);
    case "help":
    case "":           printWorkflowHelp(); return 0;
    default:
      process.stderr.write(`unknown: aether workflow ${sub}\n`);
      printWorkflowHelp();
      return 2;
  }
}

function notYet(feature: string): Promise<number> {
  process.stderr.write(`${feature} — coming soon (multipart upload/download plumbing needed).\n`);
  return Promise.resolve(1);
}

function printWorkflowHelp(): void {
  process.stdout.write([
    "aether workflow new <desc>      Generate a workflow from intent (AI-driven)",
    "aether workflow list             List workflows stored in vault",
    "aether workflow view <name>      View a workflow's structure in detail",
    "aether workflow save <name>      Save workflow JSON to vault (coming soon)",
    "aether workflow delete <name>    Delete a workflow from vault",
    "aether workflow export <name>    Download .aetherflow.json (coming soon)",
    "aether workflow import <file>    Upload .aetherflow.json to vault (coming soon)",
    "aether workflow assess <name>    Check workflow → project convertibility",
    "aether workflow brainstorm <n>   Socratic Q&A to refine for project",
    "aether workflow plan <name>      Generate plan.md from workflow",
    "aether workflow finalize <name>  Create project from workflow",
    "aether workflow templates        List 8 built-in workflow templates",
    "aether workflow template <n>     Load a template by number",
    "aether workflow status           Show workflow + vault dashboard",
    "",
  ].join("\n"));
}

// ── Handlers ─────────────────────────────────────

async function workflowNew(ctx: AppContext, description: string): Promise<number> {
  if (!description) { process.stderr.write("usage: aether workflow new <description>\n"); return 1; }
  process.stdout.write(`generating workflow from: "${description}"...\n`);
  process.stdout.write("(this sends your intent to the AI — the model will brainstorm a workflow draft)\n\n");
  // For now: show what would happen. Full SSE streaming deferred.
  process.stdout.write(
    "AI-driven workflow generation requires an authenticated chat session.\n" +
    "Run: aether agent \"[WORKFLOW_MODE] " + description + "\"\n" +
    "The model will emit <aether-workflow-draft> fences with the generated workflow.\n\n" +
    "Tip: this will be fully automated in the next release.\n",
  );
  return 0;
}

async function workflowList(ctx: AppContext): Promise<number> {
  try {
    const workflows = await listWorkflows(ctx.api);
    if (workflows.length === 0) {
      process.stdout.write("No workflows found in vault.\n");
      process.stdout.write("Create one with: aether workflow new \"your description\"\n");
      process.stdout.write("Or load a template: aether workflow templates\n");
      return 0;
    }
    for (const w of workflows) {
      const sizeKB = Math.round(w.size / 1024);
      process.stdout.write(`  ${w.name}  (${sizeKB} KB)  ${w.lastModified}\n`);
    }
    process.stdout.write(`\n${workflows.length} workflows in vault\n`);
    return 0;
  } catch (err) { return fail(err); }
}

async function workflowView(ctx: AppContext, name?: string): Promise<number> {
  if (!name) { process.stderr.write("usage: aether workflow view <name>\n"); return 1; }
  try {
    const wf = await getWorkflow(ctx.api, name);
    if (!wf) {
      process.stdout.write(`workflow not found: ${name}\n`);
      process.stdout.write("check available workflows: aether workflow list\n");
      return 1;
    }
    process.stdout.write(formatWorkflowDetail(wf) + "\n");
    return 0;
  } catch (err) { return fail(err); }
}

async function workflowDelete(ctx: AppContext, name?: string): Promise<number> {
  if (!name) { process.stderr.write("usage: aether workflow delete <name>\n"); return 1; }
  try {
    const ok = await ctx.confirm(`Delete workflow "${name}" from vault? [y/N] `);
    if (!ok) { process.stdout.write("cancelled.\n"); return 0; }
    const deleted = await deleteWorkflow(ctx.api, name);
    if (deleted) {
      process.stdout.write(`deleted: ${name}\n`);
    } else {
      process.stdout.write(`delete failed — workflow may not exist: ${name}\n`);
    }
    return deleted ? 0 : 1;
  } catch (err) { return fail(err); }
}

async function workflowAssess(ctx: AppContext, name?: string): Promise<number> {
  if (!name) { process.stderr.write("usage: aether workflow assess <name>\n"); return 1; }
  try {
    const wf = await getWorkflow(ctx.api, name);
    if (!wf) { process.stdout.write(`workflow not found: ${name}\n`); return 1; }
    const r = await assessWorkflow(ctx.api, wf);
    process.stdout.write(`readiness: ${r.validation.state}\n`);
    process.stdout.write(r.summary + "\n");
    if (!r.convertible) {
      process.stdout.write("\nissues:\n");
      for (const issue of r.validation.issues) {
        process.stdout.write(`  [${issue.severity}] ${issue.message}\n`);
      }
    }
    if (r.suggested_brainstorm_questions.length > 0) {
      process.stdout.write("\nbrainstorm questions:\n");
      for (const q of r.suggested_brainstorm_questions) {
        process.stdout.write(`  ? ${q}\n`);
      }
    }
    return r.convertible ? 0 : 1;
  } catch (err) { return fail(err); }
}

async function workflowBrainstorm(ctx: AppContext, name?: string): Promise<number> {
  if (!name) { process.stderr.write("usage: aether workflow brainstorm <name>\n"); return 1; }
  try {
    const wf = await getWorkflow(ctx.api, name);
    if (!wf) { process.stdout.write(`workflow not found: ${name}\n`); return 1; }
    process.stdout.write(`brainstorming: ${wf.name}\n`);
    process.stdout.write("(Socratic Q&A — answer each question to refine the project plan)\n\n");
    // Interactive Q&A loop
    const rl = require("node:readline").createInterface({ input: process.stdin, output: process.stdout });
    const qaHistory: Array<{ q: string; a: string }> = [];
    let nextIndex = 0;
    const ask = (): Promise<string> => new Promise(resolve => {
      rl.question("> ", (answer: string) => { resolve(answer.trim()); });
    });
    let r: WorkflowBrainstormResponse;
    do {
      r = await brainstormWorkflow(ctx.api, wf, qaHistory, nextIndex);
      if (r.done) break;
      if (r.next_question) {
        process.stdout.write(`  ${r.next_question}\n`);
        const answer = await ask();
        qaHistory.push({ q: r.next_question, a: answer });
        nextIndex++;
      }
    } while (!r.done);
    rl.close();
    if (r.summary) {
      process.stdout.write(`\n${r.summary}\n`);
    }
    process.stdout.write("\nbrainstorm complete. Next: aether workflow plan " + name + "\n");
    return 0;
  } catch (err) { return fail(err); }
}

async function workflowPlan(ctx: AppContext, name?: string): Promise<number> {
  if (!name) { process.stderr.write("usage: aether workflow plan <name>\n"); return 1; }
  try {
    const wf = await getWorkflow(ctx.api, name);
    if (!wf) { process.stdout.write(`workflow not found: ${name}\n`); return 1; }
    const r = await planWorkflow(ctx.api, wf);
    process.stdout.write(r.plan_md + "\n");
    process.stdout.write("plan.md generated. Next: aether workflow finalize " + name + "\n");
    return 0;
  } catch (err) { return fail(err); }
}

async function workflowFinalize(ctx: AppContext, name?: string): Promise<number> {
  if (!name) { process.stderr.write("usage: aether workflow finalize <name>\n"); return 1; }
  try {
    const wf = await getWorkflow(ctx.api, name);
    if (!wf) { process.stdout.write(`workflow not found: ${name}\n`); return 1; }
    // First generate the plan
    const planR = await planWorkflow(ctx.api, wf);
    if (!planR.plan_md) {
      process.stdout.write("plan generation returned empty — run 'aether workflow brainstorm " + name + "' first.\n");
      return 1;
    }
    const r = await finalizeWorkflow(ctx.api, wf, planR.plan_md);
    process.stdout.write(`project created: ${r.project_id}\n`);
    if (r.plan_md) {
      process.stdout.write(`plan.md: ${r.plan_md.length} chars\n`);
    }
    return 0;
  } catch (err) { return fail(err); }
}

async function workflowTemplates(ctx: AppContext): Promise<number> {
  process.stdout.write("Workflow Templates:\n\n");
  for (let i = 0; i < WORKFLOW_TEMPLATES.length; i++) {
    const t = WORKFLOW_TEMPLATES[i]!;
    process.stdout.write(
      `  ${String(i + 1).padStart(2)}. ${t.icon} ${t.name}\n` +
      `      ${t.subtitle}\n` +
      `      ${t.category} · ${t.difficulty} · ${t.estimatedSetup} · ${t.agentCount} agents\n` +
      `      nodes: ${t.nodePreview.join(" → ")}\n\n`,
    );
  }
  process.stdout.write("load a template: aether workflow template <n>\n");
  return 0;
}

async function workflowTemplateLoad(ctx: AppContext, arg?: string): Promise<number> {
  if (!arg) { process.stderr.write("usage: aether workflow template <n>\n"); return 1; }
  const n = parseInt(arg);
  if (isNaN(n) || n < 1 || n > WORKFLOW_TEMPLATES.length) {
    process.stderr.write(`invalid template number: ${arg} (1-${WORKFLOW_TEMPLATES.length})\n`);
    return 1;
  }
  const t = WORKFLOW_TEMPLATES[n - 1]!;
  process.stdout.write(`${t.icon} ${t.name}\n${t.subtitle}\n\n`);
  process.stdout.write(formatWorkflowDetail(t.workflow) + "\n");
  return 0;
}

async function workflowStatus(ctx: AppContext): Promise<number> {
  try {
    const workflows = await listWorkflows(ctx.api);
    process.stdout.write(
      `workflow: ✓ reachable\n` +
      `  vault:  ${workflows.length} workflows stored\n` +
      `  templates: ${WORKFLOW_TEMPLATES.length} available\n`,
    );
    if (workflows.length > 0) {
      const totalKB = Math.round(workflows.reduce((s, w) => s + w.size, 0) / 1024);
      process.stdout.write(`  storage: ~${totalKB} KB\n`);
    }
    return 0;
  } catch (err) { return fail(err); }
}

// ── Helpers ──────────────────────────────────────

function fail(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`✗ ${msg}\n  (are you logged in? run: aether auth login)\n`);
  return 1;
}