import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { cmdMcp } from "../src/commands/mcp.js";
import type { AppContext } from "../src/core/context.js";
import type { McpClient } from "../src/core/mcp.js";
import {
  collectMcpDiagnostics,
  renderMcpDiagnostics,
} from "../src/core/mcp_diagnostics.js";
import { LocalMcpStore } from "../src/core/mcp_store.js";

const SECRET = "SENTINEL-mcp-credential-never-render";

function client(options: { unavailable?: boolean; toolFailure?: boolean } = {}): McpClient {
  return {
    async listProviders() {
      if (options.unavailable) throw new Error("offline " + SECRET);
      return [{ provider_id: "docs", display_name: "Docs", flow: "pat_paste" }];
    },
    async listConnections() {
      if (options.unavailable) throw new Error("offline " + SECRET);
      return [{ provider_id: "docs", created_at: "t", updated_at: "t" }];
    },
    async listTools() {
      if (options.toolFailure) throw new Error("catalog " + SECRET);
      return [{ name: "search" }, { name: "read" }];
    },
  } as unknown as McpClient;
}

function fixture(): { store: LocalMcpStore; file: string } {
  const root = mkdtempSync(join(tmpdir(), "aether-mcp-diag-"));
  const file = join(root, "mcp.json");
  return { store: new LocalMcpStore(file), file };
}

function output(): { out: Writable; text: () => string } {
  const chunks: string[] = [];
  return {
    out: { write: (value: string) => (chunks.push(value), true) } as unknown as Writable,
    text: () => chunks.join(""),
  };
}

function context(yes: boolean, confirm: () => Promise<boolean>): AppContext {
  return {
    flags: { yes, json: false, audit: false, cwd: process.cwd() },
    confirm,
  } as unknown as AppContext;
}

test("MCP diagnostics report broker, provider tools, URL shape, and redacted auth", async () => {
  const { store } = fixture();
  store.add({
    name: "local",
    url: "https://mcp.example.test/sse?token=" + SECRET + "#secret",
    transport: "http",
    authToken: SECRET,
  });
  const report = await collectMcpDiagnostics(client(), store, {
    now: "2026-07-10T00:00:00.000Z",
  });
  assert.equal(report.brokerStatus, "available");
  assert.equal(report.providers[0]?.toolCount, 2);
  assert.equal(report.localServers[0]?.authConfigured, true);
  assert.equal(report.localServers[0]?.url.includes("?"), false);
  assert.equal(JSON.stringify(report).includes(SECRET), false);
  assert.equal(renderMcpDiagnostics(report).includes(SECRET), false);
  assert.match(
    report.checks.find((check) => check.id === "local-url:local")?.detail ?? "",
    /no direct probe/,
  );
});

test("broker and provider failures are bounded, fail-soft, and credential-redacted", async () => {
  const { store } = fixture();
  const offline = await collectMcpDiagnostics(client({ unavailable: true }), store, {
    timeoutMs: 50,
  });
  assert.equal(offline.brokerStatus, "unavailable");
  assert.equal(JSON.stringify(offline).includes(SECRET), false);

  const catalog = await collectMcpDiagnostics(client({ toolFailure: true }), store, {
    timeoutMs: 50,
  });
  assert.equal(catalog.providers[0]?.status, "fail");
  assert.equal(JSON.stringify(catalog).includes(SECRET), false);
});

test("corrupt diagnostics do not mutate and command repair requires confirmation", async () => {
  const { store, file } = fixture();
  const raw = "{broken-" + SECRET;
  writeFileSync(file, raw);
  const report = await collectMcpDiagnostics(client({ unavailable: true }), store);
  assert.equal(report.registryStatus, "corrupt");
  assert.equal(report.checks.find((check) => check.id === "registry-read")?.status, "fail");
  assert.equal(readFileSync(file, "utf8"), raw);
  assert.equal(JSON.stringify(report).includes(SECRET), false);

  const cancelled = output();
  const cancelCode = await cmdMcp(context(false, async () => false), ["repair"], {
    out: cancelled.out,
    store,
    client: client(),
  });
  assert.equal(cancelCode, 0);
  assert.match(cancelled.text(), /kept unchanged/);
  assert.equal(readFileSync(file, "utf8"), raw);

  const repaired = output();
  const repairCode = await cmdMcp(context(false, async () => true), ["repair"], {
    out: repaired.out,
    store,
    client: client(),
  });
  assert.equal(repairCode, 0);
  assert.match(repaired.text(), /backed up and reset/);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { servers: [] });
});

test("list and doctor subcommands work without an interactive terminal", async () => {
  const { store } = fixture();
  const listed = output();
  assert.equal(
    await cmdMcp(context(false, async () => false), ["list"], {
      out: listed.out,
      store,
      client: client(),
    }),
    0,
  );
  assert.match(listed.text(), /MCP diagnostics/);

  const broken = fixture();
  writeFileSync(broken.file, "{bad");
  const diagnosed = output();
  assert.equal(
    await cmdMcp(context(false, async () => false), ["doctor"], {
      out: diagnosed.out,
      store: broken.store,
      client: client(),
    }),
    1,
  );
});
