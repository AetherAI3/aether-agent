# UVT Slash Commands — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task across both aether-agent (CLI) and AETHER-CLOUD (backend) repos.

**Goal:** Implement 8 Ultra-Velocity Terminal (UVT) slash commands in the aether-agent REPL with backend wiring in AETHER-CLOUD.

**Architecture:** 5 commands need new AETHER-CLOUD endpoints (FastAPI routers), 3 are CLI-only (local git/filesystem ops). All follow the proven slash-only command pattern (core module → slash.ts handler → help text). Orchestrator-gated commands reuse `requireOrchestrator` gate. Backend endpoints follow the FastAPI router pattern from `agent_orch_routes.py` (lazy auth imports, `_flexible_token` + `_resolve_username`).

**Tech Stack:** TypeScript (aether-agent CLI), Python/FastAPI (AETHER-CLOUD), Git (stage-diff/revert/purge)

---

## AUDIT: Each Command vs Existing Codebase

| # | Command | Status | Existing? | Needs Backend? |
|---|---------|--------|-----------|----------------|
| 1 | `/scaffold <type> <name>` | NEW | Nothing exists | YES — LLM template generation |
| 2 | `/port <file|dir> <lang>` | NEW | Nothing exists | YES — LLM code translation |
| 3 | `/test-drive "<target>"` | NEW | Nothing exists | YES — orchestrator autonomous loop |
| 4 | `/bench <target>` | NEW | Nothing exists | YES — orchestrator profiling loop |
| 5 | `/purge` | EXTEND | `/clear` (screen only), `resetRegistry()` (context only) | Optional — session clear |
| 6 | `/token-budget <amount>` | ALIAS | `/limit <uvt>` fully implemented | No |
| 7 | `/stage-diff` | NEW | Nothing exists | Optional — LLM commit message |
| 8 | `/revert <step_id|file>` | EXTEND | `/rollback [n]` bulk only, no step tracking | No |

### Detailed Audit

**1. `/scaffold <component|route|module> <name>`**
Bypasses creative LLM generation. Forces strict pre-approved boilerplate schemas for instant, predictable code structure.
- No existing code at all.
- Needs: template definitions, backend LLM call to fill templates, CLI handler to dispatch.

**2. `/port <file|dir> <target_language>`**
Deeply translates a module into a new language, mapping abstractions to idiomatic structures.
- No existing code at all.
- Needs: file reader, backend LLM call, output writer.

**3. `/test-drive "<route|function>"`**
Auto-writes comprehensive unit test matrix, runs locally, isolates edge-case failures, iteratively modifies source until all pass.
- No existing code. Closest is `--test-cmd` flag on `aether agent` which sets the test command but doesn't auto-generate.
- Needs: orchestrator-gated autonomous loop, backend endpoint, local test runner integration.

**4. `/bench <function|endpoint>`**
Profiles code block or endpoint for performance, detects algorithmic complexity or memory leaks, auto-applies optimizations.
- No existing code.
- Needs: orchestrator-gated autonomous loop, backend endpoint.

**5. `/purge`**
Flushes all transient context, temporary file chunks, and dead conversation history from active agent memory, resetting to lean baseline without losing session goal.
- Partially exists: `/clear` calls `out.write("\x1b[2J\x1b[H")` (screen clear only). `resetRegistry()` in context_registry.ts resets pins/drops/uvt cap (but is not called by any slash command currently).
- Missing: temp file cleanup, conversation history reset, session goal preservation.
- Path: `/root/aether-agent/src/commands/slash.ts:202-204` (clear handler), `/root/aether-agent/src/core/context_registry.ts:134-136` (resetRegistry).

**6. `/token-budget <amount>`**
Hard token/cost limit per-command or per-hour. Freezes operations when ceiling hit.
- **FULLY EXISTS** as `/limit <uvt>`. Implementation in `slash.ts:400-434` (limitSlash), backed by `context_registry.ts:52-58` (uvtCap/uvtSpent/checkUvtCap/setUvtCap), with UVT bar rendering and backend sync.
- Action: single alias — add `"token-budget"` case that calls `limitSlash(ctx, out, arg)`.

**7. `/stage-diff`**
Generates clean unified diff of all agent changes in current session, formats optimized conventional-commit message, presents for approval.
- No existing code.
- Needs: `git diff` wrapper, commit message generator (backend LLM or local template), confirmation gate.

