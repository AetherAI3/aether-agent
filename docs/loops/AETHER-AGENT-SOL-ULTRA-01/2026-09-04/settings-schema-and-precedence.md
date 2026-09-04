# Settings Schema and Precedence

## Registry

- Schema `1`; precedence `default < global < project < session < env < server_policy`.
- Writable scopes: global, project, session. Types: boolean, number, string, enum, path, secret reference.
- Health vocabulary distinguishes unconfigured, configured, reachable, verified, degraded, unavailable, disabled-by-policy, and unknown.
- Equal-precedence conflicts and invalid higher-precedence values remain unknown; no lower value is invented as effective.
- Reads/doctors/plans have bounded shared signals. A plan finishing after cancellation can never be issued.
- Staging is mutation-free. Plans are revocable, stale-state checked, exact-confirmed, and single-use. Batch failures compensate in reverse order; cancellation waits for compensation.
- Exports are deterministic and redacted. Raw credential-shaped values and unsafe diagnostics are rejected.

## Persistence

Scoped JSON stores preserve unknown fields, use bounded no-follow regular-file reads, adjacent exclusive locks, optimistic digests, atomic replacement, unique backups, and exact-byte rollback. Existing Agent config, MCP, and skill ownership is reused through adapters.

## Major sections

| Section | Representative settings | Status |
|---|---|---|
| Settings | global/project/session store health | functional |
| Agent / Code | API base, model, effort, backend, permission, auto-apply | functional where existing config owns it |
| Appearance | color, Unicode, animation | fact-based |
| MCP | registry state and server count | diagnostic |
| Skills | enabled/automatic plus catalogue health | functional through canonical port |
| Ollama | model, host, adaptive context | model/config functional; adaptive controller unavailable |
| Voice | availability and conditional runtime leaves | default-off; writable only with proven consuming runtime |
| Online | availability | external port unavailable |
| Actions | runner availability | read-only unavailable |
| CI | gates/safe schema summaries | functional safe JSON subset; no runner authority |

## Section reset

`aether settings reset <section> [--scope global|project] [--preview]` selects only writable members for that scope. Preview emits the exact redacted plan and revokes it with `mutated:false`; apply uses the same confirmation, receipt, CAS, and compensation rails. Unknown, unsupported-scope, already-unset, and plan-unavailable are distinct stable states.

No setting applies because focus moved, and `--yes` cannot bypass cost/destructive confirmation phrases.
