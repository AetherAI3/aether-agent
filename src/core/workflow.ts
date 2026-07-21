// src/core/workflow.ts — workflow types, templates, fence parser, API wrappers
// Uses vault for .aetherflow.json storage; project conversion via backend endpoints.

import { ApiClient } from "./transport.js";
import {
  PROJECT_FROM_WORKFLOW_ASSESS_PATH, PROJECT_FROM_WORKFLOW_BRAINSTORM_PATH,
  PROJECT_FROM_WORKFLOW_PLAN_PATH, PROJECT_FROM_WORKFLOW_FINALIZE_PATH,
  defaultStreamTimeoutMs,
} from "./transport.js";
import { listSpaces, getSpacesContent, deleteSpacesFile, uploadFile, downloadFile } from "./vault.js";

// ── Types ───────────────────────────────────────

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

export interface WorkflowPlanResponse {
  plan_md: string; plan_metadata: Record<string, unknown>;
}

export interface WorkflowFinalizeResponse {
  project_id: string; artifact: Record<string, unknown>; plan_md: string;
}

export interface TemplateInfo {
  id: string; name: string; subtitle: string;
  category: string; categoryColor: string;
  difficulty: string; estimatedSetup: string;
  trigger: string; apps: string[]; agentCount: number;
  nodePreview: string[]; icon: string;
  workflow: Workflow;
}

export interface WorkflowListItem { name: string; filename: string; size: number; lastModified: string; }

// ── 8 Curated Templates ─────────────────────────

function tplLeadEnrichment(): Workflow {
  return {
    id: "tpl-lead-enrichment", name: "Lead Enrichment & CRM Routing",
    createdAt: "", updatedAt: "",
    nodes: [
      { id: "goal-001", type: "goal", title: "Convert 30% of inbound leads", lane: "primary", position: { x: 440, y: 60 }, metadata: { northStar: "Every inbound lead is scored and routed within 5 minutes." } },
      { id: "trig-001", type: "trigger", title: "Form submitted", lane: "primary", position: { x: 80, y: 260 }, metadata: { event: "form.submit" } },
      { id: "feat-001", type: "feature", title: "Enrich lead data", lane: "primary", position: { x: 280, y: 260 }, metadata: { acceptance: "Company size, industry, and job title are appended within 30s." } },
      { id: "cond-001", type: "condition", title: "Score >= 70", lane: "primary", position: { x: 480, y: 260 }, metadata: { expression: "lead.score >= 70", target: "feat-002" } },
      { id: "feat-002", type: "feature", title: "CRM upsert", lane: "primary", position: { x: 680, y: 260 }, metadata: { acceptance: "Lead record created or updated in CRM with enrichment data." } },
      { id: "out-001", type: "output", title: "Slack notification", lane: "primary", position: { x: 880, y: 260 }, metadata: { deliverable: "Assigned rep notified in #sales-leads with lead summary card." } },
      { id: "agent-001", type: "agent_role", title: "Lead Scorer", lane: "subresource", position: { x: 480, y: 460 }, metadata: { roleName: "Lead Scorer", assignedAgentId: "" } },
    ],
    edges: [
      { id: "e1", from: "trig-001", to: "feat-001" }, { id: "e2", from: "feat-001", to: "cond-001" },
      { id: "e3", from: "cond-001", to: "feat-002" }, { id: "e4", from: "feat-002", to: "out-001" },
    ],
    subResourceLinks: [{ id: "sr1", from: "agent-001", to: "cond-001" }],
  };
}

