// /mcp — interactive MCP server manager (Claude Code style).
//
// Backend connections (OAuth/PAT providers via the mounted MCP broker) and
// local custom servers (mcp.json → mcp_servers for /agent/mcp-chat) in one
// arrow-key menu. All terminal I/O flows through MenuIO so the screen logic
// is fully testable with scripted keys.

import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import type { Key } from "./chat.js";
import { decodeKey } from "./chat.js";
import { McpClient } from "../core/mcp.js";
import type { McpProvider, McpConnection, StartOAuthResponse } from "../core/mcp.js";
import { LocalMcpStore, sanityCheckUrl } from "../core/mcp_store.js";
import { SelectMenu, renderMenu } from "../ui/menu.js";
import type { MenuItem } from "../ui/menu.js";
import { openBrowser } from "../core/browser.js";
import { theme } from "../ui/theme.js";

export interface MenuIO {
  out: Writable;
  nextKey(): Promise<Key>;
  /** Read one line (add/edit prompts, PAT paste; real impl masks when asked). */
  readLine(prompt: string, mask?: boolean): Promise<string>;
  openUrl(url: string): void;
  sleep(ms: number): Promise<void>;
}

interface Snapshot {
  providers: McpProvider[];
  connections: McpConnection[] | null; // null → broker unavailable
}

async function loadSnapshot(client: McpClient): Promise<Snapshot> {
  try {
    const [providers, connections] = await Promise.all([
      client.listProviders(),
      client.listConnections(),
    ]);
    return { providers, connections };
  } catch {
    return { providers: [], connections: null };
  }
}

const FOOT_MAIN = "↑↓ move · enter manage · a add · q quit";
const FOOT_SUB = "↑↓ move · enter select · q back";

function mainItems(snap: Snapshot, store: LocalMcpStore): MenuItem[] {
  const items: MenuItem[] = [];
  if (snap.connections === null) {
    items.push({ id: "_offline", label: "backend connections unavailable", disabled: true });
  } else {
    for (const p of snap.providers) {
      const connected = snap.connections.some((c) => c.provider_id === p.provider_id);
      items.push({
        id: `b:${p.provider_id}`,
        label: p.display_name,
        glyph: connected ? "✔" : "○",
        hint: connected ? "connected" : p.flow === "pat_paste" ? "needs API key" : "needs OAuth",
      });
    }
  }
  const local = store.list();
  if (local.length > 0) {
    items.push({ id: "_sep", label: "── custom servers ──", disabled: true });
    for (const s of local) {
      items.push({ id: `l:${s.name}`, label: s.name, glyph: "●", hint: s.url });
    }
  }
  return items;
}

type MenuPick =
  | { action: "select"; item: MenuItem }
  | { action: "add" }
  | { action: "quit" };

async function pickFromMenu(
  io: MenuIO,
  title: string,
  items: MenuItem[],
  footer: string,
  allowAdd: boolean,
): Promise<MenuPick> {
  const menu = new SelectMenu(items);
  for (;;) {
    io.out.write("\x1b[2J\x1b[H" + renderMenu(title, menu, footer));
    const k = await io.nextKey();
    if (k.kind === "up") menu.up();
    else if (k.kind === "down") menu.down();
    else if (k.kind === "submit") {
      const it = menu.selected();
      if (it) return { action: "select", item: it };
    } else if (k.kind === "char" && k.value.toLowerCase() === "a" && allowAdd) {
      return { action: "add" };
    } else if (
      k.kind === "interrupt" ||
      k.kind === "eof" ||
      k.kind === "ignore" || // bare ESC decodes to ignore
      (k.kind === "char" && k.value.toLowerCase() === "q")
    ) {
      return { action: "quit" };
    }
  }
}

function note(io: MenuIO, msg: string): void {
  io.out.write(theme.dim(msg) + "\n");
}

