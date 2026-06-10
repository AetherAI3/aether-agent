# Interactive Model Picker — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the flat numbered `/models` list with a clean interactive arrow-key dropdown menu that groups models by provider, puts orchestrators at the top, and uses a green orb to indicate selection.

**Architecture:** A new `src/ui/model_picker.ts` component handles the interactive TUI — it temporarily takes over stdin from the REPL, renders the grouped menu, processes arrow keys, and returns the selection. The existing `slash.ts` select/confirm/restart machinery stays intact. Direct `/model opus` already works via `resolveSelection` and is unchanged.

**Tech Stack:** TypeScript, Node.js raw-mode stdin, ANSI escape sequences (box drawing, 256-color), zero new dependencies.

---

## Current State

- `/models` prints a flat numbered list: ` 1. opus  model  claude-opus-4`
- `/model opus` already works — calls `resolveSelection()`, shows warning, confirms, returns restart
- The REPL in `chat.ts` handles arrow keys (`decodeKey` maps `\x1b[A` → up, `\x1b[B` → down)
- Theme singleton in `ui/theme.ts` gates ANSI colors on TTY + NO_COLOR
- `ui/box.ts` has brand colors (orange, green, darkBlue, brightWhite, lightBlue) and box drawing
- `CatalogItem.provider` is `string | null` — we group by this field

## Target UX

```
┌──────────── Select Model ────────────┐
│                                      │
│  ⚡ Orchestrators                    │
│      Neo      orchestrator-agent     │
│    ● Kronus   orchestrator-agent     │  ← green orb on selected
│                                      │
│  🧡 Claude                           │
│      Opus     claude-opus-4          │
│      Sonnet   claude-sonnet-4        │
│      Haiku    claude-haiku-3.5       │
│                                      │
│  💚 GPT                              │
│      GPT-4.1  gpt-4.1               │
│      GPT-4o   gpt-4o                │
│                                      │
│  💙 DeepSeek                         │
│      V4       deepseek-v4            │
│                                      │
│  ↑↓ navigate  ↵ select  Esc cancel  │
└──────────────────────────────────────┘
```

---

## Task 1: Create model_picker.ts — grouping + provider mapping

**Objective:** Core module with provider grouping logic and color mapping. Pure functions, no I/O.

**Files:**
- Create: `src/ui/model_picker.ts`

**Step 1: Write the file**

