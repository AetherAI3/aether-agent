// End-to-end smoke for the `aether` terminal (TypeScript twin of
// aether_agent/smoke.py). Run with `npm run smoke`.
//
// Prints a PASS / SKIP / FAIL line per real surface:
//   ssrf guard · ollama · local turn · web_search · web_fetch · auth · cloud turn
//
// Offline-safe: anything needing Ollama or the network that isn't up degrades to
// SKIP (never a false FAIL). Exit code is 0 unless a hard FAIL — CI-usable as a
// gate once Ollama is provisioned. Mirrors the Python smoke 1:1.

import { isSafeUrl, webFetch, webSearch } from "./web.js";
import { OllamaBrain } from "./brain_ollama.js";
import { CloudBrain } from "./brain_cloud.js";
import { ToolExecutor, type ToolResult } from "./tool_executor.js";
import { DEFAULT_OLLAMA_HOST, DEFAULT_OLLAMA_MODEL } from "./ollama.js";
import { defaultTokenStore, type TokenStore } from "./auth.js";
import { loadConfig } from "./config.js";
import { ApiClient } from "./transport.js";
import type { Brain, TaskCommand } from "./brain.js";

export type Status = "PASS" | "FAIL" | "SKIP";
export interface Check {
  readonly name: string;
  readonly status: Status;
  readonly detail: string;
}

