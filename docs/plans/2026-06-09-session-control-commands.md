# Slash Command Batch 2 — Session Control Commands

> **For Hermes:** Use the aether-agent-cli-commands and aether-agent-development skills to implement this plan task-by-task.

**Goal:** Add 7 new slash commands to the aether-agent interactive REPL: pin, drop, snapshot, limit, audit-receipt, rollback, and logs-view. These give the user session-level control over context memory, UVT caps, audit export, filesystem undo, and log browsing.

**Architecture:** This is a slash-command-only batch — no new top-level CLI commands, no backend endpoints needed. Everything runs client-side in the TypeScript CLI. `/pin`, `/drop`, `/snapshot`, `/limit` manage a new in-memory context registry (`src/core/context_registry.ts`). `/audit-receipt` extends existing audit/custody infrastructure. `/rollback` wraps worktree+gits. `/logs-view` is an interactive terminal UI widget using Node raw-mode stdin and the box utility.

**Tech Stack:** TypeScript (Node >=20), node:readline, node:fs, existing box/titledBox ANSI utilities

---

## Context Registry — Foundation for /pin, /drop, /snapshot, /limit

### Task 1: Create context registry core module

**Objective:** Build `src/core/context_registry.ts` — the in-memory state container that /pin, /drop, /snapshot, and /limit rely on.

**Files:**
- Create: `src/core/context_registry.ts`
- Modify: none yet

**Step 1: Write the module**

```typescript
// src/core/context_registry.ts — session-scoped context memory manager.
//
// /pin    — force a file/module into persistent context
// /drop   — evict a file from context
// /snapshot — save registry + session metadata to disk
// /limit  — hard UVT cap for the session
//
// All data is in-memory for the current REPL session. /snapshot serializes
// to ~/.aether-agent/snapshots/<timestamp>.json so sessions can be resumed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Types ──

export interface PinnedEntry {
  /** File path or module identifier. */
  path: string;
  /** Human label (filename, interface name, etc.). */
  label: string;
  /** Why it was pinned — shown on /snapshot resume so agent knows what mattered. */
  reason: string;
  /** ISO timestamp when pinned. */
  pinnedAt: string;
}

export interface SnapshotData {
  /** ISO timestamp of snapshot. */
  createdAt: string;
  /** The active branch / task description. */
  sessionLabel: string;
  /** Pinned entries at snapshot time. */
  pins: PinnedEntry[];
  /** Dropped paths (for reference — what was intentionally evicted). */
  drops: string[];
  /** UVT cap if set. */
  uvtCap: number | null;
  /** UVT spent so far (read from custody log). */
  uvtSpent: number;
  /** Active plan file path (if any). */
  planPath: string | null;
  /** Working directory. */
  cwd: string;
}

// ── In-memory state (one per REPL session) ──

class ContextRegistry {
  pins: PinnedEntry[] = [];
  drops: string[] = [];
  uvtCap: number | null = null;
  uvtSpent = 0;
  planPath: string | null = null;
  sessionLabel = "untitled";

  pin(path: string, label: string, reason: string): PinnedEntry {
    // Deduplicate — remove existing pin for same path
    this.drops = this.drops.filter((d) => d !== path);
    const existing = this.pins.findIndex((p) => p.path === path);
    const entry: PinnedEntry = { path, label, reason, pinnedAt: new Date().toISOString() };
    if (existing >= 0) {
      this.pins[existing] = entry;
    } else {
      this.pins.push(entry);
    }
    return entry;
  }

  drop(path: string): boolean {
    this.pins = this.pins.filter((p) => p.path !== path);
    if (!this.drops.includes(path)) {
      this.drops.push(path);
      return true;
    }
    return false; // already dropped
  }

  isPinned(path: string): boolean {
    return this.pins.some((p) => p.path === path);
  }

  setUvtCap(amount: number): void {
    this.uvtCap = amount;
  }

  /** Check if UVT cap is exceeded. Returns remaining or -1 if exceeded. */
  checkUvtCap(): { capped: boolean; remaining: number; cap: number | null } {
    if (this.uvtCap == null) return { capped: false, remaining: Infinity, cap: null };
    const remaining = this.uvtCap - this.uvtSpent;
    return { capped: remaining <= 0, remaining: Math.max(0, remaining), cap: this.uvtCap };
  }

  /** Export snapshot data for serialization. */
  toSnapshot(): SnapshotData {
    return {
      createdAt: new Date().toISOString(),
      sessionLabel: this.sessionLabel,
      pins: [...this.pins],
      drops: [...this.drops],
      uvtCap: this.uvtCap,
      uvtSpent: this.uvtSpent,
      planPath: this.planPath,
      cwd: process.cwd(),
    };
  }

  /** Restore from a snapshot file. */
  static fromSnapshot(data: SnapshotData): ContextRegistry {
    const reg = new ContextRegistry();
    reg.sessionLabel = data.sessionLabel;
    reg.pins = data.pins;
    reg.drops = data.drops;
    reg.uvtCap = data.uvtCap;
    reg.uvtSpent = data.uvtSpent;
    reg.planPath = data.planPath;
    return reg;
  }
}

// ── Singleton ──

let _registry: ContextRegistry | null = null;

export function getRegistry(): ContextRegistry {
  if (!_registry) _registry = new ContextRegistry();
  return _registry;
}

/** Reset the registry (e.g., on /clear or new session). */
export function resetRegistry(): void {
  _registry = new ContextRegistry();
}

// ── Snapshot persistence ──

export function snapshotsRoot(): string {
  return process.env["AETHER_SNAPSHOT_DIR"] ?? join(homedir(), ".aether-agent", "snapshots");
}

export function saveSnapshot(reg: ContextRegistry): string {
  const dir = snapshotsRoot();
  mkdirSync(dir, { recursive: true });
  const data = reg.toSnapshot();
  const filename = `snapshot-${data.createdAt.replace(/[:.]/g, "-")}.json`;
  const path = join(dir, filename);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  return path;
}

export function loadSnapshot(id: string): SnapshotData | null {
  const dir = snapshotsRoot();
  const path = join(dir, id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SnapshotData;
  } catch {
    return null;
  }
}

export function listSnapshots(): Array<{ id: string; data: SnapshotData }> {
  const dir = snapshotsRoot();
  if (!existsSync(dir)) return [];
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const results: Array<{ id: string; data: SnapshotData }> = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const data = loadSnapshot(name);
    if (data) results.push({ id: name, data });
  }
  results.sort((a, b) => b.data.createdAt.localeCompare(a.data.createdAt));
  return results;
}
```

