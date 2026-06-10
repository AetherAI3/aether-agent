# Workflow Command System — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a complete `/workflow` command system to aether-agent, enabling users to generate, view, save, and convert AetherCloud workflows directly from the terminal. Workflows are stored as `.aetherflow.json` files in the user's vault (cloud storage). The system bridges the terminal to the same workflow canvas, AI directive, and project-conversion pipeline that the desktop app uses.

**Architecture:** Three-layer design. **Storage layer** uses the existing vault (`.aetherflow.json` files in DO Spaces via `/vault/spaces/*` endpoints). **AI layer** uses the existing chat stream with `[WORKFLOW_MODE]` marker to trigger the backend's workflow directive injection and fence parser. **Conversion layer** uses the existing `/project/from-workflow/*` endpoints. The CLI adds a single new command module (`src/commands/workflow.ts`) and a thin core module (`src/core/workflow.ts`) with embedded templates and API wrappers.

**Tech Stack:** TypeScript, Node.js, no new dependencies. Reuses existing `vault.ts` API client and `transport.ts` routes.

---

## Current State

| Layer | Status |
|---|---|
| Desktop app | Full workflow canvas editor, AI ops, templates, local electron-store persistence |
| Backend AI | Workflow directive injection via `[WORKFLOW_MODE]` marker, fence parsing (`<aether-workflow-op>`, `<aether-workflow-draft>`) |
| Backend Conversion | `/project/from-workflow/assess|brainstorm|plan|finalize` endpoints |
| Backend Brainstorm | `lib/workflow_brainstorm.py` — generates workflow JSON from natural language intent |
| Backend Schema | `lib/workflow_op_schema.py` — 7 node types, 13 op names, validation |
| Backend Templates | 8 curated templates in `desktop/pages/workflow/data/templates.js` |
| Vault Storage | No workflow-specific API — but `.aetherflow.json` can be stored as regular vault files |
| CLI (aether-agent) | **ZERO workflow integration** |
| CLI (vault commands) | Upload/download/list/delete already implemented (Task 1-6 from vault PR) |

## Key Architecture Decisions

1. **Storage: Vault (cloud), not local.** Unlike the desktop app which uses electron-store, the terminal stores workflows as `.aetherflow.json` files in the user's DO Spaces vault. This means workflows sync across all surfaces — create on desktop, access on terminal, and vice versa.

2. **No new backend endpoints needed.** Workflow files go through the existing vault upload/download/list infrastructure. Project conversion uses existing endpoints. The AI generation goes through the existing chat stream.

3. **Templates are embedded in the CLI.** The 8 curated templates are bundled as TypeScript data in `core/workflow.ts` — no network fetch needed, always available offline.

4. **Workflow generation reuses the chat stream.** When a user types `/workflow-new`, the CLI sends the description to the chat endpoint with `meta.workflow_json` set, and the backend injects the `WORKFLOW_AI_DIRECTIVE`. The model responds with `<aether-workflow-draft>` fences which the CLI parses.

5. **Parse `<aether-workflow-draft>` from SSE stream.** The CLI implements a lightweight streaming fence parser (port of `ai-op-parser.js`) to extract workflow JSON from the SSE response.

---

## Design: Workflow Data Model

```typescript
interface WorkflowNode {
  id: string;
  type: "goal" | "feature" | "agent_role" | "data_source" | "condition" | "trigger" | "output";
  title: string;
  description?: string;
  lane: "primary" | "subresource";
  position: { x: number; y: number };
  metadata: Record<string, string>;
}

interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
}

interface Workflow {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  subResourceLinks: WorkflowEdge[];
}
```

## Design: Command Surface

### Top-Level: `aether workflow <subcommand> [args]`