/** A host-side tool executor seam (ToolExecutor satisfies it). */
export interface ToolExec {
  executeAsync(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

const SMOKE_PROMPT = "Reply with exactly one word: pong";
const MAX_EVENTS = 200;

// --- probes / helpers (injectable for tests) ------------------------------- //

/** True iff Ollama answers on `{host}/api/tags` within `timeoutMs`. */
export async function ollamaUp(host: string, timeoutMs = 4000): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(host.replace(/\/$/, "") + "/api/tags", { signal: ctl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Run one brain turn, executing any tool_call via `exec`. Returns the outcome.
 *  Bounded by MAX_EVENTS so a misbehaving brain can't hang the smoke. */
export async function drainTurn(
  brain: Brain,
  exec: ToolExec,
): Promise<{ ok: boolean; text: string; err: string }> {
  const task: TaskCommand = { type: "task", text: SMOKE_PROMPT, cwd: process.cwd(), poolGb: 5 };
  let text = "";
  let n = 0;
  try {
    for await (const ev of brain.run(task)) {
      n += 1;
      if (ev.type === "monologue") {
        if (ev.text) text = ev.text;
      } else if (ev.type === "tool_call") {
        const r = await exec.executeAsync(ev.name, ev.args);
        brain.sendToolResult(ev.id, r);
      } else if (ev.type === "done") {
        const final = (ev.result || text || "").trim();
        return { ok: ev.ok && final.length > 0, text: final, err: ev.ok ? "" : ev.reason || "not ok" };
      } else if (ev.type === "error") {
        return { ok: false, text: "", err: ev.msg };
      }
      if (n >= MAX_EVENTS) return { ok: text.trim().length > 0, text, err: "capped" };
    }
  } catch (err) {
    return { ok: false, text: "", err: err instanceof Error ? err.message : String(err) };
  }
  return { ok: text.trim().length > 0, text, err: text.trim() ? "" : "no output" };
}

// --- checks ---------------------------------------------------------------- //

/** Security gate (offline-safe): the host guard must refuse internal +
 *  cloud-metadata targets. A FAIL here means SSRF protection regressed. */
export function checkSsrf(safe: (u: string) => { ok: boolean } = isSafeUrl): Check {
  const targets = ["http://169.254.169.254/", "http://127.0.0.1/", "http://10.0.0.1/"];
  const leaked = targets.filter((u) => safe(u).ok === true);
  if (leaked.length > 0) {
    return { name: "ssrf guard", status: "FAIL", detail: `allowed internal target(s): ${leaked.join(", ")}` };
  }
  return { name: "ssrf guard", status: "PASS", detail: "refused 169.254.169.254 / 127.0.0.1 / 10.0.0.1" };
}

export async function checkOllama(
  host: string,
  up: (h: string) => Promise<boolean> = ollamaUp,
): Promise<Check> {
  return (await up(host))
    ? { name: "ollama", status: "PASS", detail: `reachable at ${host}` }
    : { name: "ollama", status: "SKIP", detail: `not reachable at ${host} - start it: ollama serve` };
}

export interface LocalTurnDeps {
  up?: (h: string) => Promise<boolean>;
  brain?: Brain;
  exec?: ToolExec;
}

export async function checkLocalTurn(host: string, model: string, deps: LocalTurnDeps = {}): Promise<Check> {
  const up = deps.up ?? ollamaUp;
  if (!(await up(host))) {
    return { name: "local turn", status: "SKIP", detail: "ollama not reachable - ollama serve" };
  }
  const brain = deps.brain ?? new OllamaBrain({ host, model, maxTurns: 4 });
  const exec = deps.exec ?? new ToolExecutor(process.cwd());
  const { ok, text, err } = await drainTurn(brain, exec);
  if (ok) {
    return { name: "local turn", status: "PASS", detail: `${model} answered: ${JSON.stringify(text.slice(0, 60))}` };
  }
  const hint = err || "empty answer";
  return { name: "local turn", status: "FAIL", detail: /not|pull/.test(hint) ? `${hint} (try: ollama pull ${model})` : hint };
}

export async function checkWebSearch(
  search: (q: string, limit?: number) => Promise<string> = webSearch,
): Promise<Check> {
  const out = await search("aether systems", 2);
  // Any bracketed sentinel ([web_search error/refused/no results/empty query])
  // means "no parsed results" — network/parse issue, not a pass and not a hard fail.
  if (out.startsWith("[web_search")) {
    return { name: "web_search", status: "SKIP", detail: out };
  }
  if (!out.trim()) return { name: "web_search", status: "FAIL", detail: "empty result set" };
  const first = out.trim().split("\n")[0]?.slice(0, 60) ?? "";
  return { name: "web_search", status: "PASS", detail: `results: ${JSON.stringify(first)}` };
}

export async function checkWebFetch(
  fetchFn: (url: string, maxChars?: number) => Promise<string> = webFetch,
): Promise<Check> {
  const out = await fetchFn("https://example.com");
  if (out.startsWith("[web_fetch error")) {
    return { name: "web_fetch", status: "SKIP", detail: `no network? ${out}` };
  }
  if (out.startsWith("[web_fetch refused")) {
    return { name: "web_fetch", status: "FAIL", detail: `public URL wrongly refused: ${out}` };
  }
  if (!/example/i.test(out)) {
    return { name: "web_fetch", status: "FAIL", detail: "fetched text missing expected content" };
  }
  return { name: "web_fetch", status: "PASS", detail: "fetched example.com -> readable text" };
}

export async function checkAuth(baseUrl: string, store: TokenStore = defaultTokenStore()): Promise<Check> {
  const token = await store.get();
  return token
    ? { name: "auth", status: "PASS", detail: `signed in @ ${baseUrl}` }
    : { name: "auth", status: "PASS", detail: `not signed in @ ${baseUrl} (local-first)` };
}

export interface CloudTurnDeps {
  api?: ApiClient;
  brain?: Brain;
}

export async function checkCloudTurn(
  baseUrl: string,
  model: string,
  store: TokenStore = defaultTokenStore(),
  deps: CloudTurnDeps = {},
): Promise<Check> {
  const token = await store.get();
  if (!token) return { name: "cloud turn", status: "SKIP", detail: "not signed in - aether auth login" };
  const api = deps.api ?? new ApiClient(baseUrl, store);
  const brain = deps.brain ?? new CloudBrain(api);
  const exec: ToolExec = { executeAsync: async () => ({ output: "", exitCode: 0 }) };
  void model; // cloud model is server-selected today; kept for signature parity
  const { ok, text, err } = await drainTurn(brain, exec);
  return ok
    ? { name: "cloud turn", status: "PASS", detail: `cloud answered: ${JSON.stringify(text.slice(0, 60))}` }
    : { name: "cloud turn", status: "FAIL", detail: err || "empty answer" };
}

// --- runner ---------------------------------------------------------------- //

/** Print the result table; return an exit code (1 iff any FAIL). */
export function runChecks(
  results: readonly Check[],
  write: (s: string) => void = (s) => void process.stdout.write(s),
): number {
  write("\naether terminal smoke\n");
  let fails = 0;
  for (const c of results) {
    if (c.status === "FAIL") fails += 1;
    write(`  ${c.status.padEnd(4)}  ${c.name.padEnd(12)}  ${c.detail}\n`);
  }
  const npass = results.filter((c) => c.status === "PASS").length;
  const nskip = results.filter((c) => c.status === "SKIP").length;
  write(`\n${npass} pass | ${nskip} skip | ${fails} fail\n`);
  if (fails > 0) write("FAIL - a real surface is broken (see above).\n");
  else if (nskip > 0) write("OK - no failures (skips need Ollama / network / sign-in).\n");
  else write("OK - every surface live and green.\n");
  return fails > 0 ? 1 : 0;
}

/** Assemble + run every check. Each is wrapped so one throw can't abort the smoke. */
export async function smokeMain(): Promise<number> {
  const cfg = loadConfig();
  const baseUrl = cfg.baseUrl || "https://api.aethersystems.net/cloud";
  const model = cfg.defaultModel || DEFAULT_OLLAMA_MODEL;
  const host = process.env["OLLAMA_HOST"] || DEFAULT_OLLAMA_HOST;

  const safe = async (name: string, fn: () => Promise<Check>): Promise<Check> => {
    try {
      return await fn();
    } catch (err) {
      return { name, status: "FAIL", detail: `crashed: ${err instanceof Error ? err.message : String(err)}` };
    }
  };

  const results: Check[] = [
    checkSsrf(),
    await safe("ollama", () => checkOllama(host)),
    await safe("local turn", () => checkLocalTurn(host, model)),
    await safe("web_search", () => checkWebSearch()),
    await safe("web_fetch", () => checkWebFetch()),
    await safe("auth", () => checkAuth(baseUrl)),
    await safe("cloud turn", () => checkCloudTurn(baseUrl, model)),
  ];
  return runChecks(results);
}
