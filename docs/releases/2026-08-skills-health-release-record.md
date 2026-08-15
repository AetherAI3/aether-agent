# Skills & Health — Release Record (Aether Agent Release 5)

Status: IN PROGRESS — fields marked TBD are filled at each rollout stage.
No secrets, customer content, or internal topology belong in this file.

## Contract versions

| Contract | Version |
|---|---|
| Skill schema (aether.skill/v1) | 1 |
| Skill context packet | 1 |
| Instruction context packet | 1 |
| Capability contract | 1 |
| Doctor report schema | 2 (v1 adapter preserved) |
| Support bundle schema | 1 |
| Dev-session protocol | 1 (additive fields only) |

## Commits and digests

- AETHER-CLOUD baseline at kickoff: `4e6b9e2b150de0dadf3b213fbd988987cd48a8b5`
- aether-agent baseline at kickoff: `b98ef26d16daf61a32a6c0ca437172d794b2efe1`
- PR A (cloud foundation, dark): AetherAI3/AETHER-CLOUD#1065 — merged SHA: `97eacd3e9aca4df226cae638f8f8868b8219fe88` (2026-08-15, deployed dark; required checks python/site/web green + desktop; site rerun after a runner font-fetch flake)
- PR B (agent release): TBD
- PR C (activation): TBD
- Capability contract canonical sha256: `8da094234a370a28dfd6206f039425f086307aa9ca0a67bc004d3d453716ac04`
  (verified byte-identical between Python `contract_digest()` and the TS generator)
- npm package digest: TBD (at Stage 3)

## Test counts (latest full runs)

- aether-agent `npm test`: full suite green after the instruction-extraction fix (TBD exact count at PR B CI)
- AETHER-CLOUD targeted batch: 527 passed (agent_dev, agent_capabilities, capability routes, dev-session routes, flags, web_artifacts, OpenAPI snapshot)
- Site vitest: 2117/2118 locally (1 pre-existing Windows CRLF hash issue; linux CI green: TBD confirm on PR A)
- Desktop quick gates: 17/17

## Live proof (Stage 2 canary)

TBD — record timestamps and outcomes for the §24 sequence (trust lifecycle,
undeclared-tool block, network block, nested AGENTS.md scope, conflict
resolution, doctor fast/network/live, safe repair, support-bundle canary scan,
digest parity across surfaces, installed-package smoke).

## Known limits

- No remote skill marketplace in v1; no skill scripts or hooks.
- Project skills require explicit digest-bound trust.
- Live provider proof is separately authorized (`--live --provider --max-uvt`).
- Cursor rule support covers the simple glob subset only; unsupported syntax
  warns and the rule is not applied.
- Hosted skill context requires a server with capability contract v1; legacy
  servers refuse with `skill.server_unsupported` unless `--no-skills`.

## Rollback path

- Disable hosted skill context: unset `AETHER_AGENT_SKILLS_ENABLED` (flag trio; per-user overrides available).
- Client falls back to local skills and the packaged capability snapshot automatically.
- Disable automatic selection while preserving explicit invocation: per-skill `aether skills disable`, or remove the local automatic opt-ins.
- Agent package rollback through the signed npm release channel.
- Rollback never rewrites a user's project skills or committed lock.