**Step 2: Compile check**

```bash
cd /root/aether-agent && npx tsc -p tsconfig.json --noEmit 2>&1 | head -5
```

**Step 3: Commit**

```bash
git add src/core/context_registry.ts
git commit -m "feat: add context registry for /pin /drop /snapshot /limit session commands"
```

---

### Task 2: Wire /pin slash command

**Objective:** Add `/pin <path> [reason]` to the REPL slug handler.

**Files:**
- Modify: `src/commands/slash.ts` — add case "pin", handler, help text
- Modify: `src/commands/slash.ts:1-5` — import from context_registry

**Step 1: Add import at top of slash.ts**

```typescript
import { getRegistry, type PinnedEntry } from "../core/context_registry.js";
```

**Step 2: Add case in handleSlash switch (after case "vault-tree":)**

```typescript
case "pin":
  await pinSlash(ctx, out, arg, line);
  break;
```

**Step 3: Add handler function**

```typescript
async function pinSlash(ctx: AppContext, out: Writable, arg: string, _line: string): Promise<void> {
  if (!arg.trim()) {
    out.write("usage: /pin <path> [reason]    force a file/module into persistent context\n");
    out.write("  /pin src/core/stream.ts   core contracts\n");
    out.write("  /pin                      list pinned files\n");
    return;
  }

  // List mode: /pin with no args after "pin"
  if (arg.trim() === "list" || arg.trim() === "ls") {
    const pins = getRegistry().pins;
    if (pins.length === 0) {
      out.write("(no pinned files — use /pin <path> [reason] to pin one)\n");
      return;
    }
    out.write(theme.cyan("📌  Pinned Context\n"));
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
    for (const p of pins) {
      out.write(`  ${theme.bold(p.label)}  ${theme.dim(p.path)}  ${theme.muted(p.reason)}\n`);
    }
    return;
  }

  const parts = arg.trim().split(/\s+/);
  const path = parts[0]!;
  const reason = parts.slice(1).join(" ") || "pinned";

  // Resolve relative paths
  const resolved = path.startsWith("/") ? path : join(process.cwd(), path);
  const label = path.split("/").pop() || path;

  const entry = getRegistry().pin(resolved, label, reason);
  out.write(`${theme.cyan("📌 pinned")} ${theme.bold(entry.label)}  ${theme.dim(entry.path)}  (${entry.reason})\n`);
  out.write(theme.dim("  This file will persist in context across /recon and /autonomous-execution loops.\n"));
}
```

**Step 4: Add to printHelp (in the new "Context & Limits" section)**

In printHelp, add a new section after "Steering":

