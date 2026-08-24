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
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

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
 * the WHOLE transport so a test can return stub bytes WITHOUT weakening the guard
 * or opening a real socket; `fetchTransport` overrides only the per-hop fetch so a
 * test can drive the manual-redirect guard (return a 30x Response with a Location)
 * deterministically. Production passes none and uses node:dns + global fetch.
 */
export interface FetchDeps {
  readonly resolve?: (host: string) => Promise<readonly string[]>;
  readonly fetchImpl?: (url: string) => Promise<string>;
  readonly fetchTransport?: (url: string) => Promise<Response>;
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
function parseIPv6(raw: string): number[] | null {
  let value = raw.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);
  const dotted = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (dotted?.[1]) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const tail = ((octets[0]! << 8) | octets[1]!).toString(16) + ":" + ((octets[2]! << 8) | octets[3]!).toString(16);
    value = value.slice(0, value.length - dotted[1].length) + tail;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right].map((part) => Number.parseInt(part, 16));
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) return null;
  return words;
}

function isBlockedIPv6(raw: string): boolean {
  const words = parseIPv6(raw);
  if (!words) return true;
  const [a, b, c, d, e, f, g, h] = words as [number, number, number, number, number, number, number, number];
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0 || f === 0xffff)) {
    const embedded = ((g >> 8) & 255) + "." + (g & 255) + "." + ((h >> 8) & 255) + "." + (h & 255);
    return isBlockedIPv4(embedded) || f === 0;
  }
  if ((a & 0xfe00) === 0xfc00) return true;
  if ((a & 0xffc0) === 0xfe80 || (a & 0xffc0) === 0xfec0) return true;
  if ((a & 0xff00) === 0xff00) return true;
  if (a === 0x0100 && b === 0) return true;
  if (a === 0x2002) return true;
  if (a === 0x2001 && (b === 0 || b === 2 || b === 0x10 || b === 0xdb8 || (b & 0xfff0) === 0x20)) return true;
  if ((a & 0xfff0) === 0x3ff0) return true;
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
interface GuardResolution {
  reason: string | null;
  addresses: readonly string[];
}

async function resolveGuard(url: string, deps?: FetchDeps): Promise<GuardResolution> {
  const safe = isSafeUrl(url);
  if (!safe.ok) return { reason: safe.reason ?? "blocked URL", addresses: [] };
  const host = new URL(url).hostname;
  const literal = host.replace(/^\[|\]$/g, "");
  if (looksLikeIPv4(literal) || looksLikeIPv6(literal)) return { reason: null, addresses: [literal] };
  let addresses: readonly string[];
  try {
    addresses = await resolveAll(host, deps);
  } catch {
    return { reason: "cannot resolve host " + host, addresses: [] };
  }
  if (addresses.length === 0) return { reason: "host " + host + " did not resolve", addresses: [] };
  for (const address of addresses) {
    if (isBlockedAddress(address)) return { reason: "host " + host + " resolves to a blocked address", addresses: [] };
  }
  return { reason: null, addresses: [...new Set(addresses)] };
}

async function guard(url: string, deps?: FetchDeps): Promise<string | null> {
  return (await resolveGuard(url, deps)).reason;
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

function isTagNameBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === ">" || ch === "/" || /\s/.test(ch);
}

