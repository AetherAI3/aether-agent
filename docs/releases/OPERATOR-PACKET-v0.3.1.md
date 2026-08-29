# Operator packet — Aether Agent v0.3.1

This packet records a narrowly scoped patch candidate. It is not a release
authorization: the tag, GitHub release, and npm publication remain prohibited
until the final pull-request commit has passed the required hosted checks.

| | |
|---|---|
| Package | `aether-agents` |
| Proposed tag | `v0.3.1` |
| Release line base | `fb7ceb9c78fdacf84a864a07523185fb4387f531` (`v0.3.0`) |
| Candidate branch | `codex/patch-release-031` |
| Release scope | First-run recovery fixes only: early Node.js-version guidance and browser-login fallback messaging. |
| Deliberately excluded | Later feature work on `main`, including the device-runtime surface and other unreleased command changes. |
| Selected-change provenance | Equivalent, selectively applied portions of `44f1223f62e83c14e8d7741d8590ce61721e3fab` (first-run hardening), reviewed against v0.3.0. |
| Required qualification | Exact-head Windows, Linux, CodeQL, supply-chain, documentation, package, and release-truth checks; exact-package install canaries; then the release workflow’s trusted publication and provenance attestation. |
| Rollback | Restore npm `latest` to `0.3.0` if a post-publication regression is confirmed; do not unpublish a released version. |

## Version decision

`0.3.0 → 0.3.1` is appropriate because the candidate changes recovery
messaging and failure handling without adding a public feature or changing a
supported command contract. The complete `v0.3.0...main` range is not a patch
candidate and is intentionally outside this release line.

## Qualification record

The final merge commit, workflow run IDs, artifact digests, package integrity,
SBOM, provenance attestation, and platform canary results are added only from
the corresponding immutable hosted evidence. Until then this candidate is not
publishable.