```
aether workflow new <description>    Generate a new workflow from intent (AI-driven)
aether workflow list                 List all .aetherflow.json files in vault
aether workflow view <name>          View a workflow's structure in terminal
aether workflow save <name>          Save current workflow JSON to vault
aether workflow delete <name>        Delete a workflow from vault
aether workflow export <name>        Download .aetherflow.json to local disk
aether workflow import <file>        Upload a local .aetherflow.json to vault
aether workflow assess <name>        Validate workflow → project convertibility
aether workflow brainstorm <name>    Start Socratic Q&A for project conversion
aether workflow plan <name>          Generate plan.md from workflow
aether workflow finalize <name>      Convert workflow into a runnable project
aether workflow templates            List built-in workflow templates
aether workflow template <n>         Load a template by number
aether workflow status               Show current workflow + vault status
aether workflow help                 Show this help
```

### In-REPL Slash Commands

```
/workflow                    Show current workflow status
/workflow-new <description>   Generate a workflow from intent
/workflow-view <name>         View a workflow from vault
/workflow-to-project <name>   Convert a workflow to a project
/workflow-templates           List built-in templates
/workflow-template <n>        Load template by number
```

---

## Design: File Structure

```
src/core/workflow.ts          NEW — types, templates, fence parser, API wrappers
src/commands/workflow.ts      NEW — CLI command dispatch + handlers
src/core/transport.ts         MODIFY — add project conversion route constants
src/main.ts                   MODIFY — add "workflow" case, import, help text
src/commands/slash.ts         MODIFY — add /workflow slash commands
```

---

## Step-by-Step Tasks

### Task 1: Add project conversion route constants to transport.ts

**Files:** Modify `src/core/transport.ts`

Add after the existing vault paths:

```typescript
// ── Project conversion (workflow → project) ─────
export const PROJECT_FROM_WORKFLOW_ASSESS_PATH = "/project/from-workflow/assess";
export const PROJECT_FROM_WORKFLOW_BRAINSTORM_PATH = "/project/from-workflow/brainstorm";
export const PROJECT_FROM_WORKFLOW_PLAN_PATH = "/project/from-workflow/plan";
export const PROJECT_FROM_WORKFLOW_FINALIZE_PATH = "/project/from-workflow/finalize";
```

### Task 2: Create workflow core module (types, templates, fence parser, API wrappers)

**Files:** Create `src/core/workflow.ts`

**Part A: Type definitions**

```typescript
export interface WorkflowNode {
  id: string; type: string; title: string; description?: string;
  lane: string; position: { x: number; y: number };
  metadata: Record<string, string>;
}
export interface WorkflowEdge { id: string; from: string; to: string; }
export interface Workflow {
  id: string; name: string; description?: string;
  createdAt: string; updatedAt: string;
  nodes: WorkflowNode[]; edges: WorkflowEdge[]; subResourceLinks: WorkflowEdge[];
}
export interface WorkflowAssessResponse {
  convertible: boolean; reason: string | null; summary: string;
  suggested_brainstorm_questions: string[];
  draft_preview: Record<string, unknown>;
  validation: { state: string; issues: Array<{ severity: string; message: string }> };
}
export interface WorkflowBrainstormResponse {
  done: boolean; next_question?: string; summary?: string;
}
export interface WorkflowPlanResponse { plan_md: string; plan_metadata: Record<string, unknown>; }
export interface WorkflowFinalizeResponse {
  project_id: string; artifact: Record<string, unknown>; plan_md: string;
}
```

**Part B: 8 embedded templates** (abridged — full set of 8 templates from `desktop/pages/workflow/data/templates.js`, ported to TypeScript objects):

```typescript
export const WORKFLOW_TEMPLATES = [
  { id: "lead-enrichment", name: "Lead Enrichment & CRM Routing", category: "Sales", ... },
  { id: "support-triage", name: "Support Ticket Triage", category: "Support", ... },
  // ... 6 more
];
```

**Part C: Streaming fence parser** — lightweight port of `ai-op-parser.js`:

