# Merge Manifest

## Review dependency order

1. Cloud PR [#1483](https://github.com/AetherAI3/AETHER-CLOUD/pull/1483), exact head `ee60ab47f881b52e1779e7831282525b6c90c84d`.
2. Agent convergence PR, branch `codex/sol-ultra-convergence-20260904`, based on `bb000edc4ca5c89891ac7352aaf688916ca58bc7`.
3. Human review of contract pins, exact-head artifacts, unknowns, and rollback.
4. Separate merge authorization. This manifest stops before merge.

Voice mirror bytes pin the introducing Cloud commit `f91d677ece3c76c21a09db071ce796c5b2e8c6ea`; CI schema bytes pin the Cloud PR head `ee60ab47f881b52e1779e7831282525b6c90c84d`.

## Agent change groups

- Lifecycle/transport: typed turn reducer; chat/code/verify cancellation and meaningful-progress bounds; closed SSE/request bodies; refresh single-flight ownership.
- Terminal: replayable remount, gap refusal, one outcome owner, pager/resize/metric hardening, capability facts.
- Voice: contract mirror, state/session/transport, default-off command/promo/settings, privacy/provenance validation.
- Settings: registry, view, command/slash, no-follow stores, adapters, reset preview/apply, CI safe-subset editor.
- MCP/custody: bounded lifecycle/diagnostics and closed signed receipt persistence.
- Release/CI truth: generated docs, current operator clarification, explicit PR-head checkout/evidence workflow.
- Evidence: all files in this loop directory.

The authoritative touched set is `git diff --name-status bb000edc4ca5c89891ac7352aaf688916ca58bc7...<PR-head>`. The PR description carries the resolved head because a commit cannot contain its own SHA.

## Rollback

- Before merge: close the PRs/delete branches; `main` is unchanged.
- After a separately authorized merge: revert Agent commits in reverse order; revert Cloud CI hardening then contract publication only if no consumer depends on the contract.
- Runtime settings writes are not part of this implementation session. If a future apply fails, use its receipt/backup; never delete scoped stores blindly.
- No database, deployment, billing, tag, npm, or release rollback is required because none was performed.
