---
operator: AA-LOOP-04
status: ready
scope: terminal security and usability
---

# AA-LOOP-04 operator notes

## Shipped

- Declarative CLI and slash help registry with aliases, completion, and parity checks.
- Four-tier memory UX over the existing hosted agent-memory service; local mode stays working-context-only.
- Typed tool schemas, argument limits, path confinement, and run-scoped commit staging.
- MCP diagnostics and confirmation-gated, backup-first repair with credential redaction.
- Ordered, fail-soft doctor reports with bounded deep checks.
- Safe web redirect/address validation and deterministic terminal behavior.

## Verification

- `npm test`: 524 pass, 1 sandbox capability skip, 0 failures.
- Security tests cover credential redaction, path isolation, SSRF, malformed tool calls, cloud-memory content suppression, and repair interruption.
- Existing bridge protocol, dependencies, migrations, and permissions are unchanged.

## Security review

- No credentials, user paths, private hostnames, or run ledgers are shipped in this change.
- Hosted memory requests use the existing authenticated client; local mode does not query hosted memory.
- Destructive memory and MCP actions require confirmation; automatic pruning is local-only.
- Operator decision: review the hosted account-scope contract before enabling any future automatic cloud pruning.
- Operator decision: CI keeps main's shared test-isolation setting; consider an isolated-mode follow-up because shared state can mask test coupling.

## Acceptance

- Keep production modules, focused tests, and this artifact.
- Remove loop specs, mutation harnesses, drift scripts, and per-run evidence from the repository.
- Merge only after canonical PR checks and maintainer security review pass.

