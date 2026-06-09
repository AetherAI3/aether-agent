// src/ui/logs_viewer.ts — interactive ASCII log browser.
//
// Reads ~/.aether-agent/logs/ and renders sessions in a beautiful
// boxed column layout. Arrow keys scroll, 'e' exports current session
// JSON, 'E' exports ALL session JSONs, 'q' quits.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logsRoot } from "../core/session_log.js";
import { theme } from "./theme.js";
import { titledBox } from "./box.js";

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
    renderSession(sessions[0]!, searchQuery, scrollOffset, out);
    return;
  }

  stdin.setRawMode(true);
  stdin.resume();

  const render = () => {
    // Clear screen + move to top
    out.write("\x1b[2J\x1b[H");
    const session = sessions[sessionIdx];
    if (!session) return;
    renderSession(session, searchQuery, scrollOffset, out);

    const total = sessions.length;
    const entries = searchQuery
      ? session.entries.filter((e) => matchesSearch(e, searchQuery))
      : session.entries;
    const filtered = entries.length;
    const page = filtered > 0 ? Math.floor(scrollOffset / PAGE_SIZE) + 1 : 1;
    const pages = Math.max(1, Math.ceil(filtered / PAGE_SIZE));
    out.write(theme.dim(
      `\n  [${sessionIdx + 1}/${total}] ${session.label}  page ${page}/${pages}  ↑↓ scroll  j/k vim  n/p session  / search  e export  E export all  q quit\n`
    ));
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
        if (char === "j" || char === "J") {
          const session = sessions[sessionIdx];
          if (session) {
            const entries = searchQuery
              ? session.entries.filter((e) => matchesSearch(e, searchQuery))
              : session.entries;
            scrollOffset = Math.min(Math.max(0, entries.length - PAGE_SIZE), scrollOffset + 1);
          }
          render();
        } else if (char === "k" || char === "K") {
          scrollOffset = Math.max(0, scrollOffset - 1);
          render();
        } else if (char === "n" || char === "N") {
          sessionIdx = (sessionIdx + 1) % sessions.length;
          scrollOffset = 0;
          render();
        } else if (char === "p" || char === "P") {
          sessionIdx = (sessionIdx - 1 + sessions.length) % sessions.length;
          scrollOffset = 0;
          render();
        } else if (char === "q" || char === "Q" || char === "\x03") {
          cleanup();
          resolve();
          return;
        } else if (char === "e") {
          exportSession(sessions[sessionIdx]!, out);
        } else if (char === "E") {
          exportAllSessions(sessions, out);
        } else if (char === "/") {
          searchQuery = "";
          scrollOffset = 0;
          render();
        } else if (char === "\r") {
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

function renderSession(session: SessionView, query: string, offset: number, out: NodeJS.WritableStream): void {
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
    theme.dim("\u2500".repeat(W_TIME + W_TYPE + W_ORDER + W_COMMIT + W_PATH)),
    "",
  ];

  const page = entries.slice(offset, offset + PAGE_SIZE);
  for (const e of page) {
    const ts = e.ts.slice(0, W_TIME - 1).padEnd(W_TIME);
    const type = e.type.slice(0, W_TYPE - 1).padEnd(W_TYPE);
    const oid = (e.orderId ?? "\u2014").slice(0, W_ORDER - 1).padEnd(W_ORDER);
    const comm = (e.commitment ?? "\u2014").slice(0, W_COMMIT - 1).padEnd(W_COMMIT);
    const pathCol = (e.path ?? (e.tool ? `tool:${e.tool}` : "\u2014")).slice(0, W_PATH - 1).padEnd(W_PATH);

    const colorType = e.type === "tool_call" ? theme.cyan :
      e.type === "tool_result" ? theme.dim :
      e.type === "done" ? theme.bold : theme.muted;

    lines.push(theme.dim(ts) + colorType(type) + theme.dim(oid) + theme.dim(comm) + pathCol);
  }

  out.write(titledBox(lines, `\uD83D\uDCCB ${session.label}`, { width: 82 }) + "\n");
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
    out.write(`\n\x1b[K\u2717 ${err instanceof Error ? err.message : String(err)}\n`);
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
    out.write(`\n\x1b[K\u2717 ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