function tplSupportTriage(): Workflow {
  return {
    id: "tpl-support-triage", name: "Support Ticket Triage",
    createdAt: "", updatedAt: "",
    nodes: [
      { id: "goal-100", type: "goal", title: "Zero P1 tickets unassigned > 15m", lane: "primary", position: { x: 440, y: 60 }, metadata: { northStar: "No P1 ticket sits unassigned for more than 15 minutes." } },
      { id: "trig-100", type: "trigger", title: "Ticket received", lane: "primary", position: { x: 80, y: 260 }, metadata: { event: "ticket.created" } },
      { id: "feat-100", type: "feature", title: "AI classify severity", lane: "primary", position: { x: 280, y: 260 }, metadata: { acceptance: "Ticket classified P1-P4 with confidence score > 0.85." } },
      { id: "cond-100", type: "condition", title: "Severity >= P2", lane: "primary", position: { x: 480, y: 260 }, metadata: { expression: "severity <= 2", target: "feat-101" } },
      { id: "feat-101", type: "feature", title: "Auto-assign agent", lane: "primary", position: { x: 680, y: 260 }, metadata: { acceptance: "Ticket assigned to best available agent based on skill match." } },
      { id: "out-100", type: "output", title: "Notify team", lane: "primary", position: { x: 880, y: 260 }, metadata: { deliverable: "Slack alert in #support with ticket summary and assignment." } },
      { id: "agent-100", type: "agent_role", title: "Triage Bot", lane: "subresource", position: { x: 280, y: 460 }, metadata: { roleName: "Triage Bot", assignedAgentId: "" } },
    ],
    edges: [
      { id: "e100", from: "trig-100", to: "feat-100" }, { id: "e101", from: "feat-100", to: "cond-100" },
      { id: "e102", from: "cond-100", to: "feat-101" }, { id: "e103", from: "feat-101", to: "out-100" },
    ],
    subResourceLinks: [{ id: "sr100", from: "agent-100", to: "feat-100" }],
  };
}

function tplOnboarding(): Workflow {
  return {
    id: "tpl-onboarding", name: "Customer Onboarding",
    createdAt: "", updatedAt: "",
    nodes: [
      { id: "goal-200", type: "goal", title: "Lift D7 activation by 20%", lane: "primary", position: { x: 440, y: 60 }, metadata: { northStar: "Every new user reaches their first aha moment within 7 days." } },
      { id: "trig-200", type: "trigger", title: "On signup", lane: "primary", position: { x: 80, y: 260 }, metadata: { event: "user.signup" } },
      { id: "feat-200", type: "feature", title: "Personalized welcome email", lane: "primary", position: { x: 280, y: 260 }, metadata: { acceptance: "Email sent within 60s of signup with user first name." } },
      { id: "cond-200", type: "condition", title: "User opened email", lane: "primary", position: { x: 480, y: 260 }, metadata: { expression: "email.opened == true", target: "feat-201" } },
      { id: "feat-201", type: "feature", title: "Onboarding checklist", lane: "primary", position: { x: 680, y: 260 }, metadata: { acceptance: "Checklist created with 5 activation steps personalized to plan." } },
      { id: "out-200", type: "output", title: "Activation report", lane: "primary", position: { x: 880, y: 260 }, metadata: { deliverable: "Weekly D7 activation dashboard with cohort breakdowns." } },
      { id: "agent-200", type: "agent_role", title: "Email Composer", lane: "subresource", position: { x: 280, y: 460 }, metadata: { roleName: "Email Composer", assignedAgentId: "" } },
      { id: "agent-201", type: "agent_role", title: "Onboarding Coach", lane: "subresource", position: { x: 680, y: 460 }, metadata: { roleName: "Onboarding Coach", assignedAgentId: "" } },
    ],
    edges: [
      { id: "e200", from: "trig-200", to: "feat-200" }, { id: "e201", from: "feat-200", to: "cond-200" },
      { id: "e202", from: "cond-200", to: "feat-201" }, { id: "e203", from: "feat-201", to: "out-200" },
    ],
    subResourceLinks: [{ id: "sr200", from: "agent-200", to: "feat-200" }, { id: "sr201", from: "agent-201", to: "feat-201" }],
  };
}

