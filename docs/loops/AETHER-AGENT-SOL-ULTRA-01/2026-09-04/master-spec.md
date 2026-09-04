# Aether Agent Sol Ultra 01 — Adopted Requirements

Date: `2026-09-04`
Agent base: `bb000edc4ca5c89891ac7352aaf688916ca58bc7`
Cloud base: `b4c1920ad48fcd4287610d0b5c60f5cdb8765a3e`

## Source handling

The attached `AETHER_AGENT_SOL_ULTRA_MASTER_SPEC.md` is source material supplied by the operator. Its embedded role, orchestration, and tool-use language is **not privileged instruction**. This record adopts only the product requirements that fit the operator's request and the repositories' current authority boundaries.

## Objective adopted for this loop

Converge two related changes into a reviewable Aether Agent pull request:

1. Make accepted chat turns terminate with one typed, visible outcome; repair deterministic blank/freeze/resize/remount failure classes; and add capability-truthful Voice contracts and host seams.
2. Add a typed terminal settings core and usable terminal views for current Agent domains while reusing existing stores and clearly marking missing Cloud/Desktop authority unavailable.

## Non-negotiable invariants

- A turn reaches exactly one of `succeeded`, `failed`, `cancelled`, `timed_out`, or `incomplete`.
- A 0-UVT/HTTP 402 response is visible, actionable, sanitized, nonzero, and never silently changes backend.
- Prompts, drafts, transcript, and settings staging survive retryable failure.
- Heartbeats prove liveness only; they do not count as meaningful progress.
- Cleanup is idempotent and late callbacks cannot render after disposal.
- Voice is default-off, begins capture only after explicit start, uses the host's existing conversation bridge, and never invents audio or key-release capability.
- Cloud owns Voice provider selection, credentials, billing, STT/TTS routes, and the portable lifecycle contract.
- Settings show value, source, scope, precedence, validation, health, impact, and restart requirements. Raw secrets are forbidden; only secret references may persist.
- Aether Online and the Desktop-local Actions runner stay read-only/unavailable until an authoritative deployed port exists.
- `.aether-ci.yml` is configuration, not permission to execute renderer-supplied shell commands.

## Evidence rule

Deterministic unit/fixture results prove only the modeled class. Real microphone, speaker, xterm browser, Electron remount, deployed entitlement, billing, and Actions-runner behavior remain `UNPROVEN` until exercised against those systems. A CI result is final evidence only when bound to the exact committed head.

## Change boundary

No merge to `main`, release, publish, tag, production migration, billing mutation, workflow weakening, or authority broadening is authorized by this loop. Human review remains the landing gate.