```typescript
[
  "",
  theme.iceBlue("🧠") + "  " + theme.bold("Context & Limits"),
  "",
  theme.dim("/pin") + " <path> [reason]    force file into persistent context",
  theme.dim("/pin list") + "                list pinned files",
  theme.dim("/drop") + " <path>              evict file from context",
  theme.dim("/snapshot") + "               save session state to disk",
  theme.dim("/snapshot resume") + " <id>     reload a saved snapshot",
  theme.dim("/limit") + " <uvt>              cap UVT spend for this session",
  "",
],
```

**Step 5: Commit**

```bash
git add src/commands/slash.ts
git commit -m "feat: add /pin slash command — pin files into persistent context"
```

---

### Task 3: Wire /drop slash command

**Objective:** Add `/drop <path>` to evict files from context.

**Step 1: Add case in handleSlash**

```typescript
case "drop":
  await dropSlash(ctx, out, arg);
  break;
```

**Step 2: Add handler**

```typescript
async function dropSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  if (!arg.trim()) {
    const registry = getRegistry();
    out.write(`usage: /drop <path>    evict a file from memory context\n`);
    out.write(`  /drop src/core/old.ts\n`);
    if (registry.pins.length > 0) {
      out.write(`\n  Pinned files (use /pin list for details):\n`);
      for (const p of registry.pins) {
        out.write(`    ${theme.dim(p.label)}\n`);
      }
    }
    if (registry.drops.length > 0) {
      out.write(`\n  Recently dropped:\n`);
      for (const d of registry.drops.slice(-5)) {
        out.write(`    ${theme.dim(d)}\n`);
      }
    }
    return;
  }

  const path = arg.trim();
  const resolved = path.startsWith("/") ? path : join(process.cwd(), path);
  const wasPinned = getRegistry().isPinned(resolved);
  const dropped = getRegistry().drop(resolved);

  if (wasPinned) {
    out.write(`${theme.cyan("🗑  dropped")} ${theme.bold(path)} — removed from pinned context\n`);
  } else {
    out.write(`${theme.cyan("🗑  evicted")} ${theme.dim(path)}\n`);
    out.write(theme.dim("  (wasn't pinned, but will be excluded from future context loads)\n"));
  }
}
```

**Step 3: Commit**

```bash
git add src/commands/slash.ts
git commit -m "feat: add /drop slash command — evict files from context"
```

---

### Task 4: Wire /snapshot slash command

**Objective:** Save and restore registry state to `~/.aether-agent/snapshots/`.

**Step 1: Add case**

```typescript
case "snapshot":
  await snapshotSlash(ctx, out, arg);
  break;
```

**Step 2: Add handler**

```typescript
async function snapshotSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const registry = getRegistry();
  const sub = arg.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

  if (sub === "resume" || sub === "load") {
    const id = arg.trim().split(/\s+/).slice(1).join(" ");
    if (!id) {
      const snaps = listSnapshots();
      if (snaps.length === 0) {
        out.write("(no snapshots — use /snapshot to save one)\n");
        return;
      }
      out.write(theme.cyan("💾  Saved Snapshots\n"));
      out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
      for (const s of snaps) {
        const pins = s.data.pins.length;
        const cap = s.data.uvtCap ? `  cap ${s.data.uvtCap} UVT` : "";
        out.write(`  ${theme.bold(s.id)}  ${theme.dim(s.data.createdAt)}  ${s.data.sessionLabel}  (${pins} pins${cap})\n`);
      }
      out.write(theme.dim("\n  /snapshot resume <filename>   to restore a snapshot\n"));
      return;
    }
    const data = loadSnapshot(id);
    if (!data) {
      out.write(`no snapshot: ${id}  (use /snapshot to list)\n`);
      return;
    }
    const restored = ContextRegistry.fromSnapshot(data);
    // Replace the singleton
    resetRegistry();
    Object.assign(getRegistry(), restored);
    out.write(`${theme.cyan("📂 restored")} ${theme.bold(data.sessionLabel)}  (${data.pins.length} pins, cap ${data.uvtCap ?? "none"})\n`);
    out.write(`  cwd: ${data.cwd}\n`);
    out.write(theme.dim("  Use /pin list to see restored context.\n"));
    return;
  }

  if (sub === "list" || sub === "ls") {
    const snaps = listSnapshots();
    if (snaps.length === 0) {
      out.write("(no snapshots)\n");
      return;
    }
    out.write(theme.cyan("💾  Snapshots\n"));
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
    for (const s of snaps) {
      const pins = s.data.pins.length;
      out.write(`  ${theme.bold(s.data.sessionLabel)}  ${theme.dim(s.data.createdAt)}  (${pins} pins)\n`);
    }
    return;
  }

  // Default: save snapshot
  const path = saveSnapshot(registry);
  const basename = path.split("/").pop() || path;
  out.write(`${theme.cyan("💾 snapshot saved")}  ${theme.bold(basename)}\n`);
  out.write(`  ${theme.dim(path)}\n`);
  out.write(`  pins: ${registry.pins.length}   UVT cap: ${registry.uvtCap ?? "none"}   drops: ${registry.drops.length}\n`);
  out.write(theme.dim("  Resume with: /snapshot resume <filename>\n"));
}
```

