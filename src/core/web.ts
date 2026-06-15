// Web tools — web_search (DuckDuckGo lite, no key) + web_fetch (read a page).
//
// SECURITY (SSRF): both tools refuse non-http(s) schemes and any host that
// resolves to a loopback / private / link-local / reserved address. The check
// runs on the URL's literal host (isSafeUrl) AND, before any network call,
// against every address getaddrinfo returns for a DNS name — so a public name
// that resolves to 127.0.0.1 (DNS-rebind / internal split-horizon) is refused.
//
// Neither function throws to the caller: failures and refusals come back as a
// bracketed string ("[web_fetch refused: ..]" / "[web_search error: ..]"), so
// the tool loop treats them as ordinary tool output.
//
// No new deps: Node's global fetch + node:dns only.

import { lookup } from "node:dns/promises";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2MB read cap
const TEXT_CAP = 8000; // returned text cap
const USER_AGENT = "AetherCode/0.1 (+https://aethersystems.net)";

export interface SafeUrlResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Test-only injection seams. `resolve` overrides getaddrinfo so a test can let a
 * (public) hostname pass the SSRF guard deterministically; `fetchImpl` overrides
 * the transport so a test can return stub bytes WITHOUT weakening the guard or
 * opening a real socket. Production passes neither and uses node:dns + fetch.
 */
export interface FetchDeps {
  readonly resolve?: (host: string) => Promise<readonly string[]>;
  readonly fetchImpl?: (url: string) => Promise<string>;
}

// --- IP classification ------------------------------------------------------
/** True if a literal IPv4 string is loopback/private/link-local/reserved. */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const oc = parts.map((p) => Number(p));
  if (oc.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = oc as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 reserved ("this host")
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224+/multicast + reserved/experimental
  return false;
}

/** True if a literal IPv6 string is loopback/unique-local/link-local/reserved. */
function isBlockedIPv6(raw: string): boolean {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  // strip a zone id (fe80::1%eth0)
  const pct = ip.indexOf("%");
  if (pct !== -1) ip = ip.slice(0, pct);
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified
  // IPv4-mapped (::ffff:127.0.0.1) — classify the embedded v4
  const v4mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
  if (v4mapped && v4mapped[1]) return isBlockedIPv4(v4mapped[1]);
  if (ip.startsWith("fe80")) return true; // link-local
  // unique-local fc00::/7 = fc00..fdff
  const head = ip.split(":")[0] ?? "";
  if (head.length >= 2) {
    const hi = parseInt(head.slice(0, 2), 16);
    if (!Number.isNaN(hi) && (hi & 0xfe) === 0xfc) return true; // fc00::/7
  }
  if (ip.startsWith("ff")) return true; // multicast
  return false;
}

function looksLikeIPv4(host: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function looksLikeIPv6(host: string): boolean {
  return host.includes(":");
}

/** True when a resolved/literal address is one we must refuse. */
export function isBlockedAddress(ip: string): boolean {
  const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  if (looksLikeIPv6(bare)) return isBlockedIPv6(bare);
  return isBlockedIPv4(bare);
}

// --- isSafeUrl: synchronous scheme + literal-host guard ---------------------
/**
 * Validate scheme (http/https only) and the URL's LITERAL host. A literal IP
 * host is classified directly; a bare "localhost" is refused; a DNS name passes
 * here (its resolved addresses are checked separately before fetching).
 */
export function isSafeUrl(url: string): SafeUrlResult {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: `scheme ${u.protocol} not allowed (http/https only)` };
  }
  const host = u.hostname.toLowerCase();
  if (!host) return { ok: false, reason: "empty host" };
  if (host === "localhost" || host.endsWith(".localhost")) {
    return { ok: false, reason: "localhost is blocked" };
  }
  if (looksLikeIPv4(host) || looksLikeIPv6(host) || (u.hostname.startsWith("[") && u.hostname.endsWith("]"))) {
    if (isBlockedAddress(u.hostname)) {
      return { ok: false, reason: `host ${host} resolves to a blocked address` };
    }
  }
  return { ok: true };
}

/** Resolve a host to all its addresses (default: getaddrinfo). */
async function resolveAll(host: string, deps?: FetchDeps): Promise<readonly string[]> {
  if (deps?.resolve) return deps.resolve(host);
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
}

/**
 * Full pre-flight guard: scheme + literal host (isSafeUrl) AND every resolved
 * address. Returns a reason string if blocked, or null if safe to fetch.
 */