```typescript
// src/ui/model_picker.ts — interactive model/orchestrator picker.
// Renders a boxed, provider-grouped menu with arrow-key navigation.
// Takes over stdin temporarily during selection, then restores the REPL listener.

import type { CatalogItem, CatalogResponse } from "../types.js";
import type { Writable } from "node:stream";
import { theme } from "./theme.js";
import {
  orange, green, darkBlue, brightWhite, lightBlue,
  box, hyperlink, stripAnsi,
} from "./box.js";
import { decodeKey } from "../commands/chat.js";

// ── Provider grouping ──────────────────────────

export interface ModelGroup {
  /** Display label for the group header. */
  label: string;
  /** ANSI color function for the group header + item prefix. */
  color: (s: string) => string;
  /** Icon character for the group header. */
  icon: string;
  /** Items in this group. */
  items: CatalogItem[];
}

/** Map provider strings to display groups. Orchestrators always come first. */
export function groupItems(items: CatalogItem[]): ModelGroup[] {
  const orchItems = items.filter((m) => m.kind === "orchestrator");
  const modelItems = items.filter((m) => m.kind !== "orchestrator");

  const providerMap: Record<string, CatalogItem[]> = {};
  for (const m of modelItems) {
    const p = m.provider ?? "other";
    (providerMap[p] ??= []).push(m);
  }

  const groups: ModelGroup[] = [];

  if (orchItems.length) {
    groups.push({
      label: "Orchestrators",
      color: theme.cyan,
      icon: "\u26a1", // ⚡
      items: orchItems,
    });
  }

  const PROVIDER_CONFIG: Record<string, { label: string; color: (s: string) => string; icon: string }> = {
    anthropic: { label: "Claude",   color: orange,      icon: "\ud83e\udde1" }, // 🧡
    openai:    { label: "GPT",      color: green,       icon: "\ud83d\udc9a" }, // 💚
    deepseek:  { label: "DeepSeek", color: darkBlue,    icon: "\ud83d\udc99" }, // 💙
    moonshot:  { label: "Kimi",     color: brightWhite, icon: "\u2b1c"      }, // ⬜
    google:    { label: "Gemma",    color: lightBlue,   icon: "\ud83e\ude75" }, // 🩵
  };

  const sortedProviders = Object.keys(providerMap).sort((a, b) => {
    const aOrder = Object.keys(PROVIDER_CONFIG).indexOf(a);
    const bOrder = Object.keys(PROVIDER_CONFIG).indexOf(b);
    if (aOrder === -1 && bOrder === -1) return a.localeCompare(b);
    if (aOrder === -1) return 1;
    if (bOrder === -1) return -1;
    return aOrder - bOrder;
  });

  for (const p of sortedProviders) {
    const cfg = PROVIDER_CONFIG[p];
    groups.push({
      label: cfg?.label ?? p,
      color: cfg?.color ?? theme.dim,
      icon: cfg?.icon ?? "  ",
      items: providerMap[p]!,
    });
  }

  return groups;
}

/** Flatten groups into a single array for index-based navigation. */
export function flattenGroups(groups: ModelGroup[]): { item: CatalogItem; groupIdx: number }[] {
  const flat: { item: CatalogItem; groupIdx: number }[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    for (const item of groups[gi]!.items) {
      flat.push({ item, groupIdx: gi });
    }
  }
  return flat;
}

/** Find the index of the currently-active model in the flat list (-1 if not found). */
export function currentIndex(flat: { item: CatalogItem }[], active: string | undefined): number {
  return active ? flat.findIndex((f) => f.item.id === active) : -1;
}

// ── Rendering ─────────────────────────────────

const GREEN_ORB = "\x1b[38;5;46m\u25cf\x1b[0m"; // ● green
const DIM_ORB   = theme.dim("\u25cb");              // ○ dim

const BOX_WIDTH = 64;

export function renderPicker(
  groups: ModelGroup[],
  flat: { item: CatalogItem; groupIdx: number }[],
  selectedIdx: number,
): string {
  const lines: string[] = [];
  const innerWidth = BOX_WIDTH - 6; // account for │  ...  │

  let flatIdx = 0;
  for (const group of groups) {
    // Group header with icon
    const header = `${group.icon}  ${group.color(group.label)}`;
    lines.push(header);
    
    for (const item of group.items) {
      const orb = flatIdx === selectedIdx ? GREEN_ORB : DIM_ORB;
      const name = flatIdx === selectedIdx ? theme.bold(item.label) : item.label;
      const id = theme.dim(item.id);
      const locked = !item.available ? theme.dim(" \uD83D\uDD12") : ""; // 🔒
      
      // Build line: "  ●  Opus      claude-opus-4"
      const left = `  ${orb}  ${name}`;
      const right = `${id}${locked}`;
      
      // Pad between name and id
      const leftLen = stripAnsi(left).length;
      const rightLen = stripAnsi(right).length;
      const pad = Math.max(1, innerWidth - leftLen - rightLen);
      
      lines.push(left + " ".repeat(pad) + right);
      flatIdx++;
    }

    // Blank separator between groups (not after the last)
    if (group !== groups[groups.length - 1]) {
      lines.push("");
    }
  }

  // Footer
  lines.push("");
  lines.push(theme.dim("\u2191\u2193 navigate  \u21B5 select  Esc cancel"));

  return box(lines, { width: BOX_WIDTH });
}

// ── Interactive picker ────────────────────────

/**
 * Launch an interactive model/orchestrator picker.
 *
 * Temporarily removes the REPL's data listener, renders the menu,
 * processes arrow keys, and returns the selected item or null (cancelled).
 * Restores the REPL listener before resolving.
 *
 * @param ctx   AppContext (unused currently — catalog passed directly)
 * @param items Already-fetched catalog items for the target kind
 * @param kind  "model" or "orchestrator" (affects the title)
 * @param out   Output stream (process.stdout)
 */
export async function pickModel(
  items: CatalogItem[],
  kind: "model" | "orchestrator",
  out: Writable,
): Promise<CatalogItem | null> {
  if (items.length === 0) {
    out.write(`no ${kind}s available.\n`);
    return null;
  }

  const groups = groupItems(items);
  const flat = flattenGroups(groups);
  if (flat.length === 0) {
    out.write(`no ${kind}s available.\n`);
    return null;
  }

  // Save and remove existing stdin listeners (the REPL's onData)
  const oldListeners = process.stdin.rawListeners("data");
  process.stdin.removeAllListeners("data");

  let selectedIdx = 0;
  const total = flat.length;

  // Initial render
  out.write("\x1b[2J\x1b[H"); // clear screen
  out.write(renderPicker(groups, flat, selectedIdx) + "\n");

  return new Promise((resolve) => {
    const onKey = (chunk: Buffer): void => {
      const k = decodeKey(chunk.toString("utf8"));

      switch (k.kind) {
        case "up":
          selectedIdx = (selectedIdx - 1 + total) % total;
          rerender();
          break;
        case "down":
          selectedIdx = (selectedIdx + 1) % total;
          rerender();
          break;
        case "submit": {
          const picked = flat[selectedIdx]!;
          cleanup();
          // Clear screen so the warning/confirm renders cleanly below
          out.write("\x1b[2J\x1b[H");
          resolve(picked.item);
          return;
        }
        case "interrupt":
        case "eof":
          cleanup();
          out.write("\x1b[2J\x1b[H");
          resolve(null);
          return;
        case "char": {
          // 'q' or Escape (sent as char on some terminals) to cancel
          if (k.value === "q" || k.value === "\x1b") {
            cleanup();
            out.write("\x1b[2J\x1b[H");
            resolve(null);
            return;
          }
          break;
        }
        default:
          break; // ignore other keys
      }
    };

    const rerender = (): void => {
      // Move cursor to top-left and redraw
      out.write("\x1b[H");
      out.write(renderPicker(groups, flat, selectedIdx));
    };

    const cleanup = (): void => {
      process.stdin.removeListener("data", onKey);
      // Re-attach the REPL's original listeners
      for (const l of oldListeners) {
        process.stdin.on("data", l as (...args: any[]) => void);
      }
    };

    process.stdin.on("data", onKey);
  });
}
```

