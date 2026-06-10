# Workflow V2 — Follow-Up Plan

> **For Hermes:** Phase 2 of the workflow terminal integration. Completes the deferred features from PR #10.

**Goal:** Finish the remaining workflow subcommands that were deferred in v1 — save/export/import (vault file I/O) and workflow generation via AI (SSE chat streaming). These three features take the workflow terminal system from "view and convert" to "full create-and-manage."

**Architecture:** Three independent streams of work that can ship in parallel:
- **Stream A**: Upload/download plumbing (shared infrastructure)
- **Stream B**: Workflow file I/O (save/export/import on top of Stream A)
- **Stream C**: AI-driven workflow generation (new + edit via chat SSE)

---

## Stream A: Upload/Download Plumbing

**Goal:** Add multipart upload and binary download to the vault API client, completing the `aether vault upload` and `aether vault download` commands deferred in the vault PR.

**Files:**
- Modify: `src/core/vault.ts` — add `uploadFile()` and `downloadFile()` functions
- Modify: `src/commands/vault.ts` — implement `upload` and `download` handlers

### Task A1: Implement uploadFile()

```typescript
// Uses FormData + fetch with multipart/form-data
// Reads local file with fs.readFileSync, builds FormData, POSTs to /vault/spaces/upload
// Returns upload result with key, filename, size, content_type

export async function uploadFile(api: ApiClient, filePath: string): Promise<{ key: string; filename: string; size: number }> {
  const fs = require("node:fs");
  const path = require("node:path");
  const data = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const formData = new FormData();
  formData.append("file", new Blob([data]), filename);
  const headers = await _authHeaders(api);
  const res = await fetch(_baseUrl(api) + VAULT_SPACES_UPLOAD_PATH, {
    method: "POST", headers: { ...headers }, body: formData,
  });
  if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`);
  return res.json();
}
```

### Task A2: Implement downloadFile()

```typescript
// Downloads file to local path, returns path + size
export async function downloadFile(api: ApiClient, filename: string, outputPath: string): Promise<string> {
  const buffer = await downloadSpacesFile(api, filename);
  require("node:fs").writeFileSync(outputPath, Buffer.from(buffer));
  return outputPath;
}
```

### Task A3: Wire upload/download into vault command

Swap the `notYet` stubs in `commands/vault.ts` with real implementations:
- `vault upload <file>` — calls uploadFile(), shows result
- `vault download <name> [--output <path>]` — calls downloadFile(), saves to path (default cwd/name)

---

## Stream B: Workflow File I/O

**Goal:** Implement save/export/import using the vault upload/download infrastructure from Stream A.

**Files:**
- Modify: `src/commands/workflow.ts` — swap `notYet` stubs

### Task B1: workflow save

```typescript
// Takes a workflow name + optional --from-template <n>
// Builds .aetherflow.json, writes to temp file, uploads to vault
// If --from-template, loads template first
```

### Task B2: workflow export

```typescript
// Downloads .aetherflow.json from vault to local disk
// Default: ./<name>.aetherflow.json
// --output flag for custom path
```

### Task B3: workflow import

```typescript
// Reads local .aetherflow.json, parses + validates, uploads to vault
// Shows workflow summary after upload
```

---

## Stream C: AI-Driven Workflow Generation

**Goal:** Implement `workflow new` with real SSE chat streaming. The CLI sends a description to the chat endpoint with `[WORKFLOW_MODE]` marker, the backend injects `WORKFLOW_AI_DIRECTIVE`, the model emits `<aether-workflow-draft>` fences, and the CLI parses them.

**Files:**
- Modify: `src/commands/workflow.ts` — rewrite `workflowNew()` handler
- Modify: `src/core/envelope.ts` — add `meta` field support to `buildChatRequest`
- Possibly new: `src/core/workflow_stream.ts` — dedicated streaming helper

### Architecture

```
aether workflow new "lead enrichment automation"
  │
  ├─ Build chat request: { prompt: "[WORKFLOW_MODE] lead enrichment automation",
  │                        meta: { workflow_json: null } }
  │
  ├─ POST to /agent/chat/stream (SSE)
  │
  ├─ For each SSE frame of type "delta":
  │     accumulate text → feed through createFenceParser().feed(chunk)
  │
  ├─ On "done" frame:
  │     check parser for extracted drafts
  │
  └─ Display extracted workflow + offer to save