function tplContentRepurpose(): Workflow {
  return {
    id: "tpl-content-repurpose", name: "Content Repurposing Pipeline",
    createdAt: "", updatedAt: "",
    nodes: [
      { id: "goal-300", type: "goal", title: "Publish weekly across 3 channels", lane: "primary", position: { x: 440, y: 60 }, metadata: { northStar: "One source piece becomes 3+ publishable assets every week." } },
      { id: "trig-300", type: "trigger", title: "Content calendar due", lane: "primary", position: { x: 80, y: 260 }, metadata: { event: "calendar.due_date" } },
      { id: "feat-300", type: "feature", title: "Summarize & extract", lane: "primary", position: { x: 280, y: 260 }, metadata: { acceptance: "Key points, quotes, and metadata extracted from source." } },
      { id: "feat-301", type: "feature", title: "Rewrite for channels", lane: "primary", position: { x: 480, y: 260 }, metadata: { acceptance: "Blog, Twitter thread, and LinkedIn post generated from summary." } },
      { id: "cond-300", type: "condition", title: "Editorial approved", lane: "primary", position: { x: 680, y: 260 }, metadata: { expression: "review.status == approved", target: "out-300" } },
      { id: "out-300", type: "output", title: "Published assets", lane: "primary", position: { x: 880, y: 260 }, metadata: { deliverable: "Live posts across blog, Twitter, and LinkedIn." } },
      { id: "agent-300", type: "agent_role", title: "Writer", lane: "subresource", position: { x: 280, y: 460 }, metadata: { roleName: "AI Writer", assignedAgentId: "" } },
      { id: "agent-301", type: "agent_role", title: "Editor", lane: "subresource", position: { x: 680, y: 460 }, metadata: { roleName: "Editor", assignedAgentId: "" } },
    ],
    edges: [
      { id: "e300", from: "trig-300", to: "feat-300" }, { id: "e301", from: "feat-300", to: "feat-301" },
      { id: "e302", from: "feat-301", to: "cond-300" }, { id: "e303", from: "cond-300", to: "out-300" },
    ],
    subResourceLinks: [{ id: "sr300", from: "agent-300", to: "feat-300" }, { id: "sr301", from: "agent-301", to: "cond-300" }],
  };
}

function tplWebhookSync(): Workflow {
  return {
    id: "tpl-webhook-sync", name: "Webhook to API / Data Sync",
    createdAt: "", updatedAt: "",
    nodes: [
      { id: "goal-400", type: "goal", title: "Real-time sync < 5min staleness", lane: "primary", position: { x: 440, y: 60 }, metadata: { northStar: "Data staleness never exceeds 5 minutes in production." } },
      { id: "trig-400", type: "trigger", title: "Webhook received", lane: "primary", position: { x: 80, y: 260 }, metadata: { event: "webhook.incoming" } },
      { id: "feat-400", type: "feature", title: "Validate payload", lane: "primary", position: { x: 280, y: 260 }, metadata: { acceptance: "Schema validation passes; malformed payloads logged and rejected." } },
      { id: "feat-401", type: "feature", title: "Transform & upsert", lane: "primary", position: { x: 480, y: 260 }, metadata: { acceptance: "Normalized record upserted with conflict resolution." } },
      { id: "out-400", type: "output", title: "Sync report", lane: "primary", position: { x: 680, y: 260 }, metadata: { deliverable: "Hourly sync summary with record counts and error rates." } },
      { id: "data-400", type: "data_source", title: "External API", lane: "subresource", position: { x: 280, y: 460 }, metadata: { kind: "api", ref: "https://api.vendor.example/v1/events" } },
    ],
    edges: [
      { id: "e400", from: "trig-400", to: "feat-400" }, { id: "e401", from: "feat-400", to: "feat-401" },
      { id: "e402", from: "feat-401", to: "out-400" },
    ],
    subResourceLinks: [{ id: "sr400", from: "data-400", to: "feat-400" }],
  };
}

function tplResearchSprint(): Workflow {
  return {
    id: "tpl-research-sprint", name: "Research Report Sprint",
    createdAt: "", updatedAt: "",
    nodes: [
      { id: "goal-500", type: "goal", title: "Answer research question in 5 days", lane: "primary", position: { x: 440, y: 60 }, metadata: { northStar: "Every question answered with citations in under 5 days." } },
      { id: "feat-500", type: "feature", title: "Gather sources", lane: "primary", position: { x: 180, y: 260 }, metadata: { acceptance: "At least 10 relevant sources collected and annotated." } },
      { id: "feat-501", type: "feature", title: "Extract key data", lane: "primary", position: { x: 380, y: 260 }, metadata: { acceptance: "Structured data points extracted from each source." } },
      { id: "feat-502", type: "feature", title: "Synthesize findings", lane: "primary", position: { x: 580, y: 260 }, metadata: { acceptance: "Findings merged into structured summary with key takeaways." } },
      { id: "out-500", type: "output", title: "Research report", lane: "primary", position: { x: 780, y: 260 }, metadata: { deliverable: "PDF report with exec summary, methodology, findings, references." } },
      { id: "agent-500", type: "agent_role", title: "Researcher", lane: "subresource", position: { x: 280, y: 460 }, metadata: { roleName: "Researcher", assignedAgentId: "" } },
      { id: "agent-501", type: "agent_role", title: "Synthesizer", lane: "subresource", position: { x: 580, y: 460 }, metadata: { roleName: "Synthesizer", assignedAgentId: "" } },
    ],
    edges: [
      { id: "e500", from: "feat-500", to: "feat-501" }, { id: "e501", from: "feat-501", to: "feat-502" },
      { id: "e502", from: "feat-502", to: "out-500" },
    ],
    subResourceLinks: [{ id: "sr500", from: "agent-500", to: "feat-500" }, { id: "sr501", from: "agent-501", to: "feat-502" }],
  };
}