```typescript
const DRAFT_OPEN = "<aether-workflow-draft>";
const DRAFT_CLOSE = "</aether-workflow-draft>";

export function createFenceParser() {
  let buf = "";
  return {
    feed(chunk: string): { drafts: Workflow[]; remainder: string } {
      buf += chunk;
      const drafts: Workflow[] = [];
      let progress = true;
      while (progress) {
        progress = false;
        const dStart = buf.indexOf(DRAFT_OPEN);
        if (dStart !== -1) {
          const dEnd = buf.indexOf(DRAFT_CLOSE, dStart + DRAFT_OPEN.length);
          if (dEnd !== -1) {
            const payload = buf.slice(dStart + DRAFT_OPEN.length, dEnd);
            try { drafts.push(JSON.parse(payload)); } catch { /* skip bad JSON */ }
            buf = buf.slice(0, dStart) + buf.slice(dEnd + DRAFT_CLOSE.length);
            progress = true;
          }
        }
      }
      const remainder = buf; buf = ""; return { drafts, remainder };
    },
    reset() { buf = ""; },
  };
}
```

**Part D: API wrapper functions** — thin wrappers calling existing endpoints:

```typescript
import { ApiClient, PROJECT_FROM_WORKFLOW_ASSESS_PATH, PROJECT_FROM_WORKFLOW_BRAINSTORM_PATH, PROJECT_FROM_WORKFLOW_PLAN_PATH, PROJECT_FROM_WORKFLOW_FINALIZE_PATH } from "./transport.js";

export async function assessWorkflow(api: ApiClient, workflow: Workflow): Promise<WorkflowAssessResponse> {
  return api.postJson(PROJECT_FROM_WORKFLOW_ASSESS_PATH, { workflow });
}
export async function brainstormWorkflow(api: ApiClient, workflow: Workflow, qaHistory: Array<{q: string; a: string}> = [], nextIndex = 0): Promise<WorkflowBrainstormResponse> {
  return api.postJson(PROJECT_FROM_WORKFLOW_BRAINSTORM_PATH, { workflow, qa_history: qaHistory, next_index: nextIndex });
}
export async function planWorkflow(api: ApiClient, workflow: Workflow, brainstormSummary = "", mode?: string): Promise<WorkflowPlanResponse> {
  return api.postJson(PROJECT_FROM_WORKFLOW_PLAN_PATH, { workflow, brainstorm_summary: brainstormSummary, mode });
}
export async function finalizeWorkflow(api: ApiClient, workflow: Workflow, planMd: string): Promise<WorkflowFinalizeResponse> {
  return api.postJson(PROJECT_FROM_WORKFLOW_FINALIZE_PATH, { workflow, plan_md: planMd, edited_by_user: false });
}
```

**Part E: Vault-based workflow CRUD** — wraps existing vault API functions with `.aetherflow.json` naming convention:

```typescript
import { getSpacesContent, listSpaces, deleteSpacesFile, type VaultSpacesFile } from "./vault.js";

const WF_EXT = ".aetherflow.json";

export async function listWorkflows(api: ApiClient): Promise<Array<{ name: string; file: VaultSpacesFile }>> {
  const r = await listSpaces(api);
  return r.files.filter(f => f.filename.endsWith(WF_EXT)).map(f => ({
    name: f.filename.replace(/\.aetherflow\.json$/, ""),
    file: f,
  }));
}

export async function getWorkflow(api: ApiClient, name: string): Promise<Workflow | null> {
  const filename = name.endsWith(WF_EXT) ? name : `${name}${WF_EXT}`;
  try {
    const r = await getSpacesContent(api, filename);
    if (r.binary || !r.content) return null;
    return JSON.parse(r.content) as Workflow;
  } catch { return null; }
}

export async function saveWorkflowToVault(api: ApiClient, workflow: Workflow): Promise<void> {
  // Upload via fetch with FormData — deferred; for now, use vault upload endpoint
  // TODO: implement multipart upload
}

export { deleteSpacesFile as deleteWorkflow }; // re-export with semantic name
```