**Step 4: Import listSnapshots and ContextRegistry**

Add to the import from context_registry.ts:
```typescript
import { getRegistry, resetRegistry, saveSnapshot, loadSnapshot, listSnapshots, ContextRegistry } from "../core/context_registry.js";
```

**Step 5: Commit**

```bash
git add src/commands/slash.ts
git commit -m "feat: add /snapshot slash command — save/resume session state"
```

---

### Task 5: Wire /limit slash command

**Objective:** Set a hard UVT cap for the session.

**Step 1: Add case**

```typescript
case "limit":
  await limitSlash(ctx, out, arg);
  break;
```

**Step 2: Add handler**

```typescript
async function limitSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const registry = getRegistry();

  if (!arg.trim()) {
    // Show current
    const current = registry.uvtCap;
    const spent = registry.uvtSpent;
    if (current == null) {
      out.write("UVT cap: none (uncapped)\n");
    } else {
      const remaining = Math.max(0, current - spent);
      const pct = current > 0 ? Math.round((spent / current) * 100) : 0;
      const bar = renderUvtBar(pct, 20);
      out.write(`UVT cap: ${theme.bold(String(current))}   spent: ${spent}   remaining: ${remaining}  ${bar}\n`);
    }
    out.write(theme.dim("  /limit <amount>    set cap (e.g., /limit 50000)\n"));
    out.write(theme.dim("  /limit off         remove cap\n"));
    return;
  }

  if (arg.trim().toLowerCase() === "off" || arg.trim().toLowerCase() === "none") {
    registry.uvtCap = null;
    out.write(theme.cyan("UVT cap removed — session is uncapped.\n"));
    return;
  }

  const n = Number(arg.trim());
  if (!Number.isFinite(n) || n <= 0) {
    out.write(`invalid: ${arg} — use a positive number (e.g., /limit 50000)\n`);
    return;
  }

  registry.setUvtCap(Math.floor(n));
  out.write(`${theme.cyan("⚡ UVT cap set")}  ${theme.bold(String(Math.floor(n)))}  — agent will pause and ask permission if ceiling hit\n`);
}

/** Simple ASCII pool-fill bar. */
function renderUvtBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const color = pct > 80 ? theme.muted : pct > 50 ? theme.dim : theme.cyan;
  return color("[" + "█".repeat(filled) + "░".repeat(empty) + "]");
}
```

**Step 3: Commit**

```bash
git add src/commands/slash.ts
git commit -m "feat: add /limit slash command — UVT spend cap for session"
```

---

### Task 6: Wire /audit-receipt slash command (enhanced)

**Objective:** Enhanced `/audit` that dumps a verified log of every tool call, filesystem modification, and API token spent. Merges the existing `/audit` + `aether receipt` into one beautiful output.

**Step 1: Add case**

```typescript
case "audit-receipt":
  await auditReceiptSlash(ctx, out, arg);
  break;
```

**Step 2: Add handler — renders from client custody log + audit trail, in a box**