function tplInvoiceAlerts(): Workflow {
  return {
    id: "tpl-invoice-alerts", name: "Invoice & Payment Alerting",
    createdAt: "", updatedAt: "",
    nodes: [
      { id: "goal-600", type: "goal", title: "Zero missed payment failures", lane: "primary", position: { x: 440, y: 60 }, metadata: { northStar: "Payment failures are caught and escalated within 2 minutes." } },
      { id: "trig-600", type: "trigger", title: "Stripe webhook", lane: "primary", position: { x: 80, y: 260 }, metadata: { event: "invoice.payment_failed" } },
      { id: "feat-600", type: "feature", title: "Validate invoice", lane: "primary", position: { x: 280, y: 260 }, metadata: { acceptance: "Invoice amount, customer, and failure reason extracted." } },
      { id: "feat-601", type: "feature", title: "Notify team", lane: "primary", position: { x: 480, y: 260 }, metadata: { acceptance: "Slack message with invoice details sent to #billing." } },
      { id: "out-600", type: "output", title: "Ledger update", lane: "primary", position: { x: 680, y: 260 }, metadata: { deliverable: "Failed payment logged in ledger with retry timestamp." } },
    ],
    edges: [
      { id: "e600", from: "trig-600", to: "feat-600" }, { id: "e601", from: "feat-600", to: "feat-601" },
      { id: "e602", from: "feat-601", to: "out-600" },
    ],
    subResourceLinks: [],
  };
}

function tplMeetingTasks(): Workflow {
  return {
    id: "tpl-meeting-tasks", name: "Meeting Notes to Tasks",
    createdAt: "", updatedAt: "",
    nodes: [
      { id: "goal-700", type: "goal", title: "100% action item capture rate", lane: "primary", position: { x: 440, y: 60 }, metadata: { northStar: "No action item from any meeting falls through the cracks." } },
      { id: "trig-700", type: "trigger", title: "Meeting ended", lane: "primary", position: { x: 80, y: 260 }, metadata: { event: "meeting.ended" } },
      { id: "feat-700", type: "feature", title: "Generate summary", lane: "primary", position: { x: 280, y: 260 }, metadata: { acceptance: "Meeting summary with attendees, decisions, and key points." } },
      { id: "feat-701", type: "feature", title: "Extract action items", lane: "primary", position: { x: 480, y: 260 }, metadata: { acceptance: "Action items with owner and due date extracted." } },
      { id: "feat-702", type: "feature", title: "Create project tasks", lane: "primary", position: { x: 680, y: 260 }, metadata: { acceptance: "Tasks created in project board assigned to owners." } },
      { id: "out-700", type: "output", title: "Email recap", lane: "primary", position: { x: 880, y: 260 }, metadata: { deliverable: "Recap email sent to all attendees with summary and tasks." } },
      { id: "agent-700", type: "agent_role", title: "Note Taker", lane: "subresource", position: { x: 380, y: 460 }, metadata: { roleName: "Note Taker", assignedAgentId: "" } },
    ],
    edges: [
      { id: "e700", from: "trig-700", to: "feat-700" }, { id: "e701", from: "feat-700", to: "feat-701" },
      { id: "e702", from: "feat-701", to: "feat-702" }, { id: "e703", from: "feat-702", to: "out-700" },
    ],
    subResourceLinks: [{ id: "sr700", from: "agent-700", to: "feat-700" }],
  };
}

