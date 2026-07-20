// src/core/hud.ts — HUD (Heads-Up Display) system for the aether-agent REPL.
//
// /add <element>  — add a persistent HUD overlay element
// /hud remove|list|clear — manage the HUD
//
// Pure client-side: no backend API needed. State lives in ContextRegistry so
// HUD configuration survives /snapshot save/load.
//
// Elements render as a compact combined status bar above the REPL prompt,
// collapsing to fit the terminal width when multiple are active.

import { humanTokens } from "../ui/statusbar.js";
import { formatElapsed } from "../ui/elapsed.js";
import { sliceVisible } from "../ui/text.js";
import { theme } from "../ui/theme.js";

// ── Element types ──────────────────────────────────────────────

export type HudElementId =
  | "context-bar"
  | "timer"
  | "tools"
  | "help"
  | "agent-health"
  | "status-line";

export interface HudElementDef {
  id: HudElementId;
  aliases: string[];
  label: string;
  /** Lower = leftmost in combined bar. */
  priority: number;
  /** Minimum width in characters before collapsing. */
  minWidth: number;
  /** Whether this element can shrink below minWidth when space is tight. */
  collapsible: boolean;
  /** For /add list: human description of what it shows. */
  description: string;
}

/** Master registry of all available HUD elements. */
export const HUD_ELEMENTS: Record<HudElementId, HudElementDef> = {
  "context-bar": {
    id: "context-bar",
    aliases: ["context", "bar", "ctx", "pool"],
    label: "Context Bar",
    priority: 1,
    minWidth: 25,
    collapsible: true,
    description: "Token pool fill bar: used/capacity, fill %, session elapsed",
  },
  timer: {
    id: "timer",
    aliases: ["clock", "chess", "stopwatch", "time"],
    label: "Timer",
    priority: 2,
    minWidth: 20,
    collapsible: true,
    description: "Chess-clock dual timer: user think time + agent work time",
  },
  "agent-health": {
    id: "agent-health",
    aliases: ["health", "hp", "vitals", "life"],
    label: "Agent Health",
    priority: 3,
    minWidth: 18,
    collapsible: true,
    description: "Health bar: pool pressure + session age (fresh → exhausted)",
  },
  tools: {
    id: "tools",
    aliases: ["menu", "toolbox", "toolbar"],
    label: "Tools",
    priority: 4,
    minWidth: 20,
    collapsible: true,
    description: "Compact quick-ref column of available slash commands",
  },
  help: {
    id: "help",
    aliases: ["commands", "cmds", "cheatsheet"],
    label: "Help",
    priority: 5,
    minWidth: 20,
    collapsible: true,
    description: "Command shortcuts quick-reference column",
  },
  "status-line": {
    id: "status-line",
    aliases: ["status", "heartbeat", "live", "pulse"],
    label: "Status Line",
    priority: 6,
    minWidth: 30,
    collapsible: true,
    description: "Live heartbeat: verb, kaomoji, elapsed, tokens, UVT bar",
  },
};

// ── Element resolution ────────────────────────────────────────

/** Resolve user input to a HudElementId. Matches: exact id, aliases, and
 *  fuzzy (substring match on id + all aliases). Returns null for no match. */
export function resolveHudElement(input: string): HudElementId | null {
  const raw = input.toLowerCase().trim();
  if (!raw) return null;

  // Exact id match
  if (HUD_ELEMENTS[raw as HudElementId]) return raw as HudElementId;

  // Alias match
  for (const [id, def] of Object.entries(HUD_ELEMENTS)) {
    if (def.aliases.includes(raw)) return id as HudElementId;
  }

  // Fuzzy: substring match (shortest match wins)
  let best: HudElementId | null = null;
  let bestLen = Infinity;
  for (const [id, def] of Object.entries(HUD_ELEMENTS)) {
    const targets = [id, ...def.aliases];
    for (const t of targets) {
      if (t.includes(raw) && t.length < bestLen) {
        best = id as HudElementId;
        bestLen = t.length;
      }
    }
  }
  return best;
}

// ── Timer ──────────────────────────────────────────────────────

export interface HudTimer {
  /** Cumulative user think time (ms). */
  userMs: number;
  /** Cumulative agent work time (ms). */
  agentMs: number;
  /** Timestamp when current clock phase started (Date.now). */
  phaseStart: number;
  /** Whose clock is currently running. */
  clock: "user" | "agent" | "stopped";
}

export function createTimer(): HudTimer {
  return { userMs: 0, agentMs: 0, phaseStart: Date.now(), clock: "user" };
}

/** Compute the live elapsed time including the running clock. */
export function timerLive(t: HudTimer): { userMs: number; agentMs: number } {
  const now = Date.now();
  let u = t.userMs;
  let a = t.agentMs;
  if (t.clock === "user") u += now - t.phaseStart;
  else if (t.clock === "agent") a += now - t.phaseStart;
  return { userMs: u, agentMs: a };
}

/** Switch the running clock (freezes current, starts new phase). */
export function timerSwitch(t: HudTimer, to: "user" | "agent" | "stopped"): void {
  const now = Date.now();
  if (t.clock === "user") t.userMs += now - t.phaseStart;
  else if (t.clock === "agent") t.agentMs += now - t.phaseStart;
  t.clock = to;
  t.phaseStart = now;
}

// ── Render state ───────────────────────────────────────────────

export interface HudRenderState {
  tokensUsed: number;
  tokensCap: number;
  sessionMs: number;
  timer: HudTimer;
  streamedTokens: number;
  uvtUsed: number;
  uvtCap: number;
}

function fmtTokens(n: number): string {
  return humanTokens(n);
}

function fmtMs(ms: number): string {
  return formatElapsed(ms);
}

const DIM = theme.dim;
const ICE = theme.iceBlue;