async function authenticate(client: McpClient, io: MenuIO, providerId: string): Promise<void> {
  let start: StartOAuthResponse;
  try {
    start = await client.startOAuth(providerId);
  } catch (e) {
    note(io, `auth start failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (start.flow === "pat_paste") {
    const pat = (await io.readLine(`Paste your ${providerId} API key: `, true)).trim();
    if (!pat) {
      note(io, "cancelled.");
      return;
    }
    try {
      const r = await client.patStore(providerId, pat);
      note(io, r.ok ? `✔ ${providerId} connected` : `✖ rejected: ${r.reason ?? "validation failed"}`);
    } catch (e) {
      note(io, `✖ store failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }
  if (start.flow === "auth_code_pkce" && start.authorize_url) {
    io.out.write(`Opening browser to authorize ${providerId}…\n${theme.dim(start.authorize_url)}\n`);
    io.openUrl(start.authorize_url);
    io.out.write("Waiting for authorization…\n");
    try {
      await client.pollUntilConnected(providerId, io.sleep);
      note(io, `✔ ${providerId} connected`);
    } catch (e) {
      note(io, `✖ ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }
  note(io, "unsupported auth flow.");
}

async function confirmChar(io: MenuIO, prompt: string): Promise<boolean> {
  io.out.write(prompt);
  const k = await io.nextKey();
  io.out.write("\n");
  return k.kind === "char" && k.value.toLowerCase() === "y";
}

async function manageBackend(
  client: McpClient,
  io: MenuIO,
  snap: Snapshot,
  providerId: string,
): Promise<void> {
  const connected = !!snap.connections?.some((c) => c.provider_id === providerId);
  const items: MenuItem[] = [
    { id: "auth", label: connected ? "Re-authenticate" : "Authenticate", glyph: "🔑" },
    { id: "test", label: "Test connection", glyph: "⟳" },
    ...(connected ? [{ id: "del", label: "Disconnect", glyph: "✖" }] : []),
    { id: "back", label: "Back", glyph: "←" },
  ];
  const r = await pickFromMenu(io, `MCP · ${providerId}`, items, FOOT_SUB, false);
  if (r.action !== "select") return;
  switch (r.item.id) {
    case "auth":
      await authenticate(client, io, providerId);
      break;
    case "test":
      try {
        const tools = await client.listTools(providerId);
        note(io, `✔ ${providerId}: ${tools.length} tools available`);
      } catch (e) {
        note(io, `✖ test failed: ${e instanceof Error ? e.message : String(e)} — try Re-authenticate`);
      }
      break;
    case "del":
      if (await confirmChar(io, `Disconnect ${providerId}? [y/N] `)) {
        try {
          await client.disconnect(providerId);
          note(io, `✔ disconnected ${providerId}`);
        } catch (e) {
          note(io, `✖ ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      break;
  }
}

async function manageLocal(store: LocalMcpStore, io: MenuIO, name: string): Promise<void> {
  const items: MenuItem[] = [
    { id: "test", label: "Test (sanity check URL)", glyph: "⟳" },
    { id: "edit", label: "Edit URL / token", glyph: "✎" },
    { id: "del", label: "Delete", glyph: "✖" },
    { id: "back", label: "Back", glyph: "←" },
  ];
  const r = await pickFromMenu(io, `MCP · ${name} (local)`, items, FOOT_SUB, false);
  if (r.action !== "select") return;
  const current = store.list().find((s) => s.name === name);
  switch (r.item.id) {
    case "test": {
      const err = current ? sanityCheckUrl(current.url) : "server missing";
      note(io, err ? `✖ ${err}` : "✔ URL shape OK — server allowlist validates at chat time");
      break;
    }
    case "edit": {
      const url = (await io.readLine(`URL [${current?.url ?? ""}]: `)).trim();
      const tok = (await io.readLine("Auth token (blank = keep): ", true)).trim();
      try {
        store.update(name, {
          ...(url ? { url } : {}),
          ...(tok ? { authToken: tok } : {}),
        });
        note(io, "✔ saved");
      } catch (e) {
        note(io, `✖ ${e instanceof Error ? e.message : String(e)}`);
      }
      break;
    }
    case "del":
      if (await confirmChar(io, `Delete ${name}? [y/N] `)) {
        store.remove(name);
        note(io, `✔ deleted ${name}`);
      }
      break;
  }
}

async function addLocal(store: LocalMcpStore, io: MenuIO): Promise<void> {
  const name = (await io.readLine("Server name: ")).trim();
  if (!name) {
    note(io, "cancelled.");
    return;
  }
  const url = (await io.readLine("Server URL (https://…): ")).trim();
  const tok = (await io.readLine("Auth token (optional): ", true)).trim();
  try {
    store.add({ name, url, transport: "http", ...(tok ? { authToken: tok } : {}) });
    note(io, `✔ added ${name} — passed to agent chats as an MCP server`);
  } catch (e) {
    note(io, `✖ ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Main loop. Pure orchestration over injected IO — testable end to end. */
export async function runMcpMenu(
  client: McpClient,
  store: LocalMcpStore,
  io: MenuIO,
): Promise<void> {
  for (;;) {
    const snap = await loadSnapshot(client);
    const r = await pickFromMenu(io, "MCP Servers", mainItems(snap, store), FOOT_MAIN, true);
    if (r.action === "quit") return;
    if (r.action === "add") {
      await addLocal(store, io);
      continue;
    }
    const kind = r.item.id.slice(0, 1);
    const id = r.item.id.slice(2);
    if (kind === "b") await manageBackend(client, io, snap, id);
    else if (kind === "l") await manageLocal(store, io, id);
  }
}

// ── Real-terminal IO + entry points ─────────────────────────────────────────

function makeRealIO(): MenuIO & { close(): void } {
  const pending: Array<(k: Key) => void> = [];
  const queue: Key[] = [];
  const onData = (chunk: Buffer): void => {
    const k = decodeKey(chunk.toString("utf8"));
    const w = pending.shift();
    if (w) w(k);
    else queue.push(k);
  };
  process.stdin.on("data", onData);
  const io: MenuIO & { close(): void } = {
    out: process.stdout,
    nextKey(): Promise<Key> {
      const q = queue.shift();
      if (q) return Promise.resolve(q);
      return new Promise((res) => pending.push(res));
    },
    async readLine(prompt: string, mask?: boolean): Promise<string> {
      process.stdout.write(prompt);
      let acc = "";
      for (;;) {
        const k = await io.nextKey();
        if (k.kind === "submit") {
          process.stdout.write("\n");
          return acc;
        }
        if (k.kind === "interrupt" || k.kind === "eof") {
          process.stdout.write("\n");
          return "";
        }
        if (k.kind === "backspace") {
          if (acc) {
            acc = acc.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (k.kind === "char") {
          acc += k.value;
          process.stdout.write(mask ? "*" : k.value);
        }
      }
    },
    openUrl: (u: string) => openBrowser(u),
    sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    close(): void {
      process.stdin.removeListener("data", onData);
    },
  };
  return io;
}

/** REPL entry: stdin is already in raw mode (chat.ts owns it). */
export async function mcpFromRepl(ctx: AppContext): Promise<void> {
  const io = makeRealIO();
  try {
    await runMcpMenu(new McpClient(ctx.api), new LocalMcpStore(), io);
  } finally {
    io.close();
    process.stdout.write("\x1b[2J\x1b[H");
  }
}

/** Top-level `aether mcp`: owns raw mode itself. */
export async function cmdMcp(ctx: AppContext): Promise<number> {
  if (!process.stdin.isTTY) {
    process.stdout.write("aether mcp requires an interactive terminal\n");
    return 1;
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const io = makeRealIO();
  try {
    await runMcpMenu(new McpClient(ctx.api), new LocalMcpStore(), io);
    return 0;
  } finally {
    io.close();
    try {
      process.stdin.setRawMode(false);
    } catch {
      /* terminal gone */
    }
    process.stdin.pause();
    process.stdout.write("\n");
  }
}