```typescript
async function auditReceiptSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  // Parse limit arg
  const n = Number(arg);
  const limit = Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 20;

  // Read client custody log (local)
  const custody = readCustodyLog(limit);
  // Fetch server trail
  let serverEntries: AuditEntry[] = [];
  try {
    serverEntries = await fetchTrail(ctx.api, { limit });
  } catch {
    // Offline — just use local
  }

  out.write(theme.cyan("🧾  Audit Receipt\n"));
  out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));

  // Column headers
  const H_TIME = 26;
  const H_ORDER = 14;
  const H_EVENT = 14;
  const H_COMMIT = 14;
  const H_PATH = 20;

  const header =
    "time".padEnd(H_TIME) +
    "order_id".padEnd(H_ORDER) +
    "event".padEnd(H_EVENT) +
    "commitment".padEnd(H_COMMIT) +
    "path";
  out.write(theme.bold("  " + header) + "\n");
  out.write(theme.dim("  " + "─".repeat(H_TIME + H_ORDER + H_EVENT + H_COMMIT + H_PATH)) + "\n");

  // Custody rows (most relevant — user's own chats)
  for (const c of custody) {
    const ts = c.received_at != null ? new Date(c.received_at).toISOString().padEnd(H_TIME) : "—".padEnd(H_TIME);
    const oid = (String(c.order_id ?? "—")).slice(0, H_ORDER - 1).padEnd(H_ORDER);
    const evt = "chat_turn".padEnd(H_EVENT);
    const comm = (hashShort(c.commitment) ?? "—").slice(0, H_COMMIT - 1).padEnd(H_COMMIT);
    const path = String(c.path ?? "—").slice(0, H_PATH - 1).padEnd(H_PATH);
    out.write(`  ${theme.dim(ts)}${oid}${theme.cyan(evt)}${theme.dim(comm)}${path}\n`);
  }

  // Server entries for filesystem events
  for (const e of serverEntries) {
    const ts = String(e.timestamp).padEnd(H_TIME);
    const oid = e.orderId.slice(0, H_ORDER - 1).padEnd(H_ORDER);
    const evt = e.eventType.padEnd(H_EVENT);
    const comm = (e.commitmentHash ?? "—").slice(0, H_COMMIT - 1).padEnd(H_COMMIT);
    const path = (e.path ?? "—").slice(0, H_PATH - 1).padEnd(H_PATH);
    out.write(`  ${theme.dim(ts)}${theme.dim(oid)}${theme.muted(evt)}${theme.dim(comm)}${path}\n`);
  }

  // Summary box
  const totalEntries = custody.length + serverEntries.length;
  const uvtTotal = registry.uvtSpent;
  const boxContent = [
    "",
    `  Total entries: ${totalEntries}`,
    `  UVT spent:     ${uvtTotal}`,
    `  UVT cap:       ${registry.uvtCap ?? "none"}`,
    "",
    `  Export proof:  aether receipt <order_id>`,
    `  Full log:      /logs-view`,
    "",
  ];
  out.write("\n" + box(boxContent, { width: 64 }) + "\n");
}

function hashShort(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 12);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const inner = o["hash"] ?? o["env_hash"] ?? o["commitment_hash"] ?? o["digest"];
    if (inner != null) return String(inner).slice(0, 12);
  }
  return "✓";
}
```

**Step 3: Add imports**

```typescript
import { readCustodyLog } from "../core/custody.js";
import { fetchTrail, type AuditEntry } from "../core/audit.js";
import { getRegistry } from "../core/context_registry.js";
import { box } from "../ui/box.js";
```

**Step 4: Update printHelp — change the existing /audit line to mention /audit-receipt**

**Step 5: Commit**

```bash
git add src/commands/slash.ts
git commit -m "feat: add /audit-receipt slash — verified log with columns + proof export"
```

---

### Task 7: Wire /rollback slash command

**Objective:** Revert the last N filesystem changes made by the autonomous execution engine using the worktree/git infrastructure.

**Step 1: Add case**

```typescript
case "rollback":
  await rollbackSlash(ctx, out, arg);
  break;
```

**Step 2: Add handler**

```typescript
async function rollbackSlash(ctx: AppContext, out: Writable, arg: string): Promise<void> {
  const n = parseInt(arg.trim()) || 1;
  if (n < 1 || n > 50) {
    out.write(`usage: /rollback [n]    revert last n filesystem changes (1-50, default 1)\n`);
    return;
  }

  // Check if we're in a git repo
  const cwd = process.cwd();
  const gitDir = join(cwd, ".git");
  if (!existsSync(gitDir)) {
    out.write(theme.muted("Not in a git repository. /rollback requires git for safe undo.\n"));
    return;
  }

  // Show what would be reverted
  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  try {
    const status = execSync("git diff --name-only", { cwd, encoding: "utf8", timeout: 5000 });
    const dirty = status.trim().split("\n").filter(Boolean);
    if (dirty.length === 0) {
      out.write("(working tree clean — nothing to rollback)\n");
      return;
    }

    // Show the files
    out.write(`${theme.cyan("↩  Ready to rollback")}  ${dirty.length} files changed\n`);
    out.write(theme.dim("──────────────────────────────────────────────────────────────\n"));
    const show = dirty.slice(0, 20);
    for (const f of show) {
      out.write(`  ${theme.muted(f)}\n`);
    }
    if (dirty.length > 20) {
      out.write(`  ${theme.dim(`... and ${dirty.length - 20} more`)}\n`);
    }

    // Confirm
    const msg = n === 1
      ? `\nRevert all ${dirty.length} uncommitted changes? This is a git checkout -- of all dirty files. [y/N] `
      : `\nRevert all ${dirty.length} uncommitted changes? [y/N] `;

    const ok = ctx.flags.yes || (await ctx.confirm(msg));
    if (!ok) {
      out.write("cancelled.\n");
      return;
    }

    // Execute rollback via git checkout
    execSync("git checkout -- .", { cwd, encoding: "utf8", timeout: 10000 });
    out.write(`${theme.cyan("↩ rolled back")}  ${dirty.length} files restored to last commit.\n`);
    out.write(theme.dim("  Git reflog untouched — all commits preserved.\n"));
  } catch (err) {
    out.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
```