function asciiLowerCode(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

function findAsciiCaseInsensitive(html: string, needle: string, start: number): number {
  const lastStart = html.length - needle.length;
  for (let i = start; i <= lastStart; i += 1) {
    let matched = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (asciiLowerCode(html.charCodeAt(i + j)) !== needle.charCodeAt(j)) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

function findTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/**
 * Remove raw-text elements without relying on a closing-tag regex. HTML permits
 * whitespace before the closing `>`, and an incomplete closing tag must not
 * cause script or style source to be returned as readable model context.
 */
function stripRawTextElements(html: string, tagName: "script" | "style"): string {
  const openPrefix = `<${tagName}`;
  const closePrefix = `</${tagName}`;
  let cursor = 0;
  let searchFrom = 0;
  let out = "";

  while (searchFrom < html.length) {
    const openStart = findAsciiCaseInsensitive(html, openPrefix, searchFrom);
    if (openStart < 0) break;

    const openNameEnd = openStart + openPrefix.length;
    if (!isTagNameBoundary(html[openNameEnd])) {
      searchFrom = openNameEnd;
      continue;
    }

    const openEnd = findTagEnd(html, openNameEnd);
    out += html.slice(cursor, openStart);
    if (openEnd < 0) return `${out} `;

    let closeSearch = openEnd + 1;
    let closeEnd = -1;
    while (closeSearch < html.length) {
      const closeStart = findAsciiCaseInsensitive(html, closePrefix, closeSearch);
      if (closeStart < 0) return `${out} `;

      const closeNameEnd = closeStart + closePrefix.length;
      if (!isTagNameBoundary(html[closeNameEnd])) {
        closeSearch = closeNameEnd;
        continue;
      }

      closeEnd = findTagEnd(html, closeNameEnd);
      if (closeEnd < 0) return `${out} `;
      break;
    }
    if (closeEnd < 0) return `${out} `;

    out += " ";
    cursor = closeEnd + 1;
    searchFrom = cursor;
  }

  return out + html.slice(cursor);
}

/** Strip script/style + all tags, decode entities, collapse whitespace, cap. */
export function htmlToText(html: string, maxChars: number = TEXT_CAP): string {
  let s = stripRawTextElements(html, "script");
  s = stripRawTextElements(s, "style");
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

const MAX_REDIRECTS = 5;

/**
 * Resolve redirects MANUALLY, re-running the SSRF guard on every hop's Location.
 * `redirect:"follow"` would let a public page 30x-redirect to an internal
 * address (169.254.169.254 metadata, 127.0.0.1, …) AFTER the pre-flight guard
 * already passed the original host — a TOCTOU bypass. We refuse that by guarding
 * each Location before following it. Returns the final Response (2xx/4xx body).
 */
export interface PinnedRequestOptions {
  protocol: "http:" | "https:";
  hostname: string;
  port?: string;
  path: string;
  method: "GET";
  headers: Record<string, string>;
  servername?: string;
}

export function pinnedRequestOptions(url: string, address: string): PinnedRequestOptions {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("unsupported protocol");
  return {
    protocol: target.protocol,
    hostname: address,
    ...(target.port ? { port: target.port } : {}),
    path: target.pathname + target.search,
    method: "GET",
    headers: {
      host: target.host,
      "user-agent": USER_AGENT,
      accept: "text/html,*/*",
      "accept-encoding": "gzip, br, deflate",
    },
    ...(target.protocol === "https:" && isIP(target.hostname) === 0 ? { servername: target.hostname } : {}),
  };
}

/**
 * requestPinned buffers the raw response body itself (no fetch()/undici in the
 * loop), so unlike a normal fetch() call nothing auto-negotiates or decodes
 * Content-Encoding. pinnedRequestOptions now sends Accept-Encoding, so a
 * compliant server may compress — decode it here before the caller ever sees
 * the bytes. Falls back to the raw buffer on decode failure (e.g. MAX_BYTES
 * truncated a compressed stream mid-frame) rather than throwing, matching this
 * transport's existing best-effort behavior for partial responses.
 */
function decodeBody(body: Buffer<ArrayBuffer>, contentEncoding: string | null): Buffer<ArrayBuffer> {
  if (!contentEncoding) return body;
  try {
    const encoding = contentEncoding.trim().toLowerCase();
    if (encoding === "gzip" || encoding === "x-gzip") return gunzipSync(body);
    if (encoding === "br") return brotliDecompressSync(body);
    if (encoding === "deflate") return inflateSync(body);
    return body;
  } catch {
    return body;
  }
}

function responseHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value != null) headers.set(name, String(value));
  }
  return headers;
}

async function requestPinned(url: string, signal: AbortSignal, addresses: readonly string[]): Promise<Response> {
  if (!addresses.length) throw new Error("no approved address");
  const options = { ...pinnedRequestOptions(url, addresses[0]!), signal };
  const request = options.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const req = request(options, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        const raw = Buffer.concat(chunks);
        const body = decodeBody(raw, res.headers["content-encoding"] ?? null);
        const headers = responseHeaders(res.headers);
        headers.delete("content-encoding");
        resolve(new Response(body.length ? body : null, { status: res.statusCode ?? 500, headers }));
      };
      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        const remaining = MAX_BYTES - total;
        if (remaining <= 0) return;
        chunks.push(chunk.subarray(0, remaining));
        total += Math.min(chunk.length, remaining);
        if (total >= MAX_BYTES) { finish(); res.destroy(); }
      });
      res.on("end", finish);
      res.on("error", (error) => { if (!settled) reject(error); });
    });
    req.on("error", (error) => { if (!settled) reject(error); });
    req.end();
  });
}

async function fetchGuardedRedirects(
  url: string,
  signal: AbortSignal,
  deps?: FetchDeps,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const resolution = await resolveGuard(current, deps);
    if (resolution.reason) throw new Error(resolution.reason);
    const res = deps?.fetchTransport
      ? await deps.fetchTransport(current)
      : await requestPinned(current, signal, resolution.addresses);    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res; // redirect with no target — treat as terminal
      const next = new URL(loc, current).toString();
      const blocked = await guard(next, deps);
      if (blocked) throw new Error(`refused redirect to ${blocked}`);
      current = next;
      continue;
    }
    return res;
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
}

// --- fetch with byte cap + timeout ------------------------------------------
async function fetchCapped(url: string, deps?: FetchDeps): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchGuardedRedirects(url, controller.signal, deps);
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
    const html = deps?.fetchImpl ? await deps.fetchImpl(url) : await fetchCapped(url, deps);
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
    const html = deps?.fetchImpl ? await deps.fetchImpl(url) : await fetchCapped(url, deps);
    return parseDuckDuckGoLite(html, limit);
  } catch (err) {
    return `[web_search error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}
