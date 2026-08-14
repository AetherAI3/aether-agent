# Capability contract

One canonical contract drives every surface: backend, web, desktop, CLI help,
and the public matrix. There is no second hand-maintained table.

- Canonical source: `AETHER-CLOUD contracts/agent-capabilities.v1.json`
  (JSON Schema at `contracts/schemas/agent-capabilities.v1.schema.json`).
- Server endpoint: `GET /agent/capabilities` → `{contract, digest, overlay}`.
  The overlay carries runtime availability (feature flags) and never mutates
  the static contract.
- Generated mirrors (drift-gated in CI): site TS, desktop CJS, Python
  constants, and this CLI's offline fallback
  (`src/generated/agent_capabilities.ts`, pinned to source repo + commit +
  canonical sha256).
- Digest: sha256 over the canonical JSON encoding (sorted keys, compact
  separators) — identical bytes in Python and TypeScript, verified by parity
  tests.

Client resolution order:
1. Server manifest when reachable and same major contract version.
2. Packaged fallback otherwise, with a visible warning — never a silent mix
   of two vocabularies.
3. An incompatible major version keeps the fallback and says so.

`aether capabilities [--json] [--available]` shows static support separately
from runtime availability. The public matrix at `/capabilities` renders only
generated data and marks unreleased features unavailable.
