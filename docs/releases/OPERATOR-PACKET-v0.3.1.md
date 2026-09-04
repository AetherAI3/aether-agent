# Operator packet — Aether Agent v0.3.1

> **Frozen historical prerelease evidence.** This packet records the candidate
> later released as v0.3.1 at tag commit
> [`c4a16242ad117a499f91e3b531baa80f1a3ff0bd`](https://github.com/AetherAI3/aether-agent/commit/c4a16242ad117a499f91e3b531baa80f1a3ff0bd).
> Candidate measurements below remain frozen; they are not post-publication
> evidence.

This packet recorded a narrowly scoped patch candidate. At capture time it was
not a release authorization: the tag, GitHub release, and npm publication were
prohibited until the final pull-request commit passed the required hosted
checks.

| | |
|---|---|
| Package | `aether-agents` |
| Evidence state | `frozen-prerelease` |
| Proposed tag | `v0.3.1` |
| Release line base | `fb7ceb9c78fdacf84a864a07523185fb4387f531` (`v0.3.0`) |
| Candidate branch | `codex/patch-release-031` |
| Release scope | First-run recovery fixes only: early Node.js-version guidance and browser-login fallback messaging. |
| Deliberately excluded | Later feature work on `main`, including the device-runtime surface and other unreleased command changes. |
| Selected-change provenance | Equivalent, selectively applied portions of `44f1223f62e83c14e8d7741d8590ce61721e3fab` (first-run hardening), reviewed against v0.3.0. |
| Required qualification | Exact-head Windows, Linux, CodeQL, supply-chain, documentation, package, and release-truth checks; exact-package install canaries; then the release workflow’s trusted publication and provenance attestation. |
| Archive evidence | At candidate capture, no release archive existed. The local Windows `npm pack --dry-run --json --ignore-scripts` reported `aether-agents-0.3.1.tgz`, 837,371 packed bytes, 3,695,485 unpacked bytes, `shasum` `889864b707b5611eefa93461bde5f90757538731`, and integrity `sha512-wJjcMrxHQbdo7RfTciMD7evZJSt2wo1CNsrONNRI8w4zPeBILxNG+2/1WHaH7RVFeXz563gp1T4Bd0abpgTHqw==`; dry-run metadata is not a release checksum or provenance attestation. |
| Package manifest | That candidate dry run reported 618 entries. Hosted exact-head package evidence remained required before release. |
| Provenance evidence | At candidate capture, trusted-publishing provenance was pending. v0.3.1 was subsequently published with [npm SLSA provenance](https://registry.npmjs.org/-/npm/v1/attestations/aether-agents@0.3.1); the [GitHub release](https://github.com/AetherAI3/aether-agent/releases/tag/v0.3.1) is the live release record. |
| Rollback | Historical candidate plan: restore npm `latest` to `0.3.0` if a post-publication regression is confirmed; do not unpublish a released version. |

## Version decision

`0.3.0 → 0.3.1` is appropriate because the candidate changes recovery
messaging and failure handling without adding a public feature or changing a
supported command contract. The complete `v0.3.0...main` range is not a patch
candidate and is intentionally outside this release line.

## Qualification record

At candidate capture, the final commit, workflow run IDs, artifact digests, package
integrity, SBOM, provenance attestation, and platform canary results had not yet
been attached from immutable hosted evidence. The candidate was not publishable
from this packet alone. v0.3.1 was subsequently tagged and published; the
registry and GitHub release are the live publication evidence.

## Commands retained without an explicit release-note invocation

These existing visible commands are intentionally retained without adding a
new v0.3.1 announcement. The named exemptions are reviewed at each release so
the patch does not silently add a command surface:

- `aether help`
- `aether chat`
- `aether run`
- `aether agents`
- `aether github`
- `aether vault`
- `aether workflow`
- `aether memory`
- `aether image`
- `aether video`
- `aether output`
- `aether audit`
- `aether receipt`
- `aether mcp`
- `aether config`