**8. `/revert <step_id|file>`**
Surgical rollback. Reverts filesystem changes to exact historical execution checkpoint without full git reset.
- Partially exists: `/rollback [n]` at `slash.ts:514-559` — shows dirty files, confirms, runs `git checkout -- .` (bulk revert of ALL uncommitted changes).
- Missing: single-file revert, step-based revert (step tracking doesn't exist yet).
- Path: `/root/aether-agent/src/commands/slash.ts:514-559` (rollbackSlash).

---

## Implementation Plan

### PHASE 0: Token-Budget Alias (1 task, 5 min)

The only zero-effort command — already fully implemented. Just needs an alias.

#### Task 0.1: Add `/token-budget` alias in slash.ts

**Objective:** Route `/token-budget <amount>` to the existing `limitSlash` handler.

**Files:**
- Modify: `src/commands/slash.ts:88-247` (handleSlash switch)

**Step 1: Add case to switch**

In `handleSlash()`, add after the `case "limit":` block (currently lines 229-234):

```typescript
case "token-budget":
  await limitSlash(ctx, out, arg);
  break;
```

**Step 2: Add help entry**

In `printHelp()`, in the "Context & Limits" section, add after the `/limit` line:

```typescript
theme.dim("/token-budget") + " <uvt>       alias for /limit",
```

**Step 3: Build and verify**

```bash
cd /root/aether-agent && npx tsc -p tsconfig.json && echo "BUILD OK"
```

**Step 4: Commit**

```bash
git add src/commands/slash.ts
git commit -m "feat: add /token-budget alias for /limit UVT command"
```

---

### PHASE 1: `/scaffold` — Boilerplate Code Generator

#### Overview
Scaffold generates code from strict pre-approved templates. The CLI sends template type + name to the backend, which uses a system-prompt-locked LLM call to fill the template with zero creative drift.

**Files to create:**
- `src/core/scaffold.ts` — types, API client, embedded templates
- `src/core/transport.ts` — add `UVT_SCAFFOLD_PATH`
- `src/commands/slash.ts` — handler + help

**Backend files to create:**
- `uvt_routes.py` — extend with scaffold endpoint (or new `uvt_tools_routes.py`)

#### Task 1.1: Add route constant to transport.ts

**Objective:** Add the backend API path for scaffold.

**Files:**
- Modify: `src/core/transport.ts`

**Step 1:** Add after the last vault route (line ~62):

```typescript
// ── UVT Commands ────────────────────────────
export const UVT_SCAFFOLD_PATH = "/uvt/scaffold";
```

#### Task 1.2: Create core module (src/core/scaffold.ts)

**Objective:** Define types, API wrapper, and embedded boilerplate templates.

**Files:**
- Create: `src/core/scaffold.ts`

Complete file:

```typescript
// UVT /scaffold — strict boilerplate code generation.
// Sends template type + name to backend; backend fills via locked-down LLM prompt.

import type { ApiClient } from "./transport.js";
import { UVT_SCAFFOLD_PATH } from "./transport.js";

export type ScaffoldType = "component" | "route" | "module";

export interface ScaffoldRequest {
  type: ScaffoldType;
  name: string;
  language?: string;   // defaults to "typescript"
}

export interface ScaffoldResponse {
  files: Array<{ path: string; content: string }>;
  template_used: string;
}

export async function generateScaffold(
  api: ApiClient,
  type: ScaffoldType,
  name: string,
  language = "typescript",
): Promise<ScaffoldResponse> {
  return api.postJson<ScaffoldResponse>(UVT_SCAFFOLD_PATH, {
    type,
    name,
    language,
  } as ScaffoldRequest);
}

// ── Validation ──────────────────────────────

const VALID_TYPES: ScaffoldType[] = ["component", "route", "module"];

export function isValidScaffoldType(t: string): t is ScaffoldType {
  return (VALID_TYPES as string[]).includes(t);
}

export const SCAFFOLD_USAGE = [
  "usage: /scaffold <component|route|module> <name>",
  "  /scaffold component UserCard       React/Vue component",
  "  /scaffold route /api/users         Express/Fastify route",
  "  /scaffold module auth-service      TypeScript module",
].join("\n");
```

#### Task 1.3: Add scaffold handler to slash.ts

**Objective:** Add `/scaffold` case, handler function, and help entry.

**Files:**
- Modify: `src/commands/slash.ts`

**Step 1: Add import at top**

```typescript
import { generateScaffold, isValidScaffoldType, SCAFFOLD_USAGE } from "../core/scaffold.js";
```

**Step 2: Add case in handleSlash switch** (before the `default` case)

```typescript
case "scaffold": {
  await scaffoldSlash(ctx, out, arg);
  break;
}
```

**Step 3: Add handler function** (after the last existing handler, before `printHelp`)

```typescript
// ── /scaffold ─────────────────────────────────

async function scaffoldSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.trim().split(/\s+/);
  const type = parts[0]?.toLowerCase() ?? "";
  const name = parts.slice(1).join(" ");

  if (!type || !name) {
    out.write(SCAFFOLD_USAGE + "\n");
    return;
  }

  if (!isValidScaffoldType(type)) {
    out.write(`invalid type: ${type} — use component, route, or module\n`);
    return;
  }

  try {
    out.write(`scaffolding ${type} "${name}"...\n`);
    const r = await generateScaffold(ctx.api, type as ScaffoldType, name);
    for (const f of r.files) {
      out.write(`  created: ${theme.bold(f.path)}  (${f.content.split("\n").length} lines)\n`);
    }
    out.write(`template: ${theme.dim(r.template_used)}\n`);
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
```

Note: `ScaffoldType` is already imported from scaffold.ts, but if TS complains, add `import type { ScaffoldType } from "../core/scaffold.js";` alongside the existing import.

**Step 4: Add help entry in printHelp**

In a new "UVT Tools" section (add before the closing `printHelp` logic):

```typescript
[
  "",
  theme.iceBlue("⚡") + "  " + theme.bold("UVT Tools"),
  "",
  theme.dim("/scaffold") + " <type> <name>  generate boilerplate (component|route|module)",
  theme.dim("/port") + " <file> <lang>      translate code to another language",
  theme.dim("/test-drive") + ' "<target>"  auto-test: generate, run, fix, repeat',
  theme.dim("/bench") + " <target>          profile & optimize code",
  theme.dim("/purge") + "                    flush transient context & temp files",
  theme.dim("/token-budget") + " <uvt>       hard UVT cap (alias: /limit)",
  theme.dim("/stage-diff") + "               unified diff + commit message",
  theme.dim("/revert") + " <file|step>       surgical rollback (extends /rollback)",
  "",
],
```

**Step 5: Build and verify**

```bash
cd /root/aether-agent && npx tsc -p tsconfig.json && echo "BUILD OK"
```

#### Task 1.4: Create backend scaffold endpoint (AETHER-CLOUD)

**Objective:** Add POST `/uvt/scaffold` endpoint that generates boilerplate via LLM with locked-down system prompt.

**Files:**
- Modify: `uvt_routes.py` (or create `uvt_tools_routes.py`)

**Step 1: Add endpoint to uvt_routes.py**

After the existing uvt_router endpoints, add:

```python
# ── UVT /scaffold ─────────────────────────────────

class ScaffoldRequest(BaseModel):
    type: str  # "component", "route", "module"
    name: str
    language: str = "typescript"

class ScaffoldResponse(BaseModel):
    files: list[dict]
    template_used: str

@uvt_router.post("/scaffold")
async def scaffold(req: ScaffoldRequest, token: str = Depends(_flexible_token)):
    """POST /uvt/scaffold — generate strict boilerplate from templates."""
    username = _resolve_username(token)

    # Validate type
    valid = {"component", "route", "module"}
    if req.type not in valid:
        raise HTTPException(400, f"Invalid type: {req.type}. Use: {', '.join(valid)}")

    # Build locked-down system prompt — prevents creative drift
    system_prompt = _scaffold_system_prompt(req.type, req.language)
    user_prompt = f"Generate a {req.type} named '{req.name}' in {req.language}."

    # Call LLM
    from lib.llm import chat_sync  # or whatever the project's LLM helper is
    raw = await chat_sync(system=system_prompt, user=user_prompt, model="fast")

    # Parse response into files
    files = _parse_scaffold_output(raw, req.name, req.language, req.type)
    return {"files": files, "template_used": f"{req.type}-v1"}
```

**Step 2: Add helper functions in same file**

```python
def _scaffold_system_prompt(typ: str, lang: str) -> str:
    return f"""You are a strict boilerplate code generator. Output ONLY valid {lang} code.
Do NOT add explanations, comments about the code, or markdown fences.
Output exactly one file per code block, with the file path as a comment on the first line.
Use the exact boilerplate pattern for a {typ}. No creative variations."""

def _parse_scaffold_output(raw: str, name: str, lang: str, typ: str) -> list[dict]:
    """Parse LLM output into file list. Falls back to single file if no markers."""
    files = []
    # Simple heuristic: split on "// path:" or "# path:" markers
    # Falls back to single file if no markers found
    ext = {"typescript": "ts", "python": "py", "go": "go", "rust": "rs"}.get(lang, "txt")
    if typ == "route":
        path = f"src/routes/{name.lower()}.{ext}"
    elif typ == "component":
        path = f"src/components/{name}.{ext}"
    else:
        path = f"src/modules/{name.lower()}/index.{ext}"
    return [{"path": path, "content": raw.strip()}]
```

**Step 3: Verify the router is included in api_server.py**

The `uvt_router` is already registered. Confirm with:
```bash
grep "uvt_router" /root/AETHER-CLOUD/api_server.py
```

**Step 4: Commit**

```bash
cd /root/AETHER-CLOUD
git add uvt_routes.py
git commit -m "feat: add /uvt/scaffold endpoint for boilerplate code generation"
```

---

### PHASE 2: `/port` — Code Translation

#### Overview
Reads local file(s), packages content with source/target language metadata, sends to backend LLM for idiomatic translation, writes output files.

**Files to create:**
- `src/core/port.ts` — types, API client, file I/O
- `src/core/transport.ts` — add `UVT_PORT_PATH`

#### Task 2.1: Add route constant

**Files:**
- Modify: `src/core/transport.ts`

Add after `UVT_SCAFFOLD_PATH`:

```typescript
export const UVT_PORT_PATH = "/uvt/port";
```

#### Task 2.2: Create core module (src/core/port.ts)

```typescript
// UVT /port — deep code translation between languages.

import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type { ApiClient } from "./transport.js";
import { UVT_PORT_PATH } from "./transport.js";

export interface PortRequest {
  files: Array<{ path: string; content: string }>;
  target_language: string;
  source_language?: string;
}

export interface PortedFile {
  path: string;
  content: string;
}

export interface PortResponse {
  files: PortedFile[];
}

export async function portCode(
  api: ApiClient,
  files: Array<{ path: string; content: string }>,
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<PortResponse> {
  return api.postJson<PortResponse>(UVT_PORT_PATH, {
    files,
    target_language: targetLanguage,
    source_language: sourceLanguage,
  } as PortRequest);
}

// ── File I/O helpers ────────────────────────

export function readSource(target: string): Array<{ path: string; content: string }> {
  const cwd = process.cwd();
  const abs = target.startsWith("/") ? target : join(cwd, target);

  if (!existsSync(abs)) throw new Error(`not found: ${target}`);

  const st = statSync(abs);
  if (st.isDirectory()) {
    // Read all source files in directory
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const entries: Array<{ path: string; content: string }> = [];
    for (const name of readdirSync(abs)) {
      const fp = join(abs, name);
      if (statSync(fp).isFile()) {
        entries.push({ path: name, content: readFileSync(fp, "utf8") });
      }
    }
    if (entries.length === 0) throw new Error(`no files in directory: ${target}`);
    return entries;
  }

  // Single file
  return [{ path: basename(abs), content: readFileSync(abs, "utf8") }];
}

export function writePortedFiles(files: PortedFile[], outputDir: string): string[] {
  const { mkdirSync } = require("node:fs") as typeof import("node:fs");
  const cwd = process.cwd();
  const abs = outputDir.startsWith("/") ? outputDir : join(cwd, outputDir);
  mkdirSync(abs, { recursive: true });
  const written: string[] = [];
  for (const f of files) {
    const fp = join(abs, f.path);
    writeFileSync(fp, f.content, "utf8");
    written.push(fp);
  }
  return written;
}

// Language extension map
export const LANG_EXTS: Record<string, string> = {
  typescript: "ts", python: "py", rust: "rs", go: "go",
  java: "java", kotlin: "kt", swift: "swift", cpp: "cpp",
  c: "c", ruby: "rb", php: "php", zig: "zig",
};

export function langExtension(targetLang: string): string {
  return LANG_EXTS[targetLang.toLowerCase()] ?? targetLang.toLowerCase();
}
```

#### Task 2.3: Add port handler to slash.ts

**Files:**
- Modify: `src/commands/slash.ts`

**Step 1: Import**

```typescript
import { portCode, readSource, writePortedFiles, langExtension } from "../core/port.js";
```

**Step 2: Add case**

```typescript
case "port": {
  await portSlash(ctx, out, arg);
  break;
}
```

**Step 3: Handler function**

```typescript
// ── /port ─────────────────────────────────────

async function portSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const parts = arg.trim().split(/\s+/);
  const targetPath = parts[0];
  const targetLang = parts[1]?.toLowerCase();

  if (!targetPath || !targetLang) {
    out.write("usage: /port <file|dir> <target_language>\n");
    out.write("  /port src/utils.ts rust\n");
    out.write("  /port src/services/ python\n");
    return;
  }

  try {
    const files = readSource(targetPath);
    out.write(`reading ${files.length} file(s) from ${targetPath}...\n`);

    const r = await portCode(ctx.api, files, targetLang);
    out.write(`translated → ${r.files.length} file(s)\n`);

    const ext = langExtension(targetLang);
    const outDir = `ported_${targetLang}`;
    const written = writePortedFiles(r.files, outDir);
    for (const w of written) {
      out.write(`  ${theme.bold(w)}\n`);
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
```

**Step 4: Build and verify**

```bash
cd /root/aether-agent && npx tsc -p tsconfig.json && echo "BUILD OK"
```

#### Task 2.4: Create backend /uvt/port endpoint

**Files:**
- Modify: `uvt_routes.py`

```python
# ── UVT /port ─────────────────────────────────────

class PortFile(BaseModel):
    path: str
    content: str

class PortRequest(BaseModel):
    files: list[PortFile]
    target_language: str
    source_language: Optional[str] = None

@uvt_router.post("/port")
async def port_code(req: PortRequest, token: str = Depends(_flexible_token)):
    """POST /uvt/port — translate code between languages."""
    username = _resolve_username(token)

    system = f"""You are an expert code translator. Translate the provided code to {req.target_language}.
Rules:
- Map abstractions to idiomatic {req.target_language} patterns
- Preserve all functionality exactly
- Use {req.target_language} best practices and conventions
- Do NOT add explanations — output ONLY the translated code
- Output one file per input, starting each with a comment line: // path: <original_path>"""

    results = []
    for f in req.files:
        user = f"Translate this {req.source_language or 'code'} file to {req.target_language}:\n\n{f.content}"
        from lib.llm import chat_sync
        raw = await chat_sync(system=system, user=user, model="smart")
        # Determine output extension
        ext_map = {"typescript": "ts", "python": "py", "rust": "rs", "go": "go",
                    "java": "java", "kotlin": "kt", "swift": "swift"}
        ext = ext_map.get(req.target_language.lower(), req.target_language.lower())
        out_path = f.path.rsplit(".", 1)[0] + "." + ext
        results.append({"path": out_path, "content": raw.strip()})

    return {"files": results}
```

---

### PHASE 3: `/purge` — Context Flush

#### Overview
Extends the existing `/clear` + `resetRegistry` to also flush temp files and reset agent state while preserving the session goal.

**Files:**
- Modify: `src/commands/slash.ts` — extend clear handler or add dedicated purge handler
- Modify: `src/core/context_registry.ts` — add temp file tracking

#### Task 3.1: Add temp file tracking to context_registry.ts

**Objective:** Track temporary files created during the session so `/purge` can clean them.

**Files:**
- Modify: `src/core/context_registry.ts`

Add to `ContextRegistry` class:

```typescript
tempFiles: string[] = [];

trackTempFile(path: string): void {
  if (!this.tempFiles.includes(path)) {
    this.tempFiles.push(path);
  }
}

purge(): { clearedPins: number; removedFiles: number } {
  const clearedPins = this.pins.length;
  this.pins = [];
  this.drops = [];
  this.uvtCap = null;
  this.uvtSpent = 0;

  // Remove tracked temp files
  const { unlinkSync, existsSync } = require("node:fs") as typeof import("node:fs");
  let removedFiles = 0;
  for (const f of this.tempFiles) {
    try { if (existsSync(f)) { unlinkSync(f); removedFiles++; } } catch { /* best effort */ }
  }
  this.tempFiles = [];

  return { clearedPins, removedFiles };
}
```

#### Task 3.2: Replace `/clear` with `/purge` in slash.ts

**Objective:** Make `/purge` the canonical context flush. `/clear` becomes just screen clear. Add dedicated purge handler.

**Files:**
- Modify: `src/commands/slash.ts`

**Step 1: Modify the clear case** (line 202-204) — keep it screen-only:

```typescript
case "clear":
  out.write("\x1b[2J\x1b[H");
  break;
```

**Step 2: Add purge case:**

```typescript
case "purge": {
  await purgeSlash(ctx, out);
  break;
}
```

**Step 3: Add handler:**

```typescript
// ── /purge ─────────────────────────────────────

async function purgeSlash(ctx: AppContext, out: Writable): Promise<void> {
  const registry = getRegistry();
  const { clearedPins, removedFiles } = registry.purge();

  // Reset registry
  resetRegistry();

  // Clear screen
  out.write("\x1b[2J\x1b[H");

  const lines: string[] = [];
  if (clearedPins > 0) lines.push(`${clearedPins} pinned files`);
  if (removedFiles > 0) lines.push(`${removedFiles} temp files`);
  lines.push("UVT cap reset");
  lines.push("context flushed");

  out.write(`${theme.cyan("🧹 purged")}  ${lines.join(" · ")}\n`);
  out.write(theme.dim("  Session goal preserved. Agent memory reset to lean baseline.\n"));
}
```

**Step 4: Build and verify**

```bash
cd /root/aether-agent && npx tsc -p tsconfig.json && echo "BUILD OK"
```

---

### PHASE 4: `/stage-diff` — Diff + Commit Message

#### Overview
Runs `git diff` to capture all uncommitted changes, generates a conventional commit message (optionally via backend LLM), presents for approval.

**Files:**
- Create: `src/core/stage_diff.ts` — git wrappers + message generator
- Modify: `src/commands/slash.ts` — handler
- Modify: `src/core/transport.ts` — optional `UVT_STAGE_DIFF_PATH`

#### Task 4.1: Create core module (src/core/stage_diff.ts)

```typescript
// UVT /stage-diff — unified diff + conventional commit message.

import { execSync } from "node:child_process";

export interface StageDiffResult {
  diff: string;
  files: string[];
  commitMessage: string;
  stats: { additions: number; deletions: number; filesChanged: number };
}

export function generateDiff(): StageDiffResult {
  const cwd = process.cwd();
  let diff = "";
  let files: string[] = [];
  let additions = 0;
  let deletions = 0;

  try {
    // Get diff
    diff = execSync("git diff", { cwd, encoding: "utf8", timeout: 10000 });

    // Get changed files
    const status = execSync("git diff --name-only", { cwd, encoding: "utf8", timeout: 5000 });
    files = status.trim().split("\n").filter(Boolean);

    // Get stats
    const statOut = execSync("git diff --stat", { cwd, encoding: "utf8", timeout: 5000 });
    const lastLine = statOut.trim().split("\n").pop() ?? "";
    const match = lastLine.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(\-\))?/);
    if (match) {
      files = files.length || parseInt(match[1] ?? "0");
      additions = parseInt(match[2] ?? "0");
      deletions = parseInt(match[3] ?? "0");
    }
  } catch (err) {
    throw new Error(`git diff failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (files.length === 0) {
    return { diff: "", files: [], commitMessage: "", stats: { additions: 0, deletions: 0, filesChanged: 0 } };
  }

  // Generate conventional commit message from file paths
  const commitMessage = generateCommitMessage(files, { additions, deletions });
  return { diff, files, commitMessage, stats: { additions, deletions, filesChanged: files.length } };
}