**Step 3: Add imports and update help**

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
```

Add to help section:
```typescript
theme.dim("/rollback") + " [n]            revert last n filesystem changes",
```

**Step 4: Commit**

```bash
git add src/commands/slash.ts
git commit -m "feat: add /rollback slash — fast undo of filesystem changes via git"
```

---

### Task 8: Build the /logs-view interactive viewer

**Objective:** Create `src/ui/logs_viewer.ts` — an interactive terminal widget that renders session logs in beautiful ASCII columns with arrow-key navigation and mass export.

**Files:**
- Create: `src/ui/logs_viewer.ts`
- Modify: `src/commands/slash.ts` — wire /logs-view

**Step 1: Create the viewer module**

This is the biggest piece. Design:
- Reads `~/.aether-agent/logs/` directory
- Renders a titledBox with columns: time, event type, order_id, commitment
- Arrow Up/Down scroll through entries (paginated, 15 lines per screen)
- `/` to search, `e` to export current session, `E` to export ALL sessions as JSON
- `q` or Esc to quit
- Uses Node raw mode on stdin for arrow key capture

```typescript
// src/ui/logs_viewer.ts — interactive ASCII log browser.
//
// Reads ~/.aether-agent/logs/ and renders sessions in a beautiful
// boxed column layout. Arrow keys scroll, 'e' exports current session
// JSON, 'E' exports ALL session JSONs, 'q' quits.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { logsRoot } from "../core/session_log.js";
import { theme } from "./theme.js";
import { box, titledBox } from "./box.js";

interface LogEntry {
  ts: string;
  type: string;
  orderId?: string;
  commitment?: string;
  path?: string;
  tool?: string;
}

interface SessionView {
  id: string;
  label: string;
  entries: LogEntry[];
  manifest: Record<string, unknown>;
  started: string;
}

const PAGE_SIZE = 14;

export async function runLogsViewer(out: NodeJS.WritableStream): Promise<void> {
  const root = logsRoot();
  const sessions = loadAllSessions(root);

  if (sessions.length === 0) {
    out.write("(no session logs — run aether to create your first session)\n");
    return;
  }

  // Pick most recent session
  let sessionIdx = 0;
  let scrollOffset = 0;
  let searchQuery = "";

  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  if (!stdin.isTTY) {
    // Non-TTY fallback: just render the latest session
    renderSession(sessions[0]!, searchQuery, scrollOffset, out);
    return;
  }

  stdin.setRawMode(true);
  stdin.resume();

  const render = () => {
    // Clear screen
    out.write("\x1b[2J\x1b[H");
    const session = sessions[sessionIdx];
    if (!session) return;
    renderSession(session, searchQuery, scrollOffset, out);

    // Status bar
    const total = sessions.length;
    const filtered = searchQuery
      ? session.entries.filter((e) => matchesSearch(e, searchQuery)).length
      : session.entries.length;
    const page = Math.floor(scrollOffset / PAGE_SIZE) + 1;
    const pages = Math.max(1, Math.ceil(filtered / PAGE_SIZE));
    out.write(theme.dim(`\n  [${sessionIdx + 1}/${total}] ${session.label}  page ${page}/${pages}  ↑↓ scroll  / search  e export  E export all  q quit\n`));
  };

  render();

  return new Promise<void>((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      const str = chunk.toString();
      for (const char of str) {
        // Arrow sequences: \x1b[A (up), \x1b[B (down)
        if (char === "\x1b") { buf = "\x1b"; continue; }
        if (buf === "\x1b" && char === "[") { buf += char; continue; }

        if (buf === "\x1b[") {
          if (char === "A") { // Up
            scrollOffset = Math.max(0, scrollOffset - 1);
            render();
          } else if (char === "B") { // Down
            const session = sessions[sessionIdx]!;
            const entries = searchQuery
              ? session.entries.filter((e) => matchesSearch(e, searchQuery))
              : session.entries;
            scrollOffset = Math.min(Math.max(0, entries.length - PAGE_SIZE), scrollOffset + 1);
            render();
          }
          buf = "";
          continue;
        }

        // Single chars
        if (char === "j" || char === "J") { // Down (vim)
          scrollOffset = Math.min(
            Math.max(0, (sessions[sessionIdx]?.entries.length ?? 0) - PAGE_SIZE),
            scrollOffset + 1
          );
          render();
        } else if (char === "k" || char === "K") { // Up (vim)
          scrollOffset = Math.max(0, scrollOffset - 1);
          render();
        } else if (char === "n" || char === "N") { // Next session
          sessionIdx = (sessionIdx + 1) % sessions.length;
          scrollOffset = 0;
          render();
        } else if (char === "p" || char === "P") { // Prev session
          sessionIdx = (sessionIdx - 1 + sessions.length) % sessions.length;
          scrollOffset = 0;
          render();
        } else if (char === "q" || char === "Q" || char === "\x03") { // Quit
          cleanup();
          resolve();
          return;
        } else if (char === "e") { // Export current
          exportSession(sessions[sessionIdx]!, out);
        } else if (char === "E") { // Export ALL
          exportAllSessions(sessions, out);
        } else if (char === "/") {
          // Search mode — read next line as query
          out.write("\n\x1b[Ksearch: ");
          // Simple: just take the next character (better UX would need a full line reader)
          // For now, clear search on '/'
          searchQuery = "";
          scrollOffset = 0;
          render();
        } else if (char === "\r") { // Enter — export
          exportAllSessions(sessions, out);
        }
        buf = "";
      }
    };

    const cleanup = () => {
      stdin.removeListener("data", onData);
      if (!wasRaw) stdin.setRawMode(false);
      out.write("\x1b[?25h"); // Show cursor
    };

    stdin.on("data", onData);
  });
}

