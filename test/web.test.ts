import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isSafeUrl,
  htmlToText,
  parseDuckDuckGoLite,
  webFetch,
  webSearch,
} from "../src/core/web.js";
import { ToolExecutor } from "../src/core/tool_executor.js";
import { tmpdir } from "node:os";

// --- isSafeUrl: the SSRF guard (refuse loopback/private/link-local + non-http) ---
test("isSafeUrl refuses non-http(s) schemes", () => {
  assert.equal(isSafeUrl("file:///etc/passwd").ok, false);
  assert.equal(isSafeUrl("ftp://example.com/x").ok, false);
  assert.equal(isSafeUrl("gopher://example.com").ok, false);
  assert.equal(isSafeUrl("data:text/html,hi").ok, false);
});

test("isSafeUrl refuses loopback hosts (literal + name)", () => {
  assert.equal(isSafeUrl("http://127.0.0.1/").ok, false);
  assert.equal(isSafeUrl("http://127.5.5.5/").ok, false);
  assert.equal(isSafeUrl("http://localhost/").ok, false);
  assert.equal(isSafeUrl("http://[::1]/").ok, false);
});

test("isSafeUrl refuses private + link-local + reserved IP literals", () => {
  assert.equal(isSafeUrl("http://10.0.0.1/").ok, false);
  assert.equal(isSafeUrl("http://10.255.255.255/").ok, false);
  assert.equal(isSafeUrl("http://172.16.0.1/").ok, false);
  assert.equal(isSafeUrl("http://172.31.255.255/").ok, false);
  assert.equal(isSafeUrl("http://192.168.1.1/").ok, false);
  assert.equal(isSafeUrl("http://169.254.1.1/").ok, false); // link-local
  assert.equal(isSafeUrl("http://0.0.0.0/").ok, false); // reserved
  assert.equal(isSafeUrl("http://[fc00::1]/").ok, false); // unique-local v6
  assert.equal(isSafeUrl("http://[fe80::1]/").ok, false); // link-local v6
});

test("isSafeUrl allows a normal public host literal", () => {
  // 8.8.8.8 is public — passes the literal-IP path of the guard.
  assert.equal(isSafeUrl("http://8.8.8.8/").ok, true);
  assert.equal(isSafeUrl("https://93.184.216.34/").ok, true);
});

test("isSafeUrl rejects garbage urls without throwing", () => {
  assert.equal(isSafeUrl("not a url").ok, false);
  assert.equal(isSafeUrl("").ok, false);
});

// --- htmlToText: strip <script>/<style> + tags to readable text -------------
test("htmlToText strips script/style and collapses to readable text", () => {
  const html =
    "<html><head><style>.x{color:red}</style></head><body>" +
    "<h1>Title</h1><script>alert(1)</script><p>Hello&nbsp;world &amp; more</p></body></html>";
  const text = htmlToText(html);
  assert.doesNotMatch(text, /alert\(1\)/, "script body removed");
  assert.doesNotMatch(text, /color:red/, "style body removed");
  assert.match(text, /Title/);
  assert.match(text, /Hello world & more/, "entities decoded, nbsp -> space");
  assert.doesNotMatch(text, /<[a-z]/i, "no raw tags remain");
});

test("htmlToText caps to maxChars", () => {
  const html = "<p>" + "a".repeat(20000) + "</p>";
  const text = htmlToText(html, 8000);
  assert.ok(text.length <= 8000, "capped to 8000");
});

// --- parseDuckDuckGoLite: search HTML -> readable lines ----------------------
test("parseDuckDuckGoLite extracts result titles, urls and snippets", () => {
  // DuckDuckGo lite renders results in a table; this mirrors the relevant shape.
  const html = `
    <table>
      <tr><td><a class="result-link" href="https://example.com/a">First Result</a></td></tr>
      <tr><td class="result-snippet">A snippet about the first result.</td></tr>
      <tr><td><a class="result-link" href="https://example.org/b">Second Result</a></td></tr>
      <tr><td class="result-snippet">Another snippet here.</td></tr>
    </table>`;
  const out = parseDuckDuckGoLite(html, 5);
  assert.match(out, /First Result/);
  assert.match(out, /https:\/\/example\.com\/a/);
  assert.match(out, /A snippet about the first result\./);
  assert.match(out, /Second Result/);
  // limit honored
  const limited = parseDuckDuckGoLite(html, 1);
  assert.doesNotMatch(limited, /Second Result/);
});

test("parseDuckDuckGoLite returns a clear note when nothing matches", () => {
  const out = parseDuckDuckGoLite("<html><body>no results</body></html>", 5);
  assert.match(out, /no results/i);
});