**Step 2: Test grouping logic** (in a separate test file — see Task 4)

**Verification:** Node compile test — but full build happens in Task 5

---

## Task 2: Wire picker into slash.ts

**Objective:** When `/model` or `/models` or `/agent` or `/agents` is called without an arg, launch the interactive picker. Keep direct-selection (`/model opus`) working as-is.

**Files:**
- Modify: `src/commands/slash.ts`

**Step 1: Add import**

```typescript
import { pickModel, groupItems } from "../ui/model_picker.js";
```

**Step 2: Modify `handleSlash` switch cases**

Change the `case "models":` and `case "model":` cases:

```typescript
    case "models":
      await showPicker(ctx, out, "model");
      break;
    case "model": {
      if (!arg) {
        // No arg → launch interactive picker
        const r = await showPicker(ctx, out, "model");
        if (r) return { exit: false, restart: r };
        break;
      }
      // Has arg → direct selection (existing behavior)
      const r = await select(ctx, out, arg, "model");
      if (r) return { exit: false, restart: r };
      break;
    }
    case "agents":
      await showPicker(ctx, out, "orchestrator");
      break;
    case "agent": {
      if (!arg) {
        const r = await showPicker(ctx, out, "orchestrator");
        if (r) return { exit: false, restart: r };
        break;
      }
      const r = await select(ctx, out, arg, "orchestrator");
      if (r) return { exit: false, restart: r };
      break;
    }
```

**Step 3: Add `showPicker` function**

Replace the existing `showList` function (or add alongside it):

```typescript
/** Launch interactive picker, then show the standard warning + confirm. */
async function showPicker(
  ctx: AppContext,
  out: Writable,
  kind: Kind,
): Promise<{ model?: string; agent?: string } | null> {
  const cat = await getCatalog(ctx);
  const items = byKind(cat, kind);
  
  const picked = await pickModel(items, kind, out);
  if (!picked) {
    out.write("kept current session.\n");
    return null;
  }
  
  if (!picked.available) {
    out.write(`${picked.id} is locked on tier ${cat.tier}\n`);
    return null;
  }
  
  // Show warning + confirm (same as existing select() logic)
  out.write(
    theme.dim(
      `\u26A0 Switching ${kind === "model" ? "model" : "orchestrator"} to ${picked.label} will ` +
        `restart the session and clear context.\n`,
    ),
  );
  const ok = ctx.flags.yes || (await ctx.confirm("Continue? [y/N] "));
  if (!ok) {
    out.write("kept current session.\n");
    return null;
  }
  return kind === "model" ? { model: picked.id } : { agent: picked.id };
}
```

