# Skills & Health Release — aether-agent Current State

Recorded: 2026-08-14. Baseline `origin/main` SHA: `b98ef26d16daf61a32a6c0ca437172d794b2efe1`.
Lane branch: `feat/skills-health` (worktree `~/aether-skills-wt`).

## Overlap decision

Open PRs at kickoff: #62/#63/#64 (dependabot GitHub Actions bumps), #36 (docs spec loop).
None touches skills, doctor, instructions, capability contracts, or dev sessions.
No competing branch owns this lane. Recently merged: bidirectional CloudBrain
(`feat/cloud-brain-bidirectional`, now in main as `b98ef26`) — this lane builds on top of it,
not around it.

## Source-of-truth map (as of baseline)

| Concern | Source of truth |
|---|---|
| CLI commands | `src/commands/cli_registry.ts` (`CLI_COMMANDS`, validated at import) |
| Slash commands | `src/commands/slash_registry.ts` + `handleSlash` switch in `src/commands/slash.ts`; parity tests parse the switch source (`test/slash_registry.test.ts`) and `COMMANDS.md` marker blocks (`test/command_docs_parity.test.ts`) |
| Tool names | `src/core/brain_protocol.ts` `TOOLS` (frozen 8: read_file, write_file, run_shell, run_tests, repo_search, git_commit, web_search, web_fetch) |
| Tool schemas + side-effect classes | `src/core/tool_registry.ts` (`TOOL_DEFINITIONS`, `ToolSideEffect = read\|write\|shell\|git\|network`, `validateToolDefinitionCoverage`) |
| Tool execution | `src/core/tool_executor.ts` (workspace escape guard `safe()`, output caps) |
| Permission modes | `src/types.ts` `PermissionMode = ask\|auto\|skip` + `autoApply`; gate logic `src/core/autonomy.ts` (`gateActionFor`, `decideGate`, fail-closed no-TTY) |
| Effort tiers | `src/ui/effort.ts` `EFFORT_TIERS = LOW/MED/HIGH/MAX/ULTRA/CODEPRO` |
| Bridge protocol | `src/core/brain_protocol.ts` `PROTOCOL_VERSION = 3`; fixture `test/fixtures/bridge_conformance.json`; docs `docs/CONTRACTS.md`, `docs/BRIDGE_PROTOCOL.md` |
| Dev-session wire | `src/core/brain_cloud.ts` `DEV_PROTOCOL_VERSION = 1`; request shape `src/core/envelope.ts` `DevSessionWireRequest` |
| Config root | `src/core/config.ts` `configDir()` = `$AETHER_CONFIG_DIR` ?? `~/.config/aether` (all platforms) |
| Logs root | `~/.aether-agent/logs` (`src/core/session_log.ts`) |
| Doctor | `src/commands/doctor.ts` (30 lines) + `src/core/diagnostics.ts` (12 hardcoded checks, `schemaVersion: 1`, `--deep`) |
| Redaction | module-private helpers in `src/core/session_log.ts` (`redactInline`, `loggedArgs`, `loggedEvent`) |
| Release policy | `scripts/verify-production.ts` (zero runtime deps, exact pack allowlist, size ≤ 5 MB, SHA-pinned actions) |

## What does NOT exist yet (greenfield for this release)

- No local skill system: no loader, no `SKILL.md`, no skills directory, no `/skills`, no `aether skills`.
- No instruction-file reading: zero references to `AGENTS.md` / `CLAUDE.md` anywhere in src.
- No support bundle; redaction primitives exist but are private to `session_log.ts`.
- No capability manifest or generated contract files.
- No check registry inside doctor — checks are an inline array in `diagnosticReport()`.

## Behavioral memory vs Agent Skills

The existing "skills" are cloud-hosted QOPC procedural memory rows
(`src/core/cloud_memory.ts`, memory tier `procedural` in `src/core/memory.ts`,
wire event `{type:"skill"}` in `brain_protocol.ts`). They are learned behavioral
descriptions with no version, no digest, no tool policy, no trust state, and no
invocation path. This release does NOT rename or remove them. They remain
"behavioral memory". "Agent Skills" in this release means the new versioned,
digest-bound, permission-declared, invokable packages defined by
`aether.skill/v1`. UI copy must keep the two distinct.

## Constraints inherited from the repo

- Zero runtime dependencies (verify-production hard-fails otherwise) — so strict JSON metadata, no YAML parser.
- npm pack allowlist is exact: new built-in skill resources must ship under `dist/src/**` (compiled-adjacent copy step or embedded strings) — `files` changes must update `scripts/verify-production.ts` expectations deliberately.
- Tests are TS compiled to `dist/test/**`; fixtures referenced relative to dist need `../../` hops.
- tsconfig is maximally strict (`noPropertyAccessFromIndexSignature` etc.).
- Adding a command touches 4 places: registry, dispatch switch, `COMMANDS.md` marker block, tests.
- `capabilities: TOOLS` currently sent unfiltered on dev-session create — insertion point for skill-scoped capability sets; shape changes need additive versioned fields, keep `DEV_PROTOCOL_VERSION = 1` negotiation intact.
- Known gap to fix per spec §7.3: `web_search`/`web_fetch` have `sideEffect: "network"` which maps to no gate (`gateActionFor` returns null) — network currently bypasses the mutation gate.
- CI: `.github/workflows/ci.yml` runs on GitHub-hosted `ubuntu-latest` + `windows-latest` in this repo (matrix build-and-test + supply-chain job). CodeQL weekly. Release workflow publishes with provenance. Any workflow edit must keep: explicit permissions, 40-hex SHA pins, `npm ci --ignore-scripts`, runs-on/timeout parity — enforced by `verify-production` and `test/production_hardening.test.ts`.

## Dependency order for this lane

1. PR A (AETHER-CLOUD): capability contract, hosted skill/instruction context validation, ack frames, feature flag — deployed dark.
2. PR B (aether-agent, this worktree): skill engine, instructions, doctor v2, safe repair, support bundle, capability fallback pinned to PR A's merged SHA.
3. PR C: activation + release proof.