async function guard(url: string, deps?: FetchDeps): Promise<string | null> {
  const safe = isSafeUrl(url);
  if (!safe.ok) return safe.reason ?? "blocked URL";
  const host = new URL(url).hostname;
  // Literal IPs were already classified by isSafeUrl; only resolve DNS names.
  if (looksLikeIPv4(host) || looksLikeIPv6(host) || (host.startsWith("[") && host.endsWith("]"))) {
    return null;
  }
  let addrs: readonly string[];
  try {
    addrs = await resolveAll(host, deps);
  } catch (err) {
    return `cannot resolve host ${host}: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (addrs.length === 0) return `host ${host} did not resolve`;
  for (const a of addrs) {
    if (isBlockedAddress(a)) return `host ${host} resolves to a blocked address (${a})`;
  }
  return null;
}

// --- HTML -> readable text --------------------------------------------------
const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  let out = s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);
  out = out.replace(/&#(\d+);/g, (_m, d: string) => {
    const code = Number(d);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
  });
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => {
    const code = parseInt(h, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
  });
  return out;
}

/** Strip script/style + all tags, decode entities, collapse whitespace, cap. */
export function htmlToText(html: string, maxChars: number = TEXT_CAP): string {
  let s = html;
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // block-ish tags -> newline so structure survives readably
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|br|section|article|header|footer)\s*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\f\v]+/g, " ");
  s = s.replace(/\n\s*\n\s*\n+/g, "\n\n");
  s = s
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
  return s.length > maxChars ? s.slice(0, maxChars) : s;
}

// --- DuckDuckGo lite result parsing ----------------------------------------
/** Parse DuckDuckGo lite/html result markup into readable "N. Title\nurl\nsnippet" lines. */
export function parseDuckDuckGoLite(html: string, limit: number = 5): string {
  const results: Array<{ title: string; url: string }> = [];
  // result anchors: lite uses class "result-link"; html endpoint uses "result__a".
  const anchorRe = /<a[^>]*class="[^"]*result(?:-link|__a)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    if (results.length >= limit) break;
    const url = decodeEntities(m[1] ?? "").trim();
    const title = htmlToText(m[2] ?? "", 300).replace(/\s+/g, " ").trim();
    if (url && title) results.push({ title, url });
  }
  // snippets, in document order
  const snippets: string[] = [];
  const snippetRe = /class="[^"]*result(?:-snippet|__snippet)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|a|div)>/gi;
  for (const m of html.matchAll(snippetRe)) {
    snippets.push(htmlToText(m[1] ?? "", 300).replace(/\s+/g, " ").trim());
  }
  if (results.length === 0) return "[web_search: no results]";
  const lines = results.map((r, i) => {
    const snip = snippets[i] ? `\n   ${snippets[i]}` : "";
    return `${i + 1}. ${r.title}\n   ${r.url}${snip}`;
  });
  return lines.join("\n\n");
}

// --- fetch with byte cap + timeout ------------------------------------------
async function fetchCapped(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok && !res.body) {
      return `[http ${res.status}]`;
    }
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let out = "";
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        out += decoder.decode(value, { stream: true });
        if (total >= MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    }
    out += decoder.decode();
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// --- public tools (never throw) ---------------------------------------------
/** Read a web page and return readable text (<= maxChars). Guarded against SSRF. */
export async function webFetch(
  url: string,
  maxChars: number = TEXT_CAP,
  deps?: FetchDeps,
): Promise<string> {
  try {
    const blocked = await guard(url, deps);
    if (blocked) return `[web_fetch refused: ${blocked}]`;
    const html = deps?.fetchImpl ? await deps.fetchImpl(url) : await fetchCapped(url);
    return htmlToText(html, maxChars);
  } catch (err) {
    return `[web_fetch error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

/** Search the web via DuckDuckGo lite (no key) and return readable lines. */
export async function webSearch(
  query: string,
  limit: number = 5,
  deps?: FetchDeps,
): Promise<string> {
  try {
    const q = query.trim();
    if (!q) return "[web_search: empty query]";
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
    const blocked = await guard(url, deps);
    if (blocked) return `[web_search refused: ${blocked}]`;
    const html = deps?.fetchImpl ? await deps.fetchImpl(url) : await fetchCapped(url);
    return parseDuckDuckGoLite(html, limit);
  } catch (err) {
    return `[web_search error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}