```

### Task C1: Add meta support to buildChatRequest

In `src/core/envelope.ts`, add optional `meta?: Record<string, unknown>` to the request builder:

```typescript
export function buildChatRequest(opts: {
  prompt: string; model?: string; agent?: string; manualModel?: boolean;
  meta?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    prompt: opts.prompt,
    model: opts.model ?? null,
    manualModel: opts.manualModel ?? null,
    meta: opts.meta ?? null,
  };
}
```

### Task C2: Implement workflow streaming in workflowNew()

```typescript
async function workflowNew(ctx: AppContext, description: string): Promise<number> {
  const req = buildChatRequest({
    prompt: "[WORKFLOW_MODE] " + description,
    model: ctx.flags.model ?? ctx.cfg.defaultModel,
    manualModel: ctx.flags.model != null,
    meta: { workflow_json: null },
  });
  const parser = createFenceParser();
  let fullText = "";
  let draft: Workflow | null = null;

  try {
    const stream = await ctx.api.stream(CHAT_STREAM_PATH, req);
    for await (const frame of decodeSse(stream)) {
      if (frame.type === "delta" && frame.text) {
        fullText += frame.text;
        process.stdout.write(frame.text); // stream display in real-time
        const result = parser.feed(frame.text);
        if (result.drafts.length > 0) {
          draft = result.drafts[0]!;
        }
      }
      if (frame.type === "done") {
        const final = parser.feed(""); // flush remainder
        if (!draft && final.drafts.length > 0) {
          draft = final.drafts[0]!;
        }
      }
    }
  } catch (err) {
    // Fail-soft: non-streaming fallback
  }

  if (draft) {
    process.stdout.write(`\n\nGenerated workflow: ${draft.name} (${draft.id})\n`);
    process.stdout.write(formatWorkflowSummary(draft) + "\n");
    process.stdout.write("\nSave to vault? aether workflow save " + draft.name + "\n");
    // Store draft in memory for immediate save
    _lastGenerated = draft;
  } else {
    process.stdout.write("\n\n(no workflow draft was generated — the model may not support workflow generation)\n");
  }

  return 0;
}
```

### Task C3 (Optional): workflow edit

For editing existing workflows via discrete ops:
- Load workflow from vault
- Send chat with `meta: { workflow_json: <current workflow> }`
- Parse `<aether-workflow-op>` fences for addNode/removeNode/updateNode/addEdge/removeEdge ops
- Apply ops to local copy, show diff, offer save

---

## Implementation Order

| Phase | Stream | Tasks | Dependencies |
|---|---|---|---|
| 1 | A | A1, A2, A3 — vault upload/download | None |
| 2 | B | B1, B2, B3 — workflow save/export/import | Phase 1 |
| 3 | C | C1, C2 — AI workflow generation | Phase 1 (for save) |
| 4 | C | C3 — workflow edit (optional) | Phase 2, 3 |

## Risk Assessment

| Risk | Level | Mitigation |
|---|---|---|
| uploadFile FormData + Blob not available in older Node | Low | Node 22+ has native FormData; fallback to `node-fetch` if needed |
| Chat stream may not return workflow draft for all models | Medium | Graceful message + suggestion to try a different model |
| Fence parser may miss partial drafts across SSE chunks | Low | Parser is already proven in desktop; buffers across calls |
| save overwrites existing workflow silently | Low | Add `--force` flag; prompt confirmation by default |