### Task 3: Create workflow CLI command module

**Files:** Create `src/commands/workflow.ts`

Follows the exact pattern of `src/commands/vault.ts` (subcommand dispatch + handlers + renderers). Key subcommands:

- `new <description>` — sends to chat with WORKFLOW_MODE, parses fence, prints draft
- `list` — lists .aetherflow.json files from vault
- `view <name>` — fetches + pretty-prints workflow structure
- `save <name>` — saves workflow JSON to vault
- `delete <name>` — deletes from vault (with confirmation)
- `export <name>` — downloads .aetherflow.json
- `import <file>` — uploads local .aetherflow.json
- `assess <name>` — POST to /from-workflow/assess, show readiness
- `brainstorm <name>` — interactive Socratic Q&A loop
- `plan <name>` — generate plan.md
- `finalize <name>` — create project
- `templates` — list 8 templates with numbers
- `template <n>` — load template, show structure
- `status` — show vault workflow count + storage
- `help` — full help text

### Task 4: Wire workflow into main.ts

**Files:** Modify `src/main.ts`

- Import `cmdWorkflow` from `./commands/workflow.js`
- Add `case "workflow": return cmdWorkflow(ctx, rest);` to switch
- Add help lines to HELP string

### Task 5: Add workflow slash commands to REPL

**Files:** Modify `src/commands/slash.ts`

- Add imports from `../core/workflow.js`
- Add cases: `workflow`, `workflow-new`, `workflow-view`, `workflow-to-project`, `workflow-templates`, `workflow-template`
- Add handler functions
- Update help text

### Task 6: Build and verify

- `npx tsc --noEmit` — zero errors
- `node dist/src/main.js workflow help` — renders help
- `node dist/src/main.js workflow templates` — lists 8 templates
- `node dist/src/main.js workflow list` — handles unauthenticated gracefully
- `node dist/src/main.js workflow assess <name>` — hits backend (401 expected without auth)

---

## Implementation Order

| Order | Task | File | Complexity |
|---|---|---|---|
| 1 | Add route constants | transport.ts | Trivial |
| 2 | Create workflow core module | core/workflow.ts | High (types + templates + parser + APIs) |
| 3 | Create workflow CLI command | commands/workflow.ts | High (15 subcommands) |
| 4 | Wire into main.ts | main.ts | Trivial |
| 5 | Add slash commands | slash.ts | Medium |
| 6 | Build + verify | — | Verification |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| No dedicated workflow CRUD API on backend | Store as .aetherflow.json files in vault (cloud); reuse vault upload/download endpoints |
| Workflow generation requires chat SSE and fence parsing | Port the existing `ai-op-parser.js` fence parser to TypeScript as a streaming parser |
| Brainstorm endpoint requires interactive Q&A loop | Implement as `aether workflow brainstorm <name>` with readline-based Q&A |
| Templates only exist in desktop JS | Embed all 8 templates as TypeScript consts in core/workflow.ts |
| Upload requires multipart FormData | Defer `workflow save` to follow-up; `workflow export` downloads, user uploads via `vault upload` |
| Fence parser must handle split SSE chunks | Buffer partial fences across calls — exact port of the desktop parser's buffering logic |

## UX Design Notes

- **Workflow commands feel like project commands, not vault commands.** Even though workflows are stored in the vault, the UX talks about "workflows" — the vault is an implementation detail. `aether workflow list` not `aether vault list workflows`.
- **Progressive disclosure.** `workflow status` gives a one-line overview. `workflow view` shows full structure. `workflow templates` shows the catalog.
- **Confirmation for destructive ops.** `delete` prompts y/N via `ctx.confirm()`.
- **Graceful empty state.** "No workflows found in vault. Create one with: aether workflow new 'description'"
- **Template → instant draft.** `workflow template 1` loads Lead Enrichment template and shows the full node/edge structure immediately.
