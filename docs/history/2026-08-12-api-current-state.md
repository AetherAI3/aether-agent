# Historical snapshot: Aether Agent API state on 2026-08-12

> **Historical record — not current product documentation.** This reconnaissance
> captured two repositories at the exact baselines below for a superseded hardening
> plan. Line numbers, open pull requests, gaps, and defect statuses were observations
> on 2026-08-12 and must not be used as present-tense implementation truth. Consult
> the current source, tests, [README](../../README.md), and [command reference](../../COMMANDS.md)
> for the supported surface.

**Date:** 2026-08-12
**Agent baseline:** `AetherAI3/aether-agent` @ `eae6e28cdb6bdb9a1f8ab2d677285f5ce759f568` (main)
**Backend baseline:** `AetherAI3/AETHER-CLOUD` @ `e96ad64c` (origin/main)
**Original purpose:** Phase A deliverable for the API Coding IDE Hardening Spec (§121).
The content below is preserved verbatim apart from this historical framing and title.

---

## 1. Agent Brain protocol

- `Brain` interface (`src/core/brain.ts:17-26`): `run(task)` → `AsyncIterable<BrainEvent>`, `sendToolResult(id, result)`, `control("pause"|"resume"|"steer", note?)`, `close()`.
- `BrainEvent` union (`src/core/brain_protocol.ts:66-118`): `stage, monologue, skill, turn, tool_call, telemetry, status, checkpoint, done, error, memory` + 7 workflow-swarm frames.
- `HostCommand` (`brain_protocol.ts:121-124`): `task | tool_result | control`. `PROTOCOL_VERSION = 3`, pinned by `test/fixtures/bridge_conformance.json`.
- Three implementations:

| impl | transport | `sendToolResult` | `control` |
|---|---|---|---|
| `LocalBrain` (`brain_local.ts`) | Python child, NDJSON stdio | real | real |
| `OllamaBrain` (`brain_ollama.ts`) | in-process TS loop over Ollama HTTP | real (but ignores tool-call id — FIFO assumption, `:80-86`) | no-op |
| `CloudBrain` (`brain_cloud.ts`) | one-way SSE | **no-op (`:90`)** | **no-op (`:91`)** |

## 2. CloudBrain — the confirmed parity gap

