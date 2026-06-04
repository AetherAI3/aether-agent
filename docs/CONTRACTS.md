# CONTRACTS — canonical wire protocols

This file is the **single source of truth** for cross-process wire contracts.
Parallel build sessions (S1–S9) and both bridge mirrors build against THIS doc.
Changing a shape here is a deliberate, versioned act — not a side effect of a
code edit. If code and this doc disagree, **this doc wins** and the code is the
bug.

---

## 1. AetherCode ↔ Brain bridge event protocol  ·  `PROTOCOL_VERSION = 1`

The event seam between the headless brain (decides) and the TS host (renders +
executes). Full prose + rationale: [`BRIDGE_PROTOCOL.md`](./BRIDGE_PROTOCOL.md).

**Mirrors that MUST stay in lockstep with this version:**
- `aether_agent/protocol.py` (Unlimited-Context) — `PROTOCOL_VERSION`
- `src/core/brain_protocol.ts` (this repo) — `PROTOCOL_VERSION`

**Conformance fixture (the drift detector):** an identical
`bridge_conformance.json` lives in `test/fixtures/` (this repo) and
`tests/fixtures/` (Unlimited-Context). Each side's test suite loads its copy and
asserts its codec round-trips every message + that `protocol_version` matches the
constant. A failing conformance test = drift; fix the code or bump the version.

### Versioning rule

Bump `PROTOCOL_VERSION` (here + both mirrors + both fixtures) on ANY of:
- adding/removing/renaming a message `type`,
- adding/removing/renaming a field,
- changing a field's type or wire key (snake_case).

Adding a new *optional* field that both sides tolerate is a minor change but
still bumps — the fixture is exact-match. Receivers MUST ignore unknown message
`type`s (forward-compat) but tests pin the known set.

### Messages (wire = NDJSON, one JSON object per line, keys snake_case, ASCII-safe)

**brain → host (events)**

| type | fields | meaning |
|---|---|---|
| `stage` | `name, face` | staged-lifecycle marker |
| `monologue` | `text, depth` | nested reasoning-tree line |
| `skill` | `name, reason` | a procedure packet was pinned |
| `tool_call` | `id, name, args` | host must execute + reply with `tool_result` (same `id`) |
| `telemetry` | `tokens, tps, ctx_used, ctx_cap, vram` | live effort/velocity |
| `status` | `phase, pool_used, pool_cap` | drives the pool bar (`pool_cap = pool_gb × 233M`) |
| `checkpoint` | `git_sha` | a verified step was committed |
| `done` | `ok, result` | run finished |
| `error` | `msg` | run aborted |

**host → brain (commands)**

| type | fields | meaning |
|---|---|---|
| `task` | `text, cwd, pool_gb, effort, model` | starts a run (first message) |
| `tool_result` | `id, output, exit_code` | reply to a `tool_call` (id MUST echo) |
| `control` | `action (pause\|resume\|steer), note` | interactive control |

### Invariants (enforced by tests)

1. **Tool-call correlation.** The brain emits ONE `tool_call` and blocks until
   the host replies, so replies are strictly ordered. A `tool_result` whose `id`
   does not match the outstanding call is a protocol violation → the brain emits
   `error` and aborts (it does NOT skip — skipping mis-pairs results to calls).
2. **One tool implementation, host-side.** `read_file · write_file · run_shell ·
   run_tests · repo_search · git_commit`. A single path-guard canonicalizes
   (realpath: resolves `..`, absolute paths, and symlinks) BEFORE the workspace
   allowlist check. Output is `[exit N]\n…`, capped, with stderr captured.
3. **Encoding is lossless, codec-boundary only.** The wire is ASCII-escaped
   (`ensure_ascii`) so it survives a Windows cp1252 pipe; decode restores exact
   UTF-8. Rendered frames are real UTF-8 — escaping never touches them.
4. **Cloud parity (honest gap).** Today's cloud SSE runs tools server-side and
   emits no `tool_call` frame, so `CloudBrain.sendToolResult` is a no-op. When
   the server adds `tool_call` frames + an upstream channel it implements the
   same round-trip — no host change. This is a known divergence, not silent.

---

## Other contracts

- **Universal UVT stream** (chat/orchestrator/MCP SSE): owned by AETHER-CLOUD
  `docs/superpowers/specs/2026-05-31-uvt-stream-contract.md`; surfaced here by
  `src/core/stream.ts`. The bridge's `CloudBrain` maps that vocabulary onto the
  event protocol above.
- **CLI auth** (device flow + `aek_` PAT): the locked CLI↔portal↔backend
  contract; see `src/core/device.ts` + the backend `device_authorizations` /
  `user_api_keys` tables.