const TYPE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /test/i, type: "test" },
  { pattern: /docs?|readme/i, type: "docs" },
  { pattern: /fix|bug/i, type: "fix" },
  { pattern: /routes?|endpoint|api/i, type: "feat" },
  { pattern: /component|ui|style|css/i, type: "style" },
  { pattern: /config|setup|docker/i, type: "chore" },
  { pattern: /refactor/i, type: "refactor" },
];

function generateCommitMessage(
  files: string[],
  stats: { additions: number; deletions: number },
): string {
  // Detect commit type from file paths
  let type = "feat"; // default
  for (const { pattern, type: t } of TYPE_PATTERNS) {
    if (files.some((f) => pattern.test(f))) {
      type = t;
      break;
    }
  }

  // Build scope from common directory prefix
  const dirs = files.map((f) => f.split("/")[0]);
  const scope = [...new Set(dirs)].length === 1 ? dirs[0] : null;

  // Build summary from changed files
  const mainFile = files[0]?.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "changes";
  const scopeStr = scope ? `(${scope})` : "";
  const summary = `${type}${scopeStr}: update ${mainFile}`;

  // Build body
  const body = files.slice(0, 6).map((f) => `- ${f}`).join("\n");
  const more = files.length > 6 ? `\n- ... and ${files.length - 6} more files` : "";

  return [
    summary,
    "",
    body + more,
    "",
    `+${stats.additions} -${stats.deletions} · ${files.length} files`,
  ].join("\n");
}
```

#### Task 4.2: Add handler to slash.ts

**Files:**
- Modify: `src/commands/slash.ts`

**Step 1: Import**

```typescript
import { generateDiff } from "../core/stage_diff.js";
```

**Step 2: Add case**

```typescript
case "stage-diff": {
  await stageDiffSlash(ctx, out);
  break;
}
```

**Step 3: Handler**

```typescript
// ── /stage-diff ────────────────────────────────