**Step 4: Remove `showList` (optional — keep if used elsewhere)**

`showList` is only called from the `"models"` and `"agents"` cases, which are now both replaced. Remove it to keep the file clean.

---

## Task 3: Update REPL chat.ts for escape-key support

**Objective:** The picker handles `Esc` as a cancel key. Ensure the `decodeKey` function can decode `\x1b` (bare escape) correctly. Currently `\x1b` alone isn't handled — it only handles escape sequences like `\x1b[A`. Add bare escape handling.

**Files:**
- Modify: `src/commands/chat.ts`

**Step 1: Add escape key decoding**

In `decodeKey`, add between the EOF and paste-start cases:

```typescript
    case "\x1b":
      return { kind: "escape" };
```

**Step 2: Add `escape` to the Key type**

```typescript
  | { kind: "escape" }
```

**Step 3: Handle escape in the REPL's `onData`**

In the `switch (k.kind)` inside `onData`, add:

```typescript
        case "escape":
          return; // ignore — picker handles its own escape
```

**Step 4: Add escape handling to the picker's decodeKey usage**

Actually, the picker uses `decodeKey` directly. Since `\x1b` is now decoded as `{ kind: "escape" }`, add that case to the picker:

```typescript
        case "escape":
          cleanup();
          out.write("\x1b[2J\x1b[H");
          resolve(null);
          return;
```

And remove the char-based escape check (no longer needed):

```typescript
        case "char": {
          if (k.value === "q") {
            cleanup();
            out.write("\x1b[2J\x1b[H");
            resolve(null);
            return;
          }
          break;
        }
```

**Step 5: Verify existing tests still pass**

The existing `chat_keys.test.ts` tests all existing key sequences. The escape change adds a new case but doesn't break existing ones.

---

## Task 4: Write tests

**Objective:** Test provider grouping logic and index-based navigation.

**Files:**
- Create: `test/model_picker.test.ts`

**Step 1: Write test file**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupItems, flattenGroups, currentIndex } from "../src/ui/model_picker.js";
import type { CatalogItem } from "../src/types.js";

function item(overrides: Partial<CatalogItem> & { id: string }): CatalogItem {
  return {
    label: overrides.id,
    kind: "model",
    provider: "anthropic",
    context_window: null,
    tier_min: "free",
    enabled: true,
    available: true,
    monthly_uvt_cap: null,
    is_default: false,
    ...overrides,
  };
}

test("groupItems puts orchestrators first", () => {
  const items = [
    item({ id: "opus", kind: "model", provider: "anthropic" }),
    item({ id: "neo", kind: "orchestrator", provider: null }),
    item({ id: "gpt4", kind: "model", provider: "openai" }),
  ];
  const groups = groupItems(items);
  assert.equal(groups[0]!.label, "Orchestrators");
  assert.equal(groups[0]!.items.length, 1);
  assert.equal(groups[0]!.items[0]!.id, "neo");
});

test("groupItems groups by provider", () => {
  const items = [
    item({ id: "opus", provider: "anthropic" }),
    item({ id: "sonnet", provider: "anthropic" }),
    item({ id: "gpt4", provider: "openai" }),
    item({ id: "deepseek-v4", provider: "deepseek" }),
  ];
  const groups = groupItems(items);
  
  const claude = groups.find((g) => g.label === "Claude")!;
  assert.ok(claude, "Claude group exists");
  assert.equal(claude.items.length, 2);
  
  const gpt = groups.find((g) => g.label === "GPT")!;
  assert.ok(gpt, "GPT group exists");
  assert.equal(gpt.items.length, 1);
});

test("groupItems handles unknown provider in 'Other' group", () => {
  const items = [
    item({ id: "unknown-model", provider: "some-new-provider" }),
  ];
  const groups = groupItems(items);
  // Unknown providers map to their raw provider string as the label
  const other = groups.find((g) => g.label === "some-new-provider");
  assert.ok(other);
  assert.equal(other!.items.length, 1);
});