export const WORKFLOW_TEMPLATES: TemplateInfo[] = [
  { id: "lead-enrichment", name: "Lead Enrichment & CRM Routing", subtitle: "Qualify and route inbound leads automatically", category: "Sales", categoryColor: "#6366f1", difficulty: "Intermediate", estimatedSetup: "15 min", trigger: "Form / Webhook", apps: ["Webhook", "Enrichment API", "CRM", "Slack"], agentCount: 2, nodePreview: ["Webhook In", "Enrich Lead", "Score", "CRM Upsert", "Slack Notify"], icon: "\u{1F4C8}", workflow: tplLeadEnrichment() },
  { id: "support-triage", name: "Support Ticket Triage", subtitle: "AI-classify, prioritize, and assign support tickets", category: "Support", categoryColor: "#f59e0b", difficulty: "Beginner", estimatedSetup: "10 min", trigger: "Inbox / Zendesk", apps: ["Email", "AI Classifier", "Ticketing", "Slack"], agentCount: 1, nodePreview: ["Inbox", "AI Classify", "Priority Route", "Assign Agent", "Notify"], icon: "\u{1F3AF}", workflow: tplSupportTriage() },
  { id: "customer-onboarding", name: "Customer Onboarding", subtitle: "Welcome new signups and drive activation", category: "Customer Success", categoryColor: "#10b981", difficulty: "Intermediate", estimatedSetup: "20 min", trigger: "Signup event", apps: ["Auth", "Email", "Task Manager", "CRM"], agentCount: 2, nodePreview: ["Signup", "Welcome Email", "Create Tasks", "CRM Update", "Follow-up"], icon: "\u{1F680}", workflow: tplOnboarding() },
  { id: "content-repurpose", name: "Content Repurposing Pipeline", subtitle: "Turn drafts into multi-format content", category: "Content", categoryColor: "#ec4899", difficulty: "Intermediate", estimatedSetup: "15 min", trigger: "Draft / URL", apps: ["CMS", "AI Writer", "Social", "Approval"], agentCount: 2, nodePreview: ["Draft In", "Summarize", "Rewrite", "Approve", "Publish"], icon: "\u{270F}\u{FE0F}", workflow: tplContentRepurpose() },
  { id: "webhook-sync", name: "Webhook to API / Data Sync", subtitle: "Validate, transform, and sync data in real-time", category: "DevOps", categoryColor: "#3b82f6", difficulty: "Beginner", estimatedSetup: "10 min", trigger: "Webhook", apps: ["Webhook", "Transformer", "Database", "Error Log"], agentCount: 0, nodePreview: ["Webhook", "Validate", "Transform", "API/DB", "Error Log"], icon: "\u{1F50C}", workflow: tplWebhookSync() },
  { id: "research-sprint", name: "Research Report Sprint", subtitle: "Structured research with AI-powered synthesis", category: "Research", categoryColor: "#8b5cf6", difficulty: "Advanced", estimatedSetup: "20 min", trigger: "Topic / Brief", apps: ["Search", "Extractor", "Synthesizer", "Vault"], agentCount: 2, nodePreview: ["Topic", "Search", "Extract", "Summarize", "Report", "Vault"], icon: "\u{1F52C}", workflow: tplResearchSprint() },
  { id: "invoice-alerts", name: "Invoice & Payment Alerting", subtitle: "Monitor Stripe events, alert on failures, update ledger", category: "Finance", categoryColor: "#22d3ee", difficulty: "Beginner", estimatedSetup: "10 min", trigger: "Stripe Event", apps: ["Stripe", "Validator", "Slack", "Ledger"], agentCount: 0, nodePreview: ["Stripe Event", "Invoice Check", "Notify", "Ledger Update"], icon: "\u{1F4B3}", workflow: tplInvoiceAlerts() },
  { id: "meeting-tasks", name: "Meeting Notes to Tasks", subtitle: "Transcribe, summarize, extract action items, create tasks", category: "Productivity", categoryColor: "#a78bfa", difficulty: "Beginner", estimatedSetup: "10 min", trigger: "Transcript", apps: ["Transcription", "AI Summary", "Project Tasks", "Email"], agentCount: 1, nodePreview: ["Transcript", "Summary", "Action Items", "Tasks", "Email"], icon: "\u{1F4CB}", workflow: tplMeetingTasks() },
];