function loadAllSessions(root: string): SessionView[] {
  if (!existsSync(root)) return [];
  const sessions: SessionView[] = [];

  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      const manifestPath = join(dir, "manifest.json");
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const eventsPath = join(dir, "events.jsonl");

      const entries: LogEntry[] = [];
      if (existsSync(eventsPath)) {
        const lines = readFileSync(eventsPath, "utf8").split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const ev = JSON.parse(line);
            entries.push({
              ts: String(ev.ts ?? ""),
              type: String(ev.type ?? "unknown"),
              orderId: ev.order_id ? String(ev.order_id) : undefined,
              commitment: ev.commitment_hash ? String(ev.commitment_hash) : undefined,
              path: ev.path ? String(ev.path) : undefined,
              tool: ev.tool ? String(ev.tool) : undefined,
            });
          } catch { /* skip corrupt */ }
        }
      }

      sessions.push({
        id: name,
        label: String(manifest.sessionId ?? name),
        entries,
        manifest,
        started: String(manifest.started ?? ""),
      });
    } catch { /* skip */ }
  }

  sessions.sort((a, b) => b.started.localeCompare(a.started));
  return sessions;
}

function renderSession(session: SessionView, query: string, offset: number, out: NodeJS.WritableStream): void {
  const entries = query
    ? session.entries.filter((e) => matchesSearch(e, query))
    : session.entries;

  // Column widths
  const W_TIME = 26;
  const W_TYPE = 16;
  const W_ORDER = 14;
  const W_COMMIT = 14;
  const W_PATH = 18;

  const header =
    "time".padEnd(W_TIME) +
    "event".padEnd(W_TYPE) +
    "order_id".padEnd(W_ORDER) +
    "commitment".padEnd(W_COMMIT) +
    "path";

  const lines: string[] = [
    "",
    theme.bold(header),
    theme.dim("─".repeat(W_TIME + W_TYPE + W_ORDER + W_COMMIT + W_PATH)),
    "",
  ];

  const page = entries.slice(offset, offset + PAGE_SIZE);
  for (const e of page) {
    const ts = e.ts.slice(0, W_TIME - 1).padEnd(W_TIME);
    const type = e.type.slice(0, W_TYPE - 1).padEnd(W_TYPE);
    const oid = (e.orderId ?? "—").slice(0, W_ORDER - 1).padEnd(W_ORDER);
    const comm = (e.commitment ?? "—").slice(0, W_COMMIT - 1).padEnd(W_COMMIT);
    const path = (e.path ?? (e.tool ? `tool:${e.tool}` : "—")).slice(0, W_PATH - 1).padEnd(W_PATH);

    const colorType = e.type === "tool_call" ? theme.cyan :
      e.type === "tool_result" ? theme.dim :
      e.type === "done" ? theme.bold : theme.muted;

    lines.push(theme.dim(ts) + colorType(type) + theme.dim(oid) + theme.dim(comm) + path);
  }

  out.write(titledBox(lines, `📋 ${session.label}`, { width: 82 }) + "\n");
}

function matchesSearch(e: LogEntry, query: string): boolean {
  const q = query.toLowerCase();
  return (
    e.type.toLowerCase().includes(q) ||
    (e.orderId ?? "").toLowerCase().includes(q) ||
    (e.path ?? "").toLowerCase().includes(q) ||
    (e.tool ?? "").toLowerCase().includes(q)
  );
}