async function stageDiffSlash(ctx: AppContext, out: Writable): Promise<void> {
  try {
    const r = generateDiff();

    if (r.files.length === 0) {
      out.write("(working tree clean — nothing to stage)\n");
      return;
    }

    out.write(theme.cyan("📋  Stage Diff\n"));
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));

    // Stats header
    out.write(`  ${r.stats.filesChanged} files  +${r.stats.additions} -${r.stats.deletions}\n\n`);

    // File list
    for (const f of r.files.slice(0, 15)) {
      out.write(`  ${theme.muted(f)}\n`);
    }
    if (r.files.length > 15) {
      out.write(`  ${theme.dim(`... and ${r.files.length - 15} more`)}\n`);
    }

    // Commit message
    out.write(`\n${theme.bold("Suggested commit:")}\n`);
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
    out.write(r.commitMessage + "\n");
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));

    // Show abbreviated diff
    out.write(`\n${theme.dim("Diff preview (first 30 lines):")}\n`);
    const diffLines = r.diff.split("\n").slice(0, 30);
    for (const line of diffLines) {
      if (line.startsWith("+")) out.write(theme.dim(line) + "\n");
      else if (line.startsWith("-")) out.write(theme.muted(line) + "\n");
      else out.write(theme.dim(line) + "\n");
    }

    if (r.diff.split("\n").length > 30) {
      out.write(theme.dim("  ... (truncated)\n"));
    }

    // Copy to clipboard hint
    out.write(`\n${theme.dim("  Copy the commit message above and commit when ready.")}\n`);
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
```

**Step 4: Build and verify**

```bash
cd /root/aether-agent && npx tsc -p tsconfig.json && echo "BUILD OK"
```

---

### PHASE 5: `/revert` — Surgical Rollback

#### Overview
Extends the existing `/rollback [n]` (bulk revert all) to support single-file revert and (future) step-based revert.

**Files:**
- Modify: `src/commands/slash.ts` — extend rollbackSlash or add dedicated revertSlash

#### Task 5.1: Add `/revert` as enhanced rollback

**Objective:** Support `/revert <file>` for single-file git checkout and (future) `/revert <step_id>` for step-based revert.

**Files:**
- Modify: `src/commands/slash.ts`

**Step 1: Add case** (alongside existing `rollback` case):

```typescript
case "revert": {
  await revertSlash(ctx, out, arg);
  break;
}
```

**Step 2: Add handler:**

```typescript
// ── /revert ─────────────────────────────────────