// ── Per-element renderers ──────────────────────────────────────

function renderContextBar(s: HudRenderState, width: number): string {
  const cap = s.tokensCap > 0 ? s.tokensCap : 1;
  const frac = Math.min(1, s.tokensUsed / cap);
  const barW = Math.max(3, width - 22);
  const filled = Math.round(frac * barW);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(Math.max(0, barW - filled));
  const pct = (frac * 100).toFixed(1) + "%";
  const color = frac < 0.3 ? theme.iceBlue : frac < 0.7 ? "\x1b[33m" : "\x1b[31m";
  const rst = theme.enabled ? "\x1b[0m" : "";
  return DIM("\uD83E\uDDE0") + " " +
    fmtTokens(s.tokensUsed) + "/" + fmtTokens(cap) +
    " " + color + bar + rst +
    " " + pct +
    DIM(" \u00B7 " + fmtMs(s.sessionMs));
}

function renderTimer(s: HudRenderState, _width: number): string {
  const live = timerLive(s.timer);
  return DIM("\u23F1") + " " +
    ICE("\u263A") + fmtMs(live.userMs) + "  " +
    DIM("\uD83E\uDD16") + fmtMs(live.agentMs);
}

function renderAgentHealth(s: HudRenderState, _width: number): string {
  const cap = s.tokensCap > 0 ? s.tokensCap : 1;
  const frac = Math.min(1, s.tokensUsed / cap);
  const ageMin = s.sessionMs / 60000;
  let heart: string;
  let word: string;
  if (frac > 0.95) { heart = "\uD83D\uDC80"; word = "critical"; }
  else if (frac > 0.85 || ageMin > 60) { heart = "\u2764\uFE0F"; word = "exhausted"; }
  else if (frac > 0.70 || ageMin > 30) { heart = "\uD83E\uDDE1"; word = "strained"; }
  else if (frac > 0.30 || ageMin > 5) { heart = "\uD83D\uDC9B"; word = "active"; }
  else { heart = "\uD83D\uDC9A"; word = "fresh"; }
  return heart + " " + ICE(word) + DIM(" \u00B7 " + fmtMs(s.sessionMs));
}

function renderTools(_s: HudRenderState, width: number): string {
  const cmds = [
    "/help", "/models", "/agent", "/vault",
    "/goal", "/delegate", "/photogen", "/clear",
  ];
  const maxShow = Math.max(2, Math.floor((width - 4) / 8));
  const shown = cmds.slice(0, maxShow);
  return DIM("\uD83D\uDEE0") + " " + shown.map((c) => DIM(c)).join("  ");
}

function renderHelp(_s: HudRenderState, width: number): string {
  const cmds = [
    "/help", "/models", "/agent", "/add",
    "/hud", "/clear", "/exit", "/snapshot",
  ];
  const maxShow = Math.max(2, Math.floor((width - 4) / 8));
  const shown = cmds.slice(0, maxShow);
  return DIM("?") + " " + shown.map((c) => DIM(c)).join("  ");
}

function renderStatusLine(s: HudRenderState, width: number): string {
  const elapsed = fmtMs(s.sessionMs);
  const up = s.streamedTokens > 0 ? DIM(" \u00B7 \u2191 ") + fmtTokens(s.streamedTokens) : "";
  if (width < 35) return DIM("\u00B7") + " " + elapsed + up;
  return DIM("\u00B7") + " " + ICE("working") + DIM(" (" + elapsed + up + ")");
}

const RENDERERS: Record<HudElementId, (s: HudRenderState, w: number) => string> = {
  "context-bar": renderContextBar,
  timer: renderTimer,
  tools: renderTools,
  help: renderHelp,
  "agent-health": renderAgentHealth,
  "status-line": renderStatusLine,
};

// ── Combined render ────────────────────────────────────────────

/** Render the full HUD bar for active elements. Returns the ANSI string or
 *  null when no elements are active. Total width should be process.stdout.columns. */
export function renderHud(
  active: HudElementId[],
  state: HudRenderState,
  totalWidth: number,
): string | null {
  if (active.length === 0) return null;

  // Sort by priority
  const sorted = [...active].sort(
    (a, b) => HUD_ELEMENTS[a].priority - HUD_ELEMENTS[b].priority,
  );

  // Allocate width: each element gets at least its minWidth, proportional above that
  const totalMin = sorted.reduce((sum, id) => sum + HUD_ELEMENTS[id].minWidth, 0);
  const separators = (sorted.length - 1) * 3; // " │ " between elements
  const available = Math.max(0, totalWidth - 4 - separators); // 4 = border + padding

  const segments: string[] = [];
  for (const id of sorted) {
    const def = HUD_ELEMENTS[id];
    const alloc =
      totalMin <= available
        ? def.minWidth + Math.floor((available - totalMin) / sorted.length)
        : Math.max(def.minWidth, Math.floor((available * def.minWidth) / totalMin));
    segments.push(RENDERERS[id](state, alloc));
  }

  const line = DIM("\u2500\u2500\u2524") + " HUD " + DIM("\u251C\u2500\u2500") + " " +
    segments.join("  " + DIM("\u2502") + "  ");
  return sliceVisible(line, totalWidth);
}

// ── Quick-ref list of top slash commands (for /add tools/help fallback) ──

export const TOP_SLASH_COMMANDS = [
  "/help", "/models", "/model", "/agent", "/agents",
  "/vault", "/vault-search", "/goal", "/goals",
  "/workflow", "/delegate", "/tree", "/broadcast", "/gather",
  "/photogen", "/frame", "/videogen", "/sequence",
  "/pin", "/drop", "/snapshot", "/limit",
  "/scaffold", "/port", "/test-drive", "/bench",
  "/clear", "/exit",
];
