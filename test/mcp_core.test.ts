import test from "node:test";
import assert from "node:assert/strict";
import {
  McpClient,
  MCP_PROVIDERS_PATH,
  MCP_CONNECTIONS_PATH,
} from "../src/core/mcp.js";
import type { ApiClient } from "../src/core/transport.js";

function fakeApi(routes: Record<string, unknown>): ApiClient & {
  calls: Array<{ method: string; path: string; body?: unknown }>;
} {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    calls,
    async getJson(path: string) {
      calls.push({ method: "GET", path });
      if (!(path in routes)) throw Object.assign(new Error("HTTP 404"), { status: 404 });
      return routes[path];
    },
    async postJson(path: string, body: unknown) {
      calls.push({ method: "POST", path, body });
      if (!(path in routes)) throw Object.assign(new Error("HTTP 404"), { status: 404 });
      return routes[path];
    },
  };
  return api as unknown as ApiClient & { calls: typeof calls };
}

test("listProviders + listConnections hit broker paths", async () => {
  const api = fakeApi({
    [MCP_PROVIDERS_PATH]: [{ provider_id: "fal.ai", display_name: "fal.ai", flow: "pat_paste" }],
    [MCP_CONNECTIONS_PATH]: [{ provider_id: "fal.ai", created_at: "t", updated_at: "t" }],
  });
  const c = new McpClient(api);
  assert.equal((await c.listProviders())[0]?.provider_id, "fal.ai");
  assert.equal((await c.listConnections())[0]?.provider_id, "fal.ai");
});

test("startOAuth posts provider_id; patStore posts pat", async () => {
  const api = fakeApi({
    "/mcp-broker/oauth/start": { flow: "pat_paste", validate_endpoint: "/oauth/pat-store" },
    "/mcp-broker/oauth/pat-store": { ok: true },
  });
  const c = new McpClient(api);
  const s = await c.startOAuth("fal.ai");
  assert.equal(s.flow, "pat_paste");
  const r = await c.patStore("fal.ai", "key-123");
  assert.equal(r.ok, true);
  const patCall = api.calls.find((x) => x.path === "/mcp-broker/oauth/pat-store");
  assert.deepEqual(patCall?.body, { provider_id: "fal.ai", pat: "key-123", metadata: {} });
});

test("pollUntilConnected resolves when provider appears", async () => {
  let n = 0;
  const api = {
    async getJson() {
      n++;
      return n >= 3 ? [{ provider_id: "fal.ai", created_at: "t", updated_at: "t" }] : [];
    },
    async postJson() { return {}; },
  } as unknown as ApiClient;
  const c = new McpClient(api);
  const got = await c.pollUntilConnected("fal.ai", async () => {}, { intervalSec: 0, timeoutSec: 5 });
  assert.equal(got.provider_id, "fal.ai");
});

test("pollUntilConnected times out", async () => {
  const api = { async getJson() { return []; }, async postJson() { return {}; } } as unknown as ApiClient;
  const c = new McpClient(api);
  await assert.rejects(
    () => c.pollUntilConnected("fal.ai", async () => {}, { intervalSec: 0, timeoutSec: 0 }),
    /timed out/,
  );
});

test("pollUntilConnected cancellation interrupts a provider sleep that ignores cancellation", async () => {
  const api = { async getJson() { return []; }, async postJson() { return {}; } } as unknown as ApiClient;
  const c = new McpClient(api);
  const controller = new AbortController();
  const polling = c.pollUntilConnected(
    "fal.ai",
    async () => new Promise<void>(() => {}),
    { signal: controller.signal, timeoutSec: 180 },
  );
  controller.abort();
  await assert.rejects(polling, (error: unknown) => {
    assert.equal((error as Error).name, "AbortError");
    return true;
  });
});

test("broker calls forward the cancellation signal and timeout to ApiClient", async () => {
  let receivedSignal: AbortSignal | undefined;
  let receivedTimeout: number | undefined;
  const api = {
    async getJson(_path: string, signal?: AbortSignal, timeoutMs?: number) {
      receivedSignal = signal;
      receivedTimeout = timeoutMs;
      return [];
    },
    async postJson() { return {}; },
  } as unknown as ApiClient;
  const controller = new AbortController();
  await new McpClient(api).listProviders({ signal: controller.signal, timeoutMs: 321 });
  assert.equal(receivedSignal, controller.signal);
  assert.equal(receivedTimeout, 321);
});

test("broker-absent backend rejects (404 propagates)", async () => {
  const api = fakeApi({});
  const c = new McpClient(api);
  await assert.rejects(() => c.listProviders());
});