test("flattenGroups creates flat indexed list", () => {
  const groups = [
    { label: "A", color: (s: string) => s, icon: "", items: [item({ id: "a1" }), item({ id: "a2" })] },
    { label: "B", color: (s: string) => s, icon: "", items: [item({ id: "b1" })] },
  ];
  const flat = flattenGroups(groups);
  assert.equal(flat.length, 3);
  assert.equal(flat[0]!.item.id, "a1");
  assert.equal(flat[0]!.groupIdx, 0);
  assert.equal(flat[2]!.item.id, "b1");
  assert.equal(flat[2]!.groupIdx, 1);
});

test("currentIndex finds active model by id", () => {
  const flat = [
    { item: item({ id: "haiku" }), groupIdx: 0 },
    { item: item({ id: "sonnet" }), groupIdx: 0 },
    { item: item({ id: "opus" }), groupIdx: 0 },
  ];
  assert.equal(currentIndex(flat, "sonnet"), 1);
  assert.equal(currentIndex(flat, "nope"), -1);
  assert.equal(currentIndex(flat, undefined), -1);
});

test("flattenGroups preserves group indices across groups", () => {
  const groups = [
    { label: "Orch", color: (s: string) => s, icon: "", items: [
      item({ id: "neo", kind: "orchestrator", provider: null }),
    ]},
    { label: "Claude", color: (s: string) => s, icon: "", items: [
      item({ id: "haiku", kind: "model", provider: "anthropic" }),
      item({ id: "opus", kind: "model", provider: "anthropic" }),
    ]},
  ];
  const flat = flattenGroups(groups);
  assert.equal(flat[0]!.groupIdx, 0);
  assert.equal(flat[1]!.groupIdx, 1);
  assert.equal(flat[2]!.groupIdx, 1);
});
```

---

## Task 5: Build, test, verify

**Objective:** Compile the TypeScript, run tests, verify everything works end-to-end.

**Step 1: Build**

```bash
cd /root/aether-agent && npx tsc -p tsconfig.json
```

Expected: clean compile (pre-existing LSP errors about `@types/node` are normal).

**Step 2: Run tests**

```bash
cd /root/aether-agent && npm test
```

Expected: all existing tests pass + new model_picker tests pass.

**Step 3: Run specific new tests**

```bash
cd /root/aether-agent && node --test "dist/test/model_picker.test.js"
```

**Step 4: Verify the existing /model behavior (direct selection)**

```bash
cd /root/aether-agent && node --test "dist/test/slash.test.js"
```

Expected: all slash tests pass — direct selection unchanged.

**Step 5: Verify chat key tests**

```bash
cd /root/aether-agent && node --test "dist/test/chat_keys.test.js"
```

Expected: all tests pass, escape key now decodes correctly.

---

## Files Manifest

| File | Action | Purpose |
|---|---|---|
| `src/ui/model_picker.ts` | CREATE | Interactive picker: grouping, rendering, stdin takeover |
| `test/model_picker.test.ts` | CREATE | Grouping logic + index navigation tests |
| `src/commands/slash.ts` | MODIFY | Wire `/models`, `/model`, `/agents`, `/agent` to picker |
| `src/commands/chat.ts` | MODIFY | Add `escape` key type to `Key` + `decodeKey` |

---

## Risks & Mitigations

1. **Stdin listener race:** The picker removes REPL listeners, runs its own, then restores. If an error occurs during picker, cleanup must always re-attach. The `Promise` + `cleanup()` pattern ensures this even on exceptions.

2. **Terminal size:** If terminal is narrower than 64 columns, the box will wrap. The `box()` function expects the caller to keep lines short. Mitigation: items have short labels; worst case the box renders at fixed 64 width and wraps gracefully.

3. **Non-TTY:** When not in a TTY (CI, pipes), `pickModel` should degrade gracefully. Since `/models` is only called in interactive REPL, and the REPL already checks `process.stdin.isTTY`, this is low risk. However, `pickModel` checks `items.length` early and returns null for empty lists.

4. **Escape key timing:** Some terminals send `\x1b` then `[A` as separate bytes. The `decodeKey` function processes one raw chunk at a time — if `\x1b` arrives alone, it now decodes as `escape`. If `\x1b[A` arrives as one chunk, it decodes as `up`. This is correct behavior — the terminal's buffering determines which case triggers. On fast keypress releases, bare `\x1b` is common.

5. **Provider grouping misses future providers:** New providers (e.g., xAI, Mistral) will fall into a raw-provider-name group until added to `PROVIDER_CONFIG`. This is acceptable — they still appear, just without a branded icon.
