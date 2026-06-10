// src/ui/logs_viewer.ts — interactive ASCII log browser.
//
// Reads ~/.aether-agent/logs/ and renders sessions in a boxed column layout.
// Arrow keys / j/k scroll, n/p switch sessions, `/` live-search (type, Enter
// apply, Esc cancel), 'e' exports the current session JSON, 'E' exports all,
// 'q' quits. Key handling = splitKeys + a pure reducer (viewerReduce), so the
// bindings are unit-testable without a TTY.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logsRoot } from "../core/session_log.js";
import { theme } from "./theme.js";
import { titledBox } from "./box.js";
import { decodeKey, splitKeys, type Key } from "./keys.js";

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

// ── pure key reducer ──────────────────────────────────────────────────────

export interface ViewerState {
  mode: "list" | "search";
  query: string;
  sessionIdx: number;
  scrollOffset: number;
}

export interface ViewerLimits {
  sessions: number;
  filtered: number;
  page: number;
}

export type ViewerAction = "none" | "render" | "quit" | "export" | "exportAll";

export interface ViewerStep {
  state: ViewerState;
  action: ViewerAction;
}

/** One key against the viewer state. Pure — no I/O, no mutation. */
export function viewerReduce(s: ViewerState, k: Key, max: ViewerLimits): ViewerStep {
  if (k.kind === "interrupt" || k.kind === "eof") return { state: s, action: "quit" };
  const maxScroll = Math.max(0, max.filtered - max.page);
  const scrolled = (d: number): ViewerStep => ({
    state: { ...s, scrollOffset: Math.max(0, Math.min(maxScroll, s.scrollOffset + d)) },
    action: "render",
  });
  if (s.mode === "search") {
    switch (k.kind) {
      case "char":
        return { state: { ...s, query: s.query + k.value, scrollOffset: 0 }, action: "render" };
      case "backspace":
        return { state: { ...s, query: s.query.slice(0, -1) }, action: "render" };
      case "submit":
        return { state: { ...s, mode: "list" }, action: "render" };
      case "escape":
        return { state: { ...s, mode: "list", query: "" }, action: "render" };
      default:
        return { state: s, action: "none" };
    }
  }
  switch (k.kind) {
    case "up":
      return scrolled(-1);
    case "down":
      return scrolled(1);
    case "char":
      switch (k.value) {
        case "j":
        case "J":
          return scrolled(1);
        case "k":
        case "K":
          return scrolled(-1);
        case "n":
        case "N":
          return { state: { ...s, sessionIdx: (s.sessionIdx + 1) % max.sessions, scrollOffset: 0 }, action: "render" };
        case "p":
        case "P":
          return {
            state: { ...s, sessionIdx: (s.sessionIdx - 1 + max.sessions) % max.sessions, scrollOffset: 0 },
            action: "render",
          };
        case "q":
        case "Q":
          return { state: s, action: "quit" };
        case "e":
          return { state: s, action: "export" };
        case "E":
          return { state: s, action: "exportAll" };
        case "/":
          return { state: { ...s, mode: "search", query: "", scrollOffset: 0 }, action: "render" };
        default:
          return { state: s, action: "none" };
      }
    default:
      return { state: s, action: "none" };
  }
}

// ── interactive viewer ────────────────────────────────────────────────────

export async function runLogsViewer(out: NodeJS.WritableStream): Promise<void> {
  const root = logsRoot();
  const sessions = loadAllSessions(root);

  if (sessions.length === 0) {
    out.write("(no session logs — run aether to create your first session)\n");
    return;
  }

  const boxWidth = (): number => Math.min(82, (process.stdout.columns ?? 84) - 2);

  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  if (!stdin.isTTY) {
    renderSession(sessions[0]!, "", 0, out, boxWidth());
    return;
  }

  stdin.setRawMode(true);
  stdin.resume();

  let state: ViewerState = { mode: "list", query: "", sessionIdx: 0, scrollOffset: 0 };

  const filteredEntries = (): LogEntry[] => {
    const session = sessions[state.sessionIdx]!;
    return state.query ? session.entries.filter((e) => matchesSearch(e, state.query)) : session.entries;
  };

  const render = (): void => {
    out.write("\x1b[2J\x1b[H");
    const session = sessions[state.sessionIdx];
    if (!session) return;
    renderSession(session, state.query, state.scrollOffset, out, boxWidth());

    const filtered = filteredEntries().length;
    const page = filtered > 0 ? Math.floor(state.scrollOffset / PAGE_SIZE) + 1 : 1;
    const pages = Math.max(1, Math.ceil(filtered / PAGE_SIZE));
    if (state.mode === "search") {
      out.write(
        theme.cyan(`\n  search: ${state.query}▌`) +
          theme.dim("   Enter apply · Esc cancel · Backspace edit\n"),
      );
    } else {
      const q = state.query ? theme.cyan(` filter:"${state.query}"`) : "";
      out.write(
        theme.dim(
          `\n  [${state.sessionIdx + 1}/${sessions.length}] ${session.label}${q}  page ${page}/${pages}  ` +
            `↑↓ scroll  j/k vim  n/p session  / search  e export  E export all  q quit\n`,
        ),
      );
    }
  };

  render();

  return new Promise<void>((resolve) => {
    const onResize = (): void => render();

    const cleanup = (): void => {
      stdin.removeListener("data", onData);
      process.stdout.removeListener("resize", onResize);
      if (!wasRaw) {
        stdin.setRawMode(false);
        stdin.pause();
      }
      out.write("\x1b[?25h"); // Show cursor
    };

    const step = (k: Key): boolean => {
      const max: ViewerLimits = {
        sessions: sessions.length,
        filtered: filteredEntries().length,
        page: PAGE_SIZE,
      };
      const r = viewerReduce(state, k, max);
      state = r.state;
      switch (r.action) {
        case "quit":
          cleanup();
          resolve();
          return true;
        case "render":
          render();
          return false;
        case "export":
          exportSession(sessions[state.sessionIdx]!, out);
          return false;
        case "exportAll":
          exportAllSessions(sessions, out);
          return false;
        default:
          return false;
      }
    };

    const onData = (chunk: Buffer): void => {
      for (const seq of splitKeys(chunk.toString("utf8"))) {
        const k = decodeKey(seq);
        // A printable run is reduced one char at a time (j/k/q… are per-char bindings).
        const keys: Key[] = k.kind === "char" ? [...k.value].map((v) => ({ kind: "char", value: v }) as Key) : [k];
        for (const kk of keys) if (step(kk)) return;
      }
    };

    stdin.on("data", onData);
    process.stdout.on("resize", onResize);
  });
}

function loadAllSessions(root: string): SessionView[] {
  if (!existsSync(root)) return [];
  const sessions: SessionView[] = [];

  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }

  for (const name of names) {
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

function renderSession(
  session: SessionView,
  query: string,
  offset: number,
  out: NodeJS.WritableStream,
  width = 82,
): void {
  const entries = query
    ? session.entries.filter((e) => matchesSearch(e, query))
    : session.entries;

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
    const pathCol = (e.path ?? (e.tool ? `tool:${e.tool}` : "—")).slice(0, W_PATH - 1).padEnd(W_PATH);

    const colorType = e.type === "tool_call" ? theme.cyan :
      e.type === "tool_result" ? theme.dim :
      e.type === "done" ? theme.bold : theme.muted;

    lines.push(theme.dim(ts) + colorType(type) + theme.dim(oid) + theme.dim(comm) + pathCol);
  }

  out.write(titledBox(lines, `📋 ${session.label}`, { width }) + "\n");
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
