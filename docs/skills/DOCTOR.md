# Doctor v2

`aether doctor` — health with proof, three state words per check:
`configured`, `reachable`, `verified now`. No single green light from
configuration alone.

## Modes

| Mode | Cost | What runs |
|---|---|---|
| `aether doctor` | zero — no network, no mutation, no model call, no UVT | runtime, workspace, git, config/transport, auth config, tool schemas + gates, skills index/lock/trust/evals, instruction graph + conflicts, memory, MCP registry, local persistence |
| `--network` (alias `--deep`) | bounded read-only network | + backend catalog, capability manifest, MCP broker |
| `--live` | zero UVT (synthetic server contract) | one real dev session end to end: auth, capability negotiation, sequence-numbered frames, pause/resume acks, sandboxed write→read tool round trip executed by this host, tool-result acks, teardown, no-residue check |
| `--fix` | dry-run by default | prints the repair plan; `--fix --yes` applies |

Filters and output: `--category skills,instructions`, `--failed`,
`--junit <path>`, `--json` (v1 shape by default for existing consumers;
`--schema v2` for the native report). Exit 1 when any check fails.

## Safe repair

Only three repair classes exist, all backup-first and reversible:
rebuild a corrupt local skill index (settings/trust stores), create a missing
config directory (0700), prune stale temp files (>1 day, listed first).
Every mutation follows inspect → plan → show target → back up → atomic
mutate → verify → rollback on failure, and appends a metadata-only receipt
to `<configDir>/repair-receipts.jsonl`. Doctor never touches credentials,
git state, source files, dependencies, or network policy.

# Support bundle

`aether support-bundle` builds a diagnostics archive that contains metadata,
never customer work:

- `support-manifest.json` (per-file sha256), `doctor-report.json` (fast, v2),
  `runtime.json`, `sanitized-config.json` (host only, no token),
  `skill-inventory.json` / `instruction-inventory.json` (ids, digests, trust,
  sizes — no bodies), `recent-redacted-events.ndjson`, `README.txt`.
- Excluded by construction: repository source, diffs, prompts, transcripts,
  tool output, instruction/skill text, tokens, env values, private paths.
- Verification before success: staged in a 0700 temp dir, packed with a
  deterministic minimal tar, reopened and re-parsed, entry allowlist
  enforced, canonical secret scanner run over every entry, per-file hashes
  verified — then renamed into place and the final sha256 printed. Any
  failure deletes the candidate and exits 1. Nothing is ever uploaded
  automatically.