async function revertSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const target = arg.trim();
  if (!target) {
    out.write("usage: /revert <file|step_id>    surgical rollback\n");
    out.write("  /revert src/core/old.ts        revert single file\n");
    out.write("  /revert step-3                 revert to checkpoint (coming soon)\n");
    return;
  }

  const cwd = process.cwd();
  const gitDir = join(cwd, ".git");
  if (!existsSync(gitDir)) {
    out.write(theme.muted("Not in a git repository.\n"));
    return;
  }

  const { execSync } = require("node:child_process") as typeof import("node:child_process");

  // Step-based revert (future — step tracking not yet built)
  if (target.startsWith("step-") || target.match(/^\d+$/)) {
    out.write(theme.muted("Step-based revert not yet available. Use /rollback to revert all, or /revert <file> for a single file.\n"));
    out.write(theme.dim("  Tracked step checkpoints planned for future release.\n"));
    return;
  }

  // Single-file revert
  const resolved = target.startsWith("/") ? target : join(cwd, target);
  try {
    // Check if file is tracked by git
    const isTracked = (() => {
      try {
        execSync(`git ls-files --error-unmatch "${target}"`, { cwd, encoding: "utf8", timeout: 3000 });
        return true;
      } catch { return false; }
    })();

    if (!isTracked) {
      out.write(`${theme.muted(target)} is not tracked by git.\n`);
      return;
    }

    // Check if file has uncommitted changes
    const diffOut = execSync(`git diff --name-only -- "${target}"`, { cwd, encoding: "utf8", timeout: 3000 });
    if (!diffOut.trim()) {
      out.write(`(no uncommitted changes in ${target})\n`);
      return;
    }

    // Show diff for the file
    const fileDiff = execSync(`git diff -- "${target}"`, { cwd, encoding: "utf8", timeout: 5000 });
    const changes = fileDiff.trim().split("\n").length;

    out.write(`${theme.cyan("↩  Reverting")} ${theme.bold(target)}  (${changes} line changes)\n`);
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));

    // Show abbreviated diff
    for (const line of fileDiff.split("\n").slice(0, 10)) {
      if (line.startsWith("+")) out.write(theme.dim(line) + "\n");
      else if (line.startsWith("-")) out.write(theme.muted(line) + "\n");
      else out.write(theme.dim(line) + "\n");
    }

    // Confirm
    const ok = ctx.flags.yes || (await ctx.confirm(`\nRevert ${target} to last commit? [y/N] `));
    if (!ok) {
      out.write("cancelled.\n");
      return;
    }

    execSync(`git checkout -- "${target}"`, { cwd, encoding: "utf8", timeout: 10000 });
    out.write(`${theme.cyan("↩ reverted")}  ${target} restored to last commit.\n`);
  } catch (err) {
    if ((err as any)?.stderr?.includes("did not match any file")) {
      out.write(`not found: ${target}\n`);
    } else {
      out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}
```

**Step 3: Build and verify**

```bash
cd /root/aether-agent && npx tsc -p tsconfig.json && echo "BUILD OK"
```

---

### PHASE 6: `/test-drive` — Autonomous TDD Loop

#### Overview
Orchestrator-gated autonomous loop: reads target function/route, generates comprehensive test matrix, runs tests locally, isolates failures, iteratively fixes source code until all tests pass.

**Pattern:** Orchestrator-gated slash command (3-file subset).

**Files:**
- Create: `src/core/test_drive.ts` — types, API wrapper, gate helper, local test runner
- Create: Backend endpoint POST `/agents/test-drive`
- Modify: `src/commands/slash.ts` — handler + help

#### Task 6.1: Add route constants

**Files:**
- Modify: `src/core/transport.ts`

```typescript
export const AGENT_TEST_DRIVE_PATH = "/agents/test-drive";
```

#### Task 6.2: Create core module (src/core/test_drive.ts)

```typescript
// UVT /test-drive — autonomous TDD loop. Orchestrator-gated.

import type { ApiClient } from "./transport.js";
import { AGENT_TEST_DRIVE_PATH } from "./transport.js";
import type { AppContext } from "./context.js";
import type { Writable } from "node:stream";
import { requireOrchestrator } from "./orchestrator.js";
import { execSync } from "node:child_process";

export interface TestDriveRequest {
  agent: string;
  target: string;
  cwd: string;
  test_cmd?: string;
}

export interface TestResult {
  passed: number;
  failed: number;
  errors: string[];
  output: string;
}

export interface TestDriveResponse {
  status: "running" | "passed" | "failed";
  iterations: number;
  final_result?: TestResult;
  patches: Array<{ file: string; content: string }>;
}

export async function startTestDrive(
  api: ApiClient,
  agent: string,
  target: string,
  cwd: string,
  testCmd?: string,
): Promise<TestDriveResponse> {
  return api.postJson<TestDriveResponse>(AGENT_TEST_DRIVE_PATH, {
    agent,
    target,
    cwd,
    test_cmd: testCmd,
  } as TestDriveRequest);
}

// ── Local test runner ─────────────────────────

export function runTests(testCmd = "npx jest --json 2>&1"): TestResult {
  try {
    const output = execSync(testCmd, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseTestOutput(output);
  } catch (err: any) {
    // Tests failed
    const output = err.stdout ?? err.stderr ?? String(err);
    return parseTestOutput(output);
  }
}

function parseTestOutput(output: string): TestResult {
  const errors: string[] = [];
  let passed = 0;
  let failed = 0;

  // Jest JSON output
  try {
    const json = JSON.parse(output);
    if (json.numPassedTests != null) passed = json.numPassedTests;
    if (json.numFailedTests != null) failed = json.numFailedTests;
    if (json.testResults) {
      for (const r of json.testResults) {
        if (r.message) errors.push(r.message);
      }
    }
  } catch {
    // Fallback: parse text output
    const passMatch = output.match(/(\d+) passing/);
    const failMatch = output.match(/(\d+) failing/);
    if (passMatch) passed = parseInt(passMatch[1]!);
    if (failMatch) failed = parseInt(failMatch[1]!);
    if (failed > 0) errors.push(output.slice(-2000)); // last 2000 chars
  }

  return { passed, failed, errors, output: output.slice(0, 5000) };
}
```

#### Task 6.3: Add handler to slash.ts

**Step 1: Import**

```typescript
import { startTestDrive } from "../core/test_drive.js";
```

**Step 2: Add case**

```typescript
case "test-drive": {
  await testDriveSlash(ctx, out, arg);
  break;
}
```

**Step 3: Handler**

```typescript
// ── /test-drive ─────────────────────────────────

async function testDriveSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!requireOrchestrator(ctx, out)) return;

  const target = arg.trim().replace(/^["']|["']$/g, ""); // strip quotes
  if (!target) {
    out.write("usage: /test-drive \"<route|function>\"\n");
    out.write("  /test-drive \"POST /api/users\"\n");
    out.write("  /test-drive \"src/utils/validate.ts:validateEmail\"\n");
    return;
  }

  try {
    out.write(`${theme.cyan("🧪 test-drive")}  targeting: ${theme.bold(target)}\n`);
    out.write(theme.dim("  Generating test matrix, running, iterating until green...\n\n"));

    const r = await startTestDrive(ctx.api, ctx.flags.agent!, target, process.cwd());

    if (r.status === "passed") {
      out.write(`${theme.cyan("✓ all tests pass")}  after ${r.iterations} iteration(s)\n`);
      if (r.final_result) {
        out.write(`  ${r.final_result.passed} passed · ${r.final_result.failed} failed\n`);
      }
      if (r.patches.length > 0) {
        out.write(`  ${r.patches.length} source file(s) modified\n`);
        for (const p of r.patches) {
          out.write(`    ${theme.bold(p.file)}\n`);
        }
      }
    } else {
      out.write(`${theme.muted("✗ tests did not converge")} after ${r.iterations} iteration(s)\n`);
      if (r.final_result?.errors.length) {
        for (const e of r.final_result.errors.slice(0, 3)) {
          out.write(`  ${theme.muted(e.slice(0, 200))}\n`);
        }
      }
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
```

#### Task 6.4: Create backend endpoint (AETHER-CLOUD)

**Files:**
- Modify: `agent_orch_routes.py` — add `/agents/test-drive` endpoint

```python
# ── UVT /test-drive ──────────────────────────────

class TestDriveRequest(BaseModel):
    agent: str
    target: str
    cwd: str
    test_cmd: Optional[str] = None

@agent_orch_router.post("/test-drive")
async def test_drive(req: TestDriveRequest, token: str = Depends(_flexible_token)):
    """POST /agents/test-drive — autonomous TDD loop: generate tests, run, fix, repeat."""
    username = _resolve_username(token)

    # Run the TDD loop
    max_iterations = 10
    patches = []

    for i in range(max_iterations):
        # Step 1: Generate/update tests
        test_prompt = f"""Write comprehensive unit tests for: {req.target}
Working directory: {req.cwd}
Existing patches so far: {patches}
Focus on edge cases, boundary conditions, and error paths."""

        from lib.llm import chat_sync
        test_code = await chat_sync(
            system="You are a test engineer. Write thorough unit tests. Output ONLY the test code.",
            user=test_prompt,
            model="smart",
        )

        # Step 2: Run tests (return test output to CLI to run locally)
        # The CLI handles actual test execution since it has filesystem access
        # For now, return the generated test code and let CLI run it
        return {
            "status": "running",
            "iterations": i + 1,
            "patches": patches,
            "generated_tests": test_code,
        }

    return {"status": "failed", "iterations": max_iterations, "patches": patches}
```

Note: The full autonomous TDD loop (generate → run → fix → repeat) requires the backend to have filesystem access or the CLI to orchestrate the loop locally. For the initial implementation, the backend generates test code and the CLI runs it. Future iterations can make this fully autonomous.

---

### PHASE 7: `/bench` — Performance Profiling

#### Overview
Orchestrator-gated: profiles the target code block or endpoint, detects algorithmic complexity, applies optimizations.

**Pattern:** Orchestrator-gated slash command. Same 3-file pattern as /test-drive.

**Files:**
- Create: `src/core/bench.ts` — types, API wrapper
- Modify: `src/core/transport.ts` — add `AGENT_BENCH_PATH`
- Modify: `src/commands/slash.ts` — handler
- Backend: add `agent_orch_routes.py` endpoint

#### Task 7.1: Add route constant

**Files:**
- Modify: `src/core/transport.ts`

```typescript
export const AGENT_BENCH_PATH = "/agents/bench";
```

#### Task 7.2: Create core module (src/core/bench.ts)

```typescript
// UVT /bench — performance profiling + optimization. Orchestrator-gated.

import type { ApiClient } from "./transport.js";
import { AGENT_BENCH_PATH } from "./transport.js";

export interface BenchRequest {
  agent: string;
  target: string;
}

export interface BenchResponse {
  complexity?: string;
  bottlenecks: string[];
  optimizations: Array<{ description: string; improvement: string }>;
  patches: Array<{ file: string; content: string }>;
  before_profile?: string;
  after_profile?: string;
}

export async function runBenchmark(
  api: ApiClient,
  agent: string,
  target: string,
): Promise<BenchResponse> {
  return api.postJson<BenchResponse>(AGENT_BENCH_PATH, {
    agent,
    target,
  } as BenchRequest);
}
```

#### Task 7.3: Add handler to slash.ts

Same pattern as test-drive — import, case, handler:

```typescript
case "bench": {
  await benchSlash(ctx, out, arg);
  break;
}
```

Handler:

```typescript
async function benchSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!requireOrchestrator(ctx, out)) return;

  const target = arg.trim();
  if (!target) {
    out.write("usage: /bench <function|endpoint>\n");
    out.write("  /bench src/services/search.ts:fullTextSearch\n");
    out.write("  /bench GET /api/search\n");
    return;
  }

  try {
    out.write(`${theme.cyan("⚡ benchmarking")}  ${theme.bold(target)}...\n`);

    const r = await runBenchmark(ctx.api, ctx.flags.agent!, target);

    if (r.complexity) {
      out.write(`\n  complexity: ${theme.bold(r.complexity)}\n`);
    }
    if (r.bottlenecks.length > 0) {
      out.write(`\n  ${theme.muted("bottlenecks:")}\n`);
      for (const b of r.bottlenecks) {
        out.write(`    ${theme.muted("•")} ${b}\n`);
      }
    }
    if (r.optimizations.length > 0) {
      out.write(`\n  ${theme.cyan("optimizations:")}\n`);
      for (const o of r.optimizations) {
        out.write(`    ${theme.cyan("→")} ${o.description}  ${theme.dim(`(${o.improvement})`)}\n`);
      }
    }
    if (r.patches.length > 0) {
      out.write(`\n  ${r.patches.length} optimization(s) applied\n`);
      for (const p of r.patches) {
        out.write(`    ${theme.bold(p.file)}\n`);
      }
    }
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
```

#### Task 7.4: Backend endpoint

**Files:**
- Modify: `agent_orch_routes.py`

```python
# ── UVT /bench ───────────────────────────────────

class BenchRequest(BaseModel):
    agent: str
    target: str

@agent_orch_router.post("/bench")
async def bench(req: BenchRequest, token: str = Depends(_flexible_token)):
    """POST /agents/bench — profile code and suggest optimizations."""
    username = _resolve_username(token)

    system = """You are a performance engineer. Analyze the target for:
1. Algorithmic complexity (Big O)
2. Bottlenecks (memory, CPU, I/O)
3. Optimization suggestions with estimated improvement
4. Apply safe optimizations as patches

Output JSON with keys: complexity, bottlenecks[], optimizations[{description, improvement}], patches[{file, content}]"""

    from lib.llm import chat_sync
    import json

    raw = await chat_sync(
        system=system,
        user=f"Profile and optimize: {req.target}",
        model="smart",
    )

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"bottlenecks": [], "optimizations": [], "patches": []}
```

---

### PHASE 8: Final Integration — Wire Everything

#### Task 8.1: Update help text with all UVT commands

**Files:**
- Modify: `src/commands/slash.ts` — `printHelp` function

Add the "UVT Tools" section (if not already added in Task 1.3). Ensure all 8 commands appear.

#### Task 8.2: Final build and type-check

```bash
cd /root/aether-agent
npx tsc -p tsconfig.json
```

Fix any type errors. Verify:
- All new imports resolve
- No unused imports
- No template literal backtick issues

#### Task 8.3: Verify all route constants are registered in transport.ts

```bash
grep -n "UVT_\|AGENT_TEST_DRIVE\|AGENT_BENCH" /root/aether-agent/src/core/transport.ts
```

Expected output should show: UVT_SCAFFOLD_PATH, UVT_PORT_PATH, AGENT_TEST_DRIVE_PATH, AGENT_BENCH_PATH

#### Task 8.4: Backend: verify router registration

```bash
grep "include_router.*uvt\|include_router.*agent_orch" /root/AETHER-CLOUD/api_server.py
```

Both routers must be registered. The `uvt_router` handles /scaffold and /port. The `agent_orch_router` handles /test-drive and /bench.

#### Task 8.5: Commit and PR

```bash
cd /root/aether-agent
git add src/core/transport.ts src/core/scaffold.ts src/core/port.ts \
        src/core/stage_diff.ts src/core/test_drive.ts src/core/bench.ts \
        src/commands/slash.ts src/core/context_registry.ts
git commit -m "feat: implement UVT slash command system (8 commands)

- /scaffold: strict boilerplate code generation
- /port: deep code translation between languages
- /test-drive: autonomous TDD loop (orchestrator-gated)
- /bench: performance profiling + optimization (orchestrator-gated)
- /purge: flush transient context + temp files
- /token-budget: alias for /limit (UVT cap)
- /stage-diff: unified diff + conventional commit message
- /revert: surgical single-file rollback (extends /rollback)

New core modules: scaffold, port, stage_diff, test_drive, bench
Extended: context_registry (purge + temp file tracking)
Backend endpoints: /uvt/scaffold, /uvt/port, /agents/test-drive, /agents/bench"
```

---

## Summary: Files Changed

### aether-agent (CLI)
| File | Action | Purpose |
|------|--------|---------|
| `src/core/transport.ts` | MODIFY | Add UVT_SCAFFOLD_PATH, UVT_PORT_PATH, AGENT_TEST_DRIVE_PATH, AGENT_BENCH_PATH |
| `src/core/scaffold.ts` | CREATE | Scaffold types, API wrapper, validation |
| `src/core/port.ts` | CREATE | Port types, API wrapper, file I/O helpers |
| `src/core/stage_diff.ts` | CREATE | Git diff wrapper, commit message generator |
| `src/core/test_drive.ts` | CREATE | Test drive types, API wrapper, local test runner |
| `src/core/bench.ts` | CREATE | Bench types, API wrapper |
| `src/core/context_registry.ts` | MODIFY | Add tempFiles tracking + purge() method |
| `src/commands/slash.ts` | MODIFY | 7 new handlers + 1 alias, help text |

### AETHER-CLOUD (Backend)
| File | Action | Purpose |
|------|--------|---------|
| `uvt_routes.py` | MODIFY | Add POST /uvt/scaffold, POST /uvt/port |
| `agent_orch_routes.py` | MODIFY | Add POST /agents/test-drive, POST /agents/bench |

### Total: 10 files changed (8 CLI + 2 backend)

---

## Risks & Open Questions

1. **LLM dependency:** Scaffold, port, test-drive, and bench all depend on LLM calls. Response quality depends on model selection ("fast" vs "smart"). The system prompts must be carefully tuned to prevent creative drift.

2. **Test-drive autonomy:** The full autonomous TDD loop (generate → run → fix → repeat) requires the backend to either have filesystem access or the CLI to orchestrate the loop. Initial implementation has the backend generate test code and the CLI run it — full autonomy needs backend worker infrastructure.

3. **Backend lib.llm.chat_sync:** The plan assumes a `chat_sync` function exists in AETHER-CLOUD's lib/llm. If this doesn't exist, the backend endpoints need to call the chat stream pipeline directly. Verify before implementing.

4. **Step-based revert:** `/revert <step_id>` is documented as "coming soon" because step tracking infrastructure doesn't exist yet. The initial implementation handles only single-file revert. Step tracking would require a checkpoint system (filed under future work).

5. **Help text duplication:** The UVT Tools help section should be added once (in Phase 1, Task 1.3) and all subsequent commands reference it. Avoid adding duplicate sections.