- POSTs `ChatWireRequest {query, forced_model_key, agent_name, model_pick_source}` (`envelope.ts:41`) to `/agent/chat/stream`; fail-soft non-stream fallback to `/agent/chat` on `StreamUnavailableError`.
- **Never maps a `tool_call` frame** — the host's execute/gate branch is dead code on the cloud path. Server runs tools server-side (or not at all).
- `close()` sets a flag only; never aborts the fetch (`api.stream()` accepts an AbortSignal CloudBrain doesn't pass).
- Synthesizes its own terminal `done`; never trusts server `done`.
- `custody` frames persisted via `appendCustody()`; `usage/ping/progress/...` dropped.
- **`TaskCommand.effort` is never forwarded to the cloud** — `buildChatRequest` has no effort field, despite `/effort` docs claiming it rides to the cloud brain.

## 3. Host loop & verification

- `cmdCode` (`src/commands/code.ts:102-395`): workspace resolution (`--repo`/`--worktree` vs `prepareWorkspace` gate) → backend choice → `LocalBrain` or `CloudBrain` (`OllamaBrain` unreachable from `aether agent`) → `ToolExecutor` → `hostLoop` (`:403-445`).
- Permission gate: `decideGate` (`src/core/autonomy.ts:70-82`) maps tool → action via `TOOL_DEFINITIONS[name].sideEffect`; only `write|shell|git` gate. **`network` side-effect (web_search/web_fetch) always allowed, never prompted.** Fail-closed on non-TTY without `--yes`.
- Host verification: `finalVerify` (`src/core/verify_gate.ts:60-84`) re-runs the configured test command and derives status from the real exit code. `errored` overrides green; no testCmd → `unverified`. Model "done" is advisory only.
- No host-side tool-call budget, per-tool timeout, or re-entrancy guard in `hostLoop`.

## 4. Local tools (ToolExecutor, `src/core/tool_executor.ts`)

- 8 canonical tools (`brain_protocol.ts:127-137`): `read_file, write_file, run_shell, run_tests, repo_search, git_commit, web_search, web_fetch`.
- Typed arg validation before any side effect (`tool_registry.ts:82-118`): unknown tool/extra args/oversize rejected; coverage asserted by test.
- Path confinement `safe()` (realpath nearest-existing-ancestor vs root); `writeFile` uses `O_NOFOLLOW` + pre-open revalidation; `repoSearch` skips symlinks; **`readFile` lacks `O_NOFOLLOW`**.
- Caps: output 8000 chars (head/tail for tests), snapshot 1 MiB, search 40 hits; `run()` = `spawnSync shell:true`, 15-min timeout, 64 MiB buffer.
- `git_commit` via `GitCommitGuard` — argv only, refuses pre-staged/unexpected staged/>1000 paths.
- Pre-write snapshots feed live diff rendering (rendered **before** gate decision — denied writes still paint a diff).

## 5. Transport / auth

- `ApiClient` (`src/core/transport.ts`, 717 lines). Base `https://api.aethersystems.net/cloud` (`AETHER_BASE_URL` override, never persisted).
- Token: `FileTokenStore` `configDir()/.token`, `O_NOFOLLOW`, 0600; env/static stores; `aek_` API keys.
- Bearer refused over cleartext except localhost; cross-origin `getBinary` goes unauthenticated; server text sanitized (C0/C1 strip, 200-char cap).
- SSE: POST + `Accept: text/event-stream`; JSON response → `StreamUnavailableError` (fail-soft contract); idle-interval timeout (120 s stream / 30 s request, env-overridable, 0=off); unknown frame types → `null` by contract.
- Retry: refresh-on-401 once, shared in-flight; **no retry for 5xx/network/timeout anywhere; no reconnect/resume concept.**

## 6. GitHub — two disjoint paths

- (a) Backend App link (`src/core/github.ts`, `commands/github.ts`): `status|connect|disconnect` against `/account/github/{status,connect,disconnect}` + poll. No local GitHub token ever.
- (b) `--repo owner/name` (`src/core/repo.ts`): user's own `gh`/`git` auth; mirror `~/.aether-agent/repos/<owner>-<name>`; **reused mirror never fetched — arbitrarily stale**; PR = printed `gh pr create` hint.
- No PR/checks/reviews/security context anywhere in the CLI.

## 7. Repo / worktree

- Two divergent flows (`src/core/worktree.ts`): flag-driven (`~/.aether-agent/worktrees`, branch `aether/<slug>-<base36>`) vs gate-driven (`configDir()/worktrees`, `aether/<slug>[-N]`, collision retry ×5, degrade to run-in-place). No listing/pruning; no cleanup.

## 8. Session / context

- `ContextRegistry` (`src/core/context_registry.ts`) — module singleton: pins/drops/uvtCap/plan/label/HUD. **UVT cap display-only: `uvtSpent` never incremented, `checkUvtCap()` zero callers.**
- Snapshots workspace-scoped + traversal-proof (`workspace_scope.ts`); backend sync `POST/GET /agent/context` fail-soft.
- `SessionLog` `~/.aether-agent/logs/...` with substantive redaction (bearer/token/secret patterns, content/command omitted); resume replays events, workspace-scoped.
- All of this is **session context**, not live engineering context (no Git snapshot, PR, CI, security state).

## 9. Model / effort

- No local model list; catalog from `GET /models`. Effort tiers `LOW..CODEPRO` (`src/ui/effort.ts:16`) mirror `lib/orchestrator/presets/contracts.py`. Effort reaches the local Python brain only (see §2).

## 10. AETHER-CLOUD — agent/chat route

- `api/routes/agent_core_routes.py:621` — `POST /agent/chat/stream`, rate-limited, Protocol-C-gated, dual token resolve. **Strictly one-way StreamingResponse**; no tool-result ingress on this route.
- Existing tool-result ingress lives elsewhere: `POST /agent/coding/step` (desktop; client sends whole message array, server returns `tool_uses`), `POST /agent/run/{id}/subtask/{sid}/result` (orchestrator), `POST /agent/code/permission/{id}/decide` (web Code).
- Pre-stream pipeline: prompt-injection guard → UVT preflight (`pricing_guard.preflight`, Gates 0–4) → forced-model tier validation → Protocol-C custody commit → producer → WorkflowGate swarm branch (HIGH/CODEPRO).

## 11. AETHER-CLOUD — SSE protocol

- `lib/sse_protocol.py` = SSOT: `data:{json}\n\n` only, no `event:` names. Vocabulary: `open, ping, reasoning, delta (incremental-only contract), usage, done, error, turn_outcome, workspace_edit_*, user_uvt_remaining, custody, command_result, media, session_status, notice, research_*`.
- **Three incompatible framings in the wild:** chat (`data:`-only), orchestrator route (`event:`+`data:`, `: ping` comments), web Code loop (hand-rolled dicts, its `tool_call/permission_request/tool_result/tool_denied` vocabulary absent from the SSOT module).

## 12. AETHER-CLOUD — web Code loop (do NOT copy into terminal)

- `code_routes.py` (repo root, outside `api/routes/` pattern; own auth helpers, own SSE serializer, tier gate `return True`).
- `lib/code/agent_loop.py:run_code_agent` — Anthropic tool-use loop, server worktree under `<user_vault_root>/conversations/<id>/worktree/`, `_MAX_STEPS=24`, permission Future registry (`lib/code/permission_registry.py`, **process-local — breaks under >1 worker**), 180 s permission timeout, tool output re-scanned by prompt guard before re-entering model.
- Tool schema: `lib/orchestrator/core/coding_tools.py` — `CODING_TOOL_SCHEMAS` (~28 tools, shared with desktop), `READ_ONLY_TOOLS`, `CODE_AGENT_TOOLS` (web subset; excludes ssh/scp/git_push etc. — server identity), `is_mutating()` fail-closed. **This is the schema to normalize against (spec §15), not the loop to reuse (spec §14).**

## 13. Model routing / CODEPRO / billing

- Selection `lib/router.py` (typed tripwires, not policy); authoritative policy = TS PolicyGate `/api/internal/router/pick`, fails closed.
- All provider HTTP in `lib/token_accountant.py`; retry = transport errors only, never streams; usage idempotent on `request_id` (`ON CONFLICT DO NOTHING` — the idempotency primitive Phase B can reuse).
- UVT gates: `lib/pricing_guard.py` `preflight()` Gates 0–4 + slot lifecycle. Live `usage`/`user_uvt_remaining` frames during stream, authoritative DB read after `done`.
- CODEPRO: `resolve_effort_mode()` (`lib/deep_thinking.py`), session caps `lib/orchestrator/atlas/codepro_caps.py`, swarm via `WorkflowGate`.
- CI/Actions billing: `lib/ci_billing/` quote/authorize/record/settle/release; `predator-replay-v1` rate card.

## 14. GitHub App (backend)

- `lib/github_app.py`: JWT, installation token mint with cache + invalidation, repo-scope narrowing; `lib/github_connect_routes.py`: connect/manage/status/repositories/callback/disconnect/webhook.
- Actions adapter `lib/actions_hosted/github.py`: per-repo token narrowed to exact `{contents:read, checks:write}`, fail-closed on grant mismatch, never persisted/logged.
- **Gap: no Dependabot or code-scanning read helpers exist anywhere.** Repo reads limited to installation repo list + Actions tarball/check/PR calls. Phase E must build these.

## 15. Aether Actions / Predator

- `api/routes/actions_hosted_routes.py`: owner plane (quote/runs/settings/PRs/artifacts, run nonce + `approvedMaximumUvt`) + worker plane (lease claim/renew, internal source/events/artifacts/complete). Executor registry pinned by image digest.
- Predator = `predator.replay` operation kind inside Actions (not separate endpoints). **No server-side findings or certificate model exists** — results are artifacts + a "Predator Security" GitHub Check. Phase K depends on this being built.

## 16. Project context / memory / custody

- Project identity `lib/orchestrator/memory/project_identity.py` (uuid5, flag `AETHER_PROJECT_BIND_ENABLED`); read path fail-soft, sanitized, clipped.
- QOPC routes/memory; web-Code typed memory nodes (`lib/code/memory.py`).
- Protocol-C: ASGI stamp middleware (SSE-safe) + per-turn COMMITMENT/ATTESTATION custody frames (client-held, never stored server-side) + orchestrator audit sink. `_require_protocol_c` 503s model routes when signer unhealthy.

## 17. Router extraction pattern (Phase B must follow)

1. New module `api/routes/<name>_routes.py`, bare `APIRouter()` or cohesive prefix.
2. Leaf deps at top (`api/deps_protocol.py`, `api/deps_session.py`, `lib/_rate_limit.py`); `api_server` symbols imported lazily inside handlers.
3. Mount at bottom of `api_server.py`; registration order matters.
4. `tests/api/test_openapi_snapshot.py` guards the contract — new routes update the snapshot deliberately, refactors must not.
5. Anti-pattern on record: root-level `code_routes.py`/`nano_routes.py`.

## 18. Test infrastructure

- Agent: `node:test`, zero runtime deps, tests compiled by tsc and run from `dist/` (`npm test`), 110 files; bridge conformance fixture pins protocol v3; `npm run smoke` = 7-check harness; CI ubuntu+windows Node 24, SHA-pinned actions, SBOM.
- Backend: pytest (asyncio auto), 896 files; tier0–3 markers; route tests inject fake `api_server` into `sys.modules` + in-memory stores; OpenAPI snapshot guard; `tests/parity/` runs desktop/backend tool-schema parity.

---

## 19. Overlap with open work

- aether-agent open PRs at baseline: #62/#63/#64 (Dependabot GH-Actions bumps), #36 (old docs spec). **None own this lane** — spec §121 assumption re-verified 2026-08-12.
- AETHER-CLOUD local checkout was ~3.6k files behind origin/main; all lane-relevant surfaces exist only on origin/main. Sync before backend work.

## 20. Defect register feeding Phases B–H

Agent side:
1. `CloudBrain.sendToolResult`/`control` no-ops; no `tool_call` mapping (Phase B — the gap).
2. `close()` doesn't abort the stream (Phase B).
3. Effort never sent to cloud (Phase B request contract).
4. No reconnect/resume, no 5xx/network retry (Phase B §80).
5. `web_search`/`web_fetch` never gated (Phase H permission categories, spec §59).
6. UVT cap display-only (Phase I, spec §49).
7. `hostLoop` unbounded: no tool budget/per-tool timeout (Phase C/G).
8. `readFile` no `O_NOFOLLOW` (Phase C).
9. Gate prompt truncates command at 200 chars — user approves partially visible command (Phase H, spec §61).
10. Diff rendered before gate decision (Phase H).
11. `--repo` mirror never refreshed; two worktree roots, no prune (Phase E/D).
12. `OllamaBrain.sendToolResult` ignores id — blocks any parallel tool dispatch (Phase C).
13. Ollama tool schema (`buildToolSchemas`) drifts from `TOOL_DEFINITIONS` (Phase C parity).
14. `parseArgs strict:false` swallows typo'd flags (Phase H).

Backend side:
1. No bidirectional dev-session protocol — build `/agent/dev/sessions` family per spec §7 (Phase B).
2. SSE framing not unified; Code vocabulary outside SSOT (Phase B event vocabulary, spec §10).
3. Permission registry process-local/unbounded (design constraint for the new session store).
4. No Dependabot/code-scanning readers (Phase E).
5. No Predator findings/certificate model (Phase K).
6. Code-loop UVT preflight non-denying (do not inherit into dev sessions).
