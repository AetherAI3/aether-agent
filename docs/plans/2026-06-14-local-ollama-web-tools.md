# Plan — aether-code: direct local Ollama (default) + web tools + local-first chat

**Date:** 2026-06-14
**Branch:** `feat/local-ollama-web-tools`
**Sibling repo:** `unlimited-context-llm` (Python) branch `feat/native-terminal-mirror`

## Goal

Make the terminal **local-first**: default to a **direct in-process Ollama** backend (no Python
spawn) for chat, switch to the **Aether cloud API on auth**, and give the agent **web tools** —
so aether-code is feature-identical to the upgraded `unlimited-context-llm`.

- **Local chat path:** a direct TS Ollama client → `localhost:11434` (OpenAI-compat), with the
  same tool loop + tool executor the cloud/brain paths use. No `python -m aether_agent.headless`
  for plain chat. The Python brain is still spawned for `aether code` Unlimited-Context coding runs
  (`--local` / unauthed).
- **Backend policy:** `auto` = *authed ? cloud : local*. Config key `backend: auto|local|cloud`;
  env `AETHER_BACKEND` overrides. `aether auth login` flips the default to cloud.
- **Web tools:** `web_search` (DuckDuckGo lite, no key) + `web_fetch` (fetch → readable text),
  executed host-side in `tool_executor.ts`, advertised in the frozen `TOOLS` list.

## Hard invariants (LOCKSTEP with unlimited-context-llm)

1. `brain_protocol.ts` `PROTOCOL_VERSION` == `aether_agent/protocol.py` — bump **both** to `3`.
2. `TOOLS` identical both sides (+`web_search`, `web_fetch`). Update
   `test/fixtures/bridge_conformance.json`.
3. Tool I/O shape `"[exit N]\n<output>"`, 8000 head+tail cap — unchanged.
4. `src/ui/statusbar.ts` stays the mirror of `aether_agent/statusbar.py`.
5. Token/config on-disk layout unchanged (`~/.config/aether/`).

## New modules (`src/core/`)

| File | Responsibility |
|---|---|
| `ollama.ts` | Direct Ollama OpenAI-compat client (`/v1/chat/completions`, `stream:false`), per-model sampling, tool-call recovery (port `aether_agent/toolparse.py`). `OLLAMA_HOST` env, default `http://localhost:11434`, default model `qwen2.5-coder:7b`. |
| `web.ts` | `webSearch(query)` DuckDuckGo lite HTML (no key); `webFetch(url)` GET → tag-stripped text, capped, SSRF-guarded (block localhost/RFC1918/file/non-http). |
| `brain_ollama.ts` | `OllamaBrain implements Brain` — agentic chat+tool loop over `ollama.ts`, emits the same `BrainEvent`s as `brain_local`/`brain_cloud` so the host renders identically. |

## Extended modules

- `tool_executor.ts` — add `web_search`/`web_fetch` cases (delegate to `web.ts`).
- `brain_protocol.ts` — add web tools to `TOOLS`; bump `PROTOCOL_VERSION` → 3.
- `commands/chat.ts` — `runTurn` selects backend: unauthed → `OllamaBrain` (local) render loop;
  authed → existing cloud SSE. Keep slash/REPL/UX unchanged.
- `core/config.ts` + `types.ts` — add `backend` key (`auto|local|cloud`), default `auto`.
- `commands/code.ts` — `--local`/unauthed already spawns the Python brain; ensure `auto` picks
  local when unauthed.
- `main.ts` HELP + `COMMANDS.md` + `README.md` — document local-first default, web tools, backend key.

## TDD

- `npm run build && node --test dist/test/` is the gate (`node:test`).
- New tests: `ollama.test.ts` (request shape, tool-call recovery, error hints), `web.test.ts`
  (search parse, fetch extraction, SSRF refusal — against a local `http` stub), `brain_ollama.test.ts`
  (event sequence + tool round-trip with a fake client), `backend_select.test.ts` (auto policy),
  `bridge.test.ts` (update protocol/version + TOOLS conformance).
- No live network in tests — stub server bound to 127.0.0.1.

## Out of scope (v1)

Streaming token deltas from Ollama (use `stream:false` like the Python adapter), MCP, swarm,
keychain token store.
