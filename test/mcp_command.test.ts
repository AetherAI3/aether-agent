import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMcpMenu } from "../src/commands/mcp.js";
import type { MenuIO } from "../src/commands/mcp.js";
import { LocalMcpStore } from "../src/core/mcp_store.js";
import { McpClient } from "../src/core/mcp.js";
import type { Key } from "../src/commands/chat.js";
import type { ApiClient } from "../src/core/transport.js";

function keyScript(seq: Array<Key | string>): () => Promise<Key> {
  const keys: Key[] = seq.map((k) =>
    typeof k === "string" ? ({ kind: "char", value: k } as Key) : k,
  );
  let i = 0;
  return async () => keys[i++] ?? ({ kind: "interrupt" } as Key);
}

function makeIO(keys: Array<Key | string>, lines: string[] = []) {
  const out: string[] = [];
  let li = 0;
  const io: MenuIO = {
    out: { write: (s: string) => (out.push(s), true) } as unknown as MenuIO["out"],
    nextKey: keyScript(keys),
    readLine: async () => lines[li++] ?? "",
    openUrl: () => {},
    sleep: async () => {},
  };
  return { io, out };
}

function fakeApi(routes: Record<string, unknown>): ApiClient {
  return {
    async getJson(path: string) {
      if (!(path in routes)) throw Object.assign(new Error("HTTP 404"), { status: 404 });
      return routes[path];
    },
    async postJson(path: string) {
      if (!(path in routes)) throw Object.assign(new Error("HTTP 404"), { status: 404 });
      return routes[path];
    },
  } as unknown as ApiClient;
}

function deps(routes: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "aether-mcpcmd-"));
  return {
    client: new McpClient(fakeApi(routes)),
    store: new LocalMcpStore(join(dir, "mcp.json")),
  };
}

test("q quits immediately; menu rendered with providers", async () => {
  const { client, store } = deps({
    "/mcp-broker/oauth/providers": [{ provider_id: "fal.ai", display_name: "fal.ai", flow: "pat_paste" }],
    "/mcp-broker/oauth/connections": [],
  });
  const { io, out } = makeIO(["q"]);
  await runMcpMenu(client, store, io);
  const all = out.join("");
  assert.match(all, /MCP Servers/);
  assert.match(all, /fal\.ai/);
});

test("backend 404 degrades to local-only", async () => {
  const { client, store } = deps({});
  store.add({ name: "docs", url: "https://x.example/m", transport: "http" });
  const { io, out } = makeIO(["q"]);
  await runMcpMenu(client, store, io);
  const all = out.join("");
  assert.match(all, /backend connections unavailable/i);
  assert.match(all, /docs/);
});

test("add flow creates a local server", async () => {
  const { client, store } = deps({});
  // 'a' opens add; readLine supplies name, url, token(empty); then 'q' quits.
  const { io } = makeIO(["a", "q"], ["docs", "https://mcp.example.com/sse", ""]);
  await runMcpMenu(client, store, io);
  assert.equal(store.list()[0]?.name, "docs");
});

test("delete flow removes local server after y confirm", async () => {
  const { client, store } = deps({});
  store.add({ name: "docs", url: "https://x.example/m", transport: "http" });
  // Enter on docs row -> manage menu -> down to Delete -> Enter -> 'y' -> back at main -> 'q'
  const { io } = makeIO([
    { kind: "submit" },
    { kind: "down" },
    { kind: "down" },
    { kind: "submit" },
    "y",
    "q",
  ]);
  await runMcpMenu(client, store, io);
  assert.equal(store.list().length, 0);
});

test("pat auth flow stores PAT via broker", async () => {
  let patBody: unknown = null;
  const api = {
    async getJson(path: string) {
      if (path === "/mcp-broker/oauth/providers")
        return [{ provider_id: "fal.ai", display_name: "fal.ai", flow: "pat_paste" }];
      if (path === "/mcp-broker/oauth/connections") return [];
      throw Object.assign(new Error("HTTP 404"), { status: 404 });
    },
    async postJson(path: string, body: unknown) {
      if (path === "/mcp-broker/oauth/start") return { flow: "pat_paste" };
      if (path === "/mcp-broker/oauth/pat-store") {
        patBody = body;
        return { ok: true };
      }
      throw Object.assign(new Error("HTTP 404"), { status: 404 });
    },
  } as unknown as ApiClient;
  const dir = mkdtempSync(join(tmpdir(), "aether-mcpcmd-"));
  const store = new LocalMcpStore(join(dir, "mcp.json"));
  // Enter on fal.ai -> manage -> Enter on Authenticate -> paste PAT -> quit out
  const { io, out } = makeIO(
    [{ kind: "submit" }, { kind: "submit" }, "q", "q"],
    ["fal-secret-key"],
  );
  await runMcpMenu(new McpClient(api), store, io);
  assert.deepEqual(patBody, { provider_id: "fal.ai", pat: "fal-secret-key", metadata: {} });
  assert.match(out.join(""), /connected/i);
});
