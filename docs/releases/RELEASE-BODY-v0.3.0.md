# Aether Agent 3.0

Aether Agent 3.0 turns local coding work into a durable, verifiable workflow
that can move between sessions, models, checkouts, and machines without handing
away tool authority.

## What changed

- **Durable work and handoffs.** Resume project sessions, inspect their real
  continuity state, and export bounded continuation records without absolute
  paths, file contents, shell history, or credentials.
- **Review to pull request.** `aether review` binds verification to the current
  commit and working tree; `aether ship` publishes only the reviewed head after
  explicit action approval.
- **Skills and capabilities.** Six built-in skills ship in the package. Skills
  and `AGENTS.md` now participate in real runs, and skill policy can only narrow
  the available tool surface.
- **Headless execution.** `aether exec` provides versioned JSONL protocols,
  repository-bound checkpoints, acknowledged controls, confined agent
  definitions, receipts, and host-authoritative verification.
- **Local Ollama workflow.** Setup, diagnosis, model listing, selection, and
  pulls are explicit, namespaced, and consent-gated. A plain npm install can run
  the packaged local brain.
- **Managed previews.** Preview start, readiness, open, logs, status, and stop
  are owned by a loopback-only supervisor with one-use local control and full
  process-tree cleanup.
- **Generated public truth.** The command manifest, command reference, model
  catalogue, package inventory, and release claims are checked together.

## Security and release hardening

- Local tools remain path-confined and permission-gated.
- Credentials, absolute paths, private memory, and file contents are excluded
  from portable handoffs and support bundles.
- Cancellation and preview stop clean up full process trees without attaching
  to stale or unrelated PIDs.
- CI qualifies Linux, Windows, the packed supply chain, and CodeQL on the exact
  release head.
- The npm workflow rebuilds from the tag, produces a CycloneDX SBOM, attests the
  package, and publishes with provenance through the owner-gated environment.

## Install

Requires Node.js 24 or newer.

```bash
npm install -g aether-agents@0.3.0 --ignore-scripts
aether --version
```

## Known limitations

- Production Agent DevSessions are currently disabled. Hosted coding and the
  Cloud `aether exec` driver fail closed instead of degrading into server-side
  chat execution. Local Ollama and model-free self-test paths are available.
- The Aether Online/Code redemption contract is not exposed as a supported
  Agent command in this release.
- `/rc` remote viewing is not part of v0.3.0; its viewer and device-enrollment
  dependencies remain follow-up work.

Full verification and rollback evidence is recorded in the
[v0.3.0 operator packet](https://github.com/AetherAI3/aether-agent/blob/v0.3.0/docs/releases/OPERATOR-PACKET-v0.3.0.md).