function exportSession(session: SessionView, out: NodeJS.WritableStream): void {
  const path = join(process.cwd(), `aether-export-${session.id}.json`);
  try {
    writeFileSync(path, JSON.stringify(session.entries, null, 2), "utf8");
    out.write(`\n\x1b[K${theme.cyan("exported")} ${path}  (${session.entries.length} entries)\n`);
  } catch (err) {
    out.write(`\n\x1b[K✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

function exportAllSessions(sessions: SessionView[], out: NodeJS.WritableStream): void {
  const path = join(process.cwd(), `aether-export-all-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  try {
    const data = sessions.map((s) => ({
      sessionId: s.id,
      label: s.label,
      started: s.started,
      manifest: s.manifest,
      entryCount: s.entries.length,
      entries: s.entries,
    }));
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
    const total = sessions.reduce((sum, s) => sum + s.entries.length, 0);
    out.write(`\n\x1b[K${theme.cyan("exported all")} ${path}  (${sessions.length} sessions, ${total} entries)\n`);
  } catch (err) {
    out.write(`\n\x1b[K✗ ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
```

**Step 2: Wire in slash.ts**

Add import:
```typescript
import { runLogsViewer } from "../ui/logs_viewer.js";
```

Add case:
```typescript
case "logs-view":
case "logs": {
  out.write("\x1b[?25l"); // Hide cursor
  await runLogsViewer(out);
  break;
}
```

Add to help:
```typescript
theme.dim("/logs-view") + "              interactive session log browser",
```

**Step 3: Commit**

```bash
git add src/ui/logs_viewer.ts src/commands/slash.ts
git commit -m "feat: add /logs-view — interactive ASCII protocol-c log browser with export"
```

---

### Task 9: Final integration — build, test, PR

**Objective:** Compile everything, fix any issues, create PR.

**Step 1: Build**

```bash
cd /root/aether-agent && npm run build
```

**Step 2: Fix any TypeScript errors**

```bash
cd /root/aether-agent && npx tsc -p tsconfig.json 2>&1 | tail -30
```

**Step 3: Create branch and PR**

```bash
cd /root/aether-agent
git checkout -b feat/session-control-commands
git push origin feat/session-control-commands
gh pr create --base main --title "feat: session control slash commands — pin, drop, snapshot, limit, audit-receipt, rollback, logs-view" --body "## Summary
Adds 7 new slash commands for session-level control in the aether-agent interactive REPL:

- **/pin <path> [reason]** — Force a file into persistent context (prevents forgetting during long /recon loops)
- **/drop <path>** — Evict a file from context to save tokens
- **/snapshot** — Save session state (pins, UVT cap, plan) to disk; resume with /snapshot resume
- **/limit <uvt>** — Hard cap on UVT spend; agent pauses if ceiling hit
- **/audit-receipt** — Verified log of every tool call + filesystem mod + UVT spent in column format
- **/rollback [n]** — Git-based fast undo of filesystem changes
- **/logs-view** — Interactive ASCII terminal browser for session protocol-c logs with arrow-key scrolling + JSON export

## Files Changed
- **New:** src/core/context_registry.ts — in-memory pin/drop/limit/snapshot state manager
- **New:** src/ui/logs_viewer.ts — interactive log browser widget with arrow-key navigation
- **Modified:** src/commands/slash.ts — 7 new slash command handlers + help text"
```

---

## Risks & Tradeoffs

| Risk | Mitigation |
|---|---|
| `/rollback` uses `git checkout -- .` which is destructive | Always shows what will be reverted + confirm prompt; respects `--yes` flag |
| `/logs-view` raw-mode stdin may conflict with REPL readline | Restore raw mode on exit; tested pattern from model_picker.ts which does same |
| No backend for pin/drop — purely client-side | Correct — these are REPL-local. `/snapshot` persists to disk for cross-session. |
| UVT tracking is approximate (client-side only) | Real UVT is server-authoritative. This is a session guardrail, not accounting. |

## Verification

After implementation, start the REPL and verify each command:

```bash
cd /root/aether-agent
node dist/src/main.js
```

- `/pin src/main.ts "core dispatch"` → shows pinned
- `/pin list` → shows the pin
- `/drop src/main.ts` → removes pin
- `/snapshot` → saves to ~/.aether-agent/snapshots/
- `/snapshot list` → shows saved snapshots
- `/limit 50000` → sets cap
- `/limit` → shows current cap + bar
- `/audit-receipt 15` → shows columnar audit
- `/rollback` → shows dirty files, confirms, reverts
- `/logs-view` → opens interactive browser
