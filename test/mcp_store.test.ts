import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalMcpStore, sanityCheckUrl, mcpServersForChat } from "../src/core/mcp_store.js";

function freshStore(): { store: LocalMcpStore; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "aether-mcp-"));
  const file = join(dir, "mcp.json");
  return { store: new LocalMcpStore(file), file };
}

test("add/list/update/remove roundtrip", () => {
  const { store } = freshStore();
  store.add({ name: "docs", url: "https://mcp.example.com/sse", transport: "http" });
  assert.equal(store.list().length, 1);
  store.update("docs", { url: "https://mcp.example.com/v2" });
  assert.equal(store.list()[0]?.url, "https://mcp.example.com/v2");
  assert.equal(store.remove("docs"), true);
  assert.equal(store.list().length, 0);
  assert.equal(store.remove("ghost"), false);
});

test("duplicate name rejected", () => {
  const { store } = freshStore();
  store.add({ name: "a", url: "https://x.example/m", transport: "http" });
  assert.throws(() => store.add({ name: "a", url: "https://y.example/m", transport: "http" }), /exists/);
});

test("bad url rejected on add", () => {
  const { store } = freshStore();
  assert.throws(
    () => store.add({ name: "evil", url: "http://remote.example/m", transport: "http" }),
    /https/,
  );
});

test("corrupt reads are non-mutating and mutators fail closed", () => {
  const { store, file } = freshStore();
  const raw = "{not json";
  writeFileSync(file, raw, "utf8");
  assert.deepEqual(store.list(), []);
  assert.equal(readFileSync(file, "utf8"), raw);
  assert.equal(existsSync(file + ".bak"), false);
  assert.throws(
    () => store.add({ name: "docs", url: "https://x.example/m", transport: "http" }),
    /repair/,
  );
  assert.equal(readFileSync(file, "utf8"), raw);
});

test("unsupported stdio child-server entries fail closed instead of spawning an unowned process", () => {
  const { store, file } = freshStore();
  const raw = JSON.stringify({
    servers: [{ name: "child", transport: "stdio", command: "missing-mcp-executable" }],
  });
  writeFileSync(file, raw, "utf8");
  const inspected = store.inspect();
  assert.equal(inspected.status, "corrupt");
  assert.deepEqual(inspected.servers, []);
  assert.equal(readFileSync(file, "utf8"), raw);
});

test("repair is explicit, backup-first, and resets only after preserving bytes", () => {
  const { store, file } = freshStore();
  const raw = "{not json";
  writeFileSync(file, raw, "utf8");
  const result = store.repair("2026-07-10T00:00:00.000Z");
  assert.equal(result.repaired, true);
  assert.ok(result.backup);
  assert.equal(readFileSync(result.backup!, "utf8"), raw);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { servers: [] });
});

test("interrupted repair leaves the original and completed backup intact", () => {
  const { store, file } = freshStore();
  const raw = "{interrupted";
  const now = "2026-07-10T01:02:03.000Z";
  const backup = file + ".bak-2026-07-10T01-02-03-000Z";
  writeFileSync(file, raw, "utf8");
  assert.throws(
    () => store.repair(now, () => { throw new Error("simulated interruption"); }),
    /simulated interruption/,
  );
  assert.equal(readFileSync(file, "utf8"), raw);
  assert.equal(readFileSync(backup, "utf8"), raw);
});

test("denied or non-file registry paths fail closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "aether-mcp-denied-"));
  const store = new LocalMcpStore(dir);
  assert.equal(store.inspect().status, "unreadable");
  assert.throws(
    () => store.add({ name: "docs", url: "https://x.example/m", transport: "http" }),
    /unreadable/,
  );
  assert.throws(() => store.repair("2026-07-10T00:00:00.000Z"));
});

test("sanityCheckUrl rules", () => {
  assert.equal(sanityCheckUrl("https://ok.example/mcp"), null);
  assert.match(sanityCheckUrl("http://remote.example/mcp") ?? "", /https/);
  assert.equal(sanityCheckUrl("http://127.0.0.1:8080/mcp"), null); // loopback dev OK
  assert.match(sanityCheckUrl("https://user:pw@h.example/m") ?? "", /credentials/);
  assert.match(sanityCheckUrl("not a url") ?? "", /invalid/);
});

test("mcpServersForChat shapes entries for /agent/mcp-chat", () => {
  const { store } = freshStore();
  store.add({ name: "docs", url: "https://mcp.example.com/sse", transport: "http", authToken: "tok" });
  assert.deepEqual(mcpServersForChat(store), [
    { name: "docs", url: "https://mcp.example.com/sse", authorization_token: "tok" },
  ]);
});

test("write lands valid JSON on disk", () => {
  const { store, file } = freshStore();
  store.add({ name: "a", url: "https://x.example/m", transport: "http" });
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(parsed.servers[0].name, "a");
});