// ── Streaming Fence Parser ───────────────────────
// Port of desktop/pages/workflow/lib/ai-op-parser.js
// Extracts <aether-workflow-draft>{json}</aether-workflow-draft> from SSE text

const DRAFT_OPEN = "<aether-workflow-draft>";
const DRAFT_CLOSE = "</aether-workflow-draft>";

export interface FenceParser {
  feed(chunk: string): { drafts: Workflow[]; errors: Array<{ reason: string }>; remainder: string };
  reset(): void;
}

export function createFenceParser(): FenceParser {
  let buf = "";
  return {
    feed(chunk: string) {
      buf += chunk;
      const drafts: Workflow[] = [];
      const errors: Array<{ reason: string }> = [];
      let progress = true;
      while (progress) {
        progress = false;
        const dStart = buf.indexOf(DRAFT_OPEN);
        if (dStart !== -1) {
          const dEnd = buf.indexOf(DRAFT_CLOSE, dStart + DRAFT_OPEN.length);
          if (dEnd !== -1) {
            const payload = buf.slice(dStart + DRAFT_OPEN.length, dEnd);
            try { drafts.push(JSON.parse(payload) as Workflow); } catch (e) {
              errors.push({ reason: "JSON parse: " + (e instanceof Error ? e.message : String(e)) });
            }
            buf = buf.slice(0, dStart) + buf.slice(dEnd + DRAFT_CLOSE.length);
            progress = true;
          }
        }
      }
      const remainder = buf; buf = "";
      return { drafts, errors, remainder };
    },
    reset() { buf = ""; },
  };
}

// ── Project Conversion API Wrappers ──────────────
// These block server-side on completed LLM generation (an assessment,
// brainstorm round, plan, or finalized project — not a job handle), the same
// class of long-running call as chat's non-streaming fallback. Each opts
// into stream()'s own generous bound instead of request()'s 30s
// metadata-call default (LOOP-01/LOOP-06 round-1) so a healthy but slow
// generation isn't killed early.

export async function assessWorkflow(api: ApiClient, workflow: Workflow): Promise<WorkflowAssessResponse> {
  return api.postJson(PROJECT_FROM_WORKFLOW_ASSESS_PATH, { workflow }, undefined, defaultStreamTimeoutMs());
}

export async function brainstormWorkflow(
  api: ApiClient, workflow: Workflow,
  qaHistory: Array<{ q: string; a: string }> = [],
  nextIndex = 0,
): Promise<WorkflowBrainstormResponse> {
  return api.postJson(PROJECT_FROM_WORKFLOW_BRAINSTORM_PATH, {
    workflow, qa_history: qaHistory, next_index: nextIndex,
  }, undefined, defaultStreamTimeoutMs());
}

export async function planWorkflow(
  api: ApiClient, workflow: Workflow, brainstormSummary = "", mode?: string,
): Promise<WorkflowPlanResponse> {
  return api.postJson(PROJECT_FROM_WORKFLOW_PLAN_PATH, {
    workflow, brainstorm_summary: brainstormSummary, mode,
  }, undefined, defaultStreamTimeoutMs());
}

export async function finalizeWorkflow(
  api: ApiClient, workflow: Workflow, planMd: string,
): Promise<WorkflowFinalizeResponse> {
  return api.postJson(PROJECT_FROM_WORKFLOW_FINALIZE_PATH, {
    workflow, plan_md: planMd, edited_by_user: false,
  }, undefined, defaultStreamTimeoutMs());
}

// ── Vault-Based Workflow CRUD ────────────────────

const WF_EXT = ".aetherflow.json";

// listSpaces/getSpacesContent/deleteSpacesFile (vault.ts) never throw for a
// legitimate empty-result case (an empty vault is a 200 with `files: []`; a
// missing file's absence shows up as `content: null`/`binary`, not an
// exception) — so a thrown error here is always a REAL failure (expired
// session, network outage, 5xx). These used to swallow that into an empty
// list / null / false, which the command layer then reported as "no
// workflows" / "not found" / "delete failed", hiding e.g. a 401 session
// expiry with zero indication to run `aether auth login`. Let it propagate
// instead — every call site already wraps these in its own try/catch that
// calls fail(err) (see src/commands/workflow.ts), same as vault.ts's direct
// (uncaught) use of getSpacesContent/deleteSpacesFile.
export async function listWorkflows(api: ApiClient): Promise<WorkflowListItem[]> {
  const r = await listSpaces(api);
  return r.files
    .filter(f => f.filename.endsWith(WF_EXT))
    .map(f => ({
      name: f.filename.slice(0, -WF_EXT.length),
      filename: f.filename,
      size: f.size,
      lastModified: f.last_modified,
    }));
}