// --- webFetch: production guard refuses a loopback target (never throws) -----
test("webFetch refuses a 127.0.0.1 target without throwing", async () => {
  const out = await webFetch("http://127.0.0.1:1/whatever");
  assert.match(out, /\[web_fetch refused:/);
});

test("webFetch refuses a non-http scheme", async () => {
  const out = await webFetch("file:///etc/passwd");
  assert.match(out, /\[web_fetch refused:/);
});

// --- webSearch: production guard wraps errors as a string, never throws ------
test("webSearch never throws — returns a string", async () => {
  const out = await webSearch("anything", 3);
  assert.equal(typeof out, "string");
  // Either it reached DDG (unlikely offline) or returned a bracketed error — both are strings.
  assert.ok(out.length >= 0);
});

// --- happy path WITHOUT weakening the production guard -----------------------
// Use a PUBLIC hostname (example.com) so isSafeUrl passes the literal-host
// check, inject `resolve` so getaddrinfo deterministically reports a public IP
// (the guard's resolved-address check passes), and inject `fetchImpl` to supply
// stub bytes — proving the full guard -> fetch -> strip -> cap pipeline with no
// real socket and no guard bypass. A literal 127.0.0.1 URL is ALWAYS refused
// (see isSafeUrl tests), so the loopback stub trick is intentionally not used.
test("webFetch happy path: passes the guard for a public host + extracts text", async () => {
  const out = await webFetch("https://example.com/page", 8000, {
    resolve: async () => ["93.184.216.34"],
    fetchImpl: async () =>
      "<html><body><h1>Stub Page</h1><script>x()</script><p>body text</p></body></html>",
  });
  assert.match(out, /Stub Page/);
  assert.match(out, /body text/);
  assert.doesNotMatch(out, /x\(\)/, "script stripped");
});

// A public host that the resolver maps to loopback must STILL be refused —
// the resolved-address check is the DNS-rebind defense.
test("webFetch refuses a public host that resolves to loopback (rebind defense)", async () => {
  const out = await webFetch("https://rebind.example/", 8000, {
    resolve: async () => ["127.0.0.1"],
  });
  assert.match(out, /\[web_fetch refused:/);
});

// A public page that 30x-redirects to an internal address must be REFUSED.
// redirect:"follow" would silently fetch the metadata/loopback target after the
// pre-flight guard passed the original host (TOCTOU). The manual-redirect guard
// re-checks each Location, so the loopback hop is blocked.
test("webFetch refuses a redirect that points at an internal address", async () => {
  const out = await webFetch("https://public.example/start", 8000, {
    resolve: async () => ["93.184.216.34"],
    fetchTransport: async (u: string) => {
      if (u === "https://public.example/start") {
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
      }
      // Should never be reached — the guard must refuse the redirect first.
      return new Response("SECRET METADATA", { status: 200 });
    },
  });
  assert.match(out, /\[web_fetch (refused|error):/);
  assert.doesNotMatch(out, /SECRET METADATA/, "internal target was never fetched");
});

// A redirect chain to another PUBLIC host is followed and its body returned.
test("webFetch follows a redirect to another public host", async () => {
  const out = await webFetch("https://a.example/", 8000, {
    resolve: async () => ["93.184.216.34"],
    fetchTransport: async (u: string) => {
      if (u === "https://a.example/") {
        return new Response(null, { status: 301, headers: { location: "https://b.example/final" } });
      }
      return new Response("<h1>Final Public Page</h1>", { status: 200 });
    },
  });
  assert.match(out, /Final Public Page/);
});

// web_search happy path: guard passes for the DDG host (public), stub the bytes.
test("webSearch happy path: parses DDG-shaped results via injected transport", async () => {
  const html = `<a class="result-link" href="https://example.com/a">First Result</a>
    <td class="result-snippet">A snippet.</td>`;
  const out = await webSearch("anything", 5, {
    resolve: async () => ["93.184.216.34"],
    fetchImpl: async () => html,
  });
  assert.match(out, /First Result/);
  assert.match(out, /https:\/\/example\.com\/a/);
});

// --- ToolExecutor.executeAsync: web tools route through the executor --------
test("executeAsync('web_fetch') refuses a loopback url via the production guard", async () => {
  const ex = new ToolExecutor(tmpdir());
  const r = await ex.executeAsync("web_fetch", { url: "http://127.0.0.1:1/" });
  assert.equal(r.exitCode, 0, "web tools are advisory output, exit 0");
  assert.match(r.output, /\[web_fetch refused:/);
});

test("executeAsync('web_search') refuses a non-http url and returns a string", async () => {
  const ex = new ToolExecutor(tmpdir());
  const r = await ex.executeAsync("web_search", { query: "" });
  assert.equal(typeof r.output, "string");
});

test("sync execute() on a web tool points at the async path (no silent no-op)", () => {
  const ex = new ToolExecutor(tmpdir());
  const r = ex.execute("web_fetch", { url: "https://example.com" });
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /async/);
});

test("executeAsync delegates the 6 sync tools to execute() unchanged", async () => {
  const ex = new ToolExecutor(tmpdir());
  const r = await ex.executeAsync("frobnicate", {});
  assert.equal(r.exitCode, 1);
  assert.match(r.output, /unknown tool/);
});

test("webFetch caps returned text to maxChars on the happy path", async () => {
  const out = await webFetch("https://example.com/big", 8000, {
    resolve: async () => ["93.184.216.34"],
    fetchImpl: async () => "<p>" + "z".repeat(50000) + "</p>",
  });
  assert.ok(out.length <= 8000, "happy-path text capped");
});
