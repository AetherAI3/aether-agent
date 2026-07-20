// src/ui/model_picker.ts — interactive model/orchestrator picker.
// Renders a boxed, provider-grouped menu with arrow-key navigation.
// Takes over stdin temporarily during selection, then restores the REPL listener.

import type { CatalogItem } from "../types.js";
import type { Writable } from "node:stream";
import { theme } from "./theme.js";
import {
  orange, green, darkBlue, brightWhite, lightBlue,
  box, stripAnsi,
} from "./box.js";
import { decodeKey, splitKeys, type Key } from "./keys.js";
import { registerRestore } from "./restore.js";

const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const CURSOR_SHOW = "\x1b[?25h";

// ── Provider grouping ──────────────────────────

export interface ModelGroup {
  /** Display label for the group header. */
  label: string;
  /** ANSI color function for the group header. */
  color: (s: string) => string;
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
      items: orchItems,
    });
  }

  const PROVIDER_CONFIG: Record<string, { label: string; color: (s: string) => string }> = {
    anthropic: { label: "Claude",   color: orange },
    openai:    { label: "GPT",      color: green },
    deepseek:  { label: "DeepSeek", color: darkBlue },
    moonshot:  { label: "Kimi",     color: brightWhite },
    google:    { label: "Gemma",    color: lightBlue },
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
export function currentIndex(
  flat: { item: CatalogItem }[],
  active: string | undefined,
): number {
  return active ? flat.findIndex((f) => f.item.id === active) : -1;
}

// ── Rendering ─────────────────────────────────

const BOX_WIDTH = 64;

/** Render the full picker menu as a single string. */
export function renderPicker(
  groups: ModelGroup[],
  _flat: { item: CatalogItem; groupIdx: number }[],
  selectedIdx: number,
): string {
  const innerWidth = BOX_WIDTH - 6; // account for │  ...  │
  const lines: string[] = [];

  // Title row
  lines.push(theme.bold("  Select Model"));

  // Separator
  lines.push(theme.dim("  " + "\u2500".repeat(innerWidth - 2)));

  let flatIdx = 0;
  for (const group of groups) {
    // Group header
    lines.push("  " + group.color(group.label));

    for (const item of group.items) {
      const orb = flatIdx === selectedIdx ? GREEN_ORB : DIM_ORB;
      const name = flatIdx === selectedIdx ? theme.bold(item.label) : item.label;
      const id = theme.dim(item.id);
      const locked = !item.available ? theme.dim(" \uD83D\uDD12") : "";

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
  lines.push(
    theme.dim("  \u2191\u2193 navigate  \u21B5 select  Esc cancel"),
  );

  return box(lines, { width: BOX_WIDTH });
}

const GREEN_ORB = theme.enabled ? "\x1b[38;5;46m\u25cf\x1b[0m" : "*"; // ● green
const DIM_ORB   = theme.dim("\u25cb");                                   // ○ dim

// ── Interactive picker ────────────────────────

/**
 * Launch an interactive model/orchestrator picker.
 *
 * Temporarily removes the REPL's data listener, renders the menu,
 * processes arrow keys, and returns the selected item or null (cancelled).
 * Restores the REPL listener before resolving.
 */
export async function pickModel(
  items: CatalogItem[],
  out: Writable,
): Promise<CatalogItem | null> {
  if (items.length === 0) {
    out.write("no models available.\n");
    return null;
  }

  // In non-TTY mode (pipe, CI), arrow-key navigation is impossible.
  // Degrade gracefully: return null so the caller can fall back to a flat list.
  if (!process.stdin.isTTY) {
    return null;
  }

  const groups = groupItems(items);
  const flat = flattenGroups(groups);
  if (flat.length === 0) {
    out.write("no models available.\n");
    return null;
  }

  // Save and remove existing stdin listeners (the REPL's onData)
  const oldListeners = process.stdin.rawListeners("data");
  process.stdin.removeAllListeners("data");

  let selectedIdx = 0;
  const total = flat.length;

  // Alt-screen, not 2J: the user's scrollback (the conversation they're
  // mid-way through) survives the picker and reappears on exit.
  out.write(ALT_ON + "\x1b[H");
  out.write(renderPicker(groups, flat, selectedIdx) + "\n");
  const unregister = registerRestore(() => {
    process.stdout.write(ALT_OFF + CURSOR_SHOW);
  });

  return new Promise((resolve) => {
    // Returns true when the picker is finished (resolved) and onKey must stop.
    const handleOne = (k: Key): boolean => {
      switch (k.kind) {
        case "up":
          selectedIdx = (selectedIdx - 1 + total) % total;
          rerender();
          return false;
        case "down":
          selectedIdx = (selectedIdx + 1) % total;
          rerender();
          return false;
        case "submit": {
          const picked = flat[selectedIdx]!;
          cleanup();
          resolve(picked.item);
          return true;
        }
        case "interrupt":
        case "eof":
        case "escape":
          cleanup();
          resolve(null);
          return true;
        default:
          return false; // ignore other keys
      }
    };

    const onKey = (chunk: Buffer): void => {
      try {
        // Tokenize: held-arrow key-repeat arrives as one batched chunk.
        for (const seq of splitKeys(chunk.toString("utf8"))) {
          if (handleOne(decodeKey(seq))) return;
        }
      } catch {
        // If anything throws in the key handler (render, decode), bail out
        // and restore the REPL listeners so the session isn't bricked.
        cleanup();
        resolve(null);
      }
    };

    const rerender = (): void => {
      // Home + redraw + erase-below: stale rows can't survive a shrinking menu.
      out.write("\x1b[H");
      out.write(renderPicker(groups, flat, selectedIdx));
      out.write("\n\x1b[0J");
    };

    const cleanup = (): void => {
      out.write(ALT_OFF + CURSOR_SHOW); // back to the real screen, scrollback intact
      unregister();
      process.stdin.removeListener("data", onKey);
      // Re-attach the REPL's original listeners
      for (const l of oldListeners) {
        process.stdin.on("data", l as (...args: unknown[]) => void);
      }
    };

    process.stdin.on("data", onKey);
  });
}