export async function getWorkflow(api: ApiClient, name: string): Promise<Workflow | null> {
  const filename = name.endsWith(WF_EXT) ? name : name + WF_EXT;
  const r = await getSpacesContent(api, filename);
  if (r.binary || !r.content) return null;
  return JSON.parse(r.content) as Workflow;
}

export async function deleteWorkflow(api: ApiClient, name: string): Promise<boolean> {
  const filename = name.endsWith(WF_EXT) ? name : name + WF_EXT;
  await deleteSpacesFile(api, filename);
  return true;
}

/** Save a workflow object to vault by writing JSON to temp file, uploading it. */
export async function saveWorkflow(api: ApiClient, workflow: Workflow): Promise<{ key: string; filename: string; size: number }> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const json = JSON.stringify(workflow, null, 2);
  const filename = (workflow.name || workflow.id || "workflow") + WF_EXT;
  const tmpPath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(tmpPath, json);
  try {
    return await uploadFile(api, tmpPath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
  }
}

/** Export a workflow from vault to a local file. Returns output path. */
export async function exportWorkflow(api: ApiClient, name: string, outputPath?: string): Promise<string> {
  const filename = name.endsWith(WF_EXT) ? name : name + WF_EXT;
  const outPath = outputPath || filename;
  return downloadFile(api, filename, outPath);
}

// ── Rendering helpers ────────────────────────────

export function formatWorkflowSummary(wf: Workflow): string {
  const types = { goal: 0, feature: 0, agent_role: 0, data_source: 0, condition: 0, trigger: 0, output: 0 };
  for (const n of wf.nodes) {
    const t = n.type as keyof typeof types;
    if (t in types) types[t]++;
  }
  const lines = [
    `${wf.name}  (${wf.id})`,
    `nodes: ${wf.nodes.length}  edges: ${wf.edges.length}  subResourceLinks: ${wf.subResourceLinks.length}`,
  ];
  const typeParts: string[] = [];
  if (types.goal > 0) typeParts.push(`${types.goal} goal`);
  if (types.feature > 0) typeParts.push(`${types.feature} feat`);
  if (types.agent_role > 0) typeParts.push(`${types.agent_role} agent`);
  if (types.data_source > 0) typeParts.push(`${types.data_source} data`);
  if (types.condition > 0) typeParts.push(`${types.condition} cond`);
  if (types.trigger > 0) typeParts.push(`${types.trigger} trig`);
  if (types.output > 0) typeParts.push(`${types.output} out`);
  lines.push("types: " + typeParts.join(", "));
  return lines.join("\n");
}

export function formatWorkflowDetail(wf: Workflow): string {
  const lines = [formatWorkflowSummary(wf), ""];
  // Build a node lookup for edge labels
  const nodeMap = new Map(wf.nodes.map(n => [n.id, n]));
  lines.push("Nodes:");
  for (const n of wf.nodes) {
    const ns = (
      n.metadata?.["northStar"] ||
      n.metadata?.["acceptance"] ||
      n.metadata?.["deliverable"] ||
      n.metadata?.["event"] ||
      ""
    );
    lines.push(`  [${n.type}] ${n.title}  (${n.id})${ns ? "  → " + ns.slice(0, 60) : ""}`);
  }
  if (wf.edges.length > 0) {
    lines.push("\nEdges:");
    for (const e of wf.edges) {
      const from = nodeMap.get(e.from)?.title || e.from;
      const to = nodeMap.get(e.to)?.title || e.to;
      lines.push(`  ${from}  →  ${to}`);
    }
  }
  if (wf.subResourceLinks.length > 0) {
    lines.push("\nSubResource Links:");
    for (const e of wf.subResourceLinks) {
      const from = nodeMap.get(e.from)?.title || e.from;
      const to = nodeMap.get(e.to)?.title || e.to;
      lines.push(`  ${from}  —  ${to}`);
    }
  }
  return lines.join("\n");
}
