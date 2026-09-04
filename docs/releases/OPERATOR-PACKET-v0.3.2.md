# Operator packet — Aether Agent v0.3.2

> **Frozen historical prerelease evidence.** This packet records prerelease
> qualification for the release line later tagged as v0.3.2 at
> [tag commit `6864d719a56297d1246481a1eb31baae93ca9c4d`](https://github.com/AetherAI3/aether-agent/commit/6864d719a56297d1246481a1eb31baae93ca9c4d).
> PR #134 and its terminal
> convergence work landed afterward and are not part of v0.3.2. Candidate
> measurements below remain frozen; they are not post-publication evidence.

This packet recorded the candidate that reunited the v0.3.1 maintenance line
with `main`. At capture time it was not a release authorization: the tag,
GitHub release, and npm publication were prohibited until the final
pull-request commit passed the required hosted checks.

| | |
|---|---|
| Package | `aether-agents` |
| Evidence state | `frozen-prerelease` |
| Proposed tag | `v0.3.2` |
| Release line base | `c4a16242ad117a499f91e3b531baa80f1a3ff0bd` (`v0.3.1`) |
| Candidate branch | `fix/reconcile-v031-into-main` |
| Release scope | Reconciliation. v0.3.1 was released from `codex/patch-release-031`, which was never merged, so `main` shipped forward without the browser-launcher verification (`openTargetChecked` / `openBrowserAwaitLaunch`), the async browser-login path, and the maintenance-line release guards — while still declaring `0.3.0`. This candidate merges that line into `main` and takes the next patch number, so the declared version is once again ahead of the published `latest`. |
| Deliberately excluded | No new feature work. The device-runtime, telemetry, and session-library work already on `main` is carried by the merge, not introduced here, and is not announced as new in this entry. |
| Selected-change provenance | Full merge of `v0.3.1` (`c4a1624`) into `main` at `5de5aa24c4b6e753affdcf46934499293a286dd0`. Five conflicts resolved: `README.md` and `test/login.test.ts` kept `main`'s rebuilt copy; `src/commands/login.ts` took the v0.3.1 async launcher path; `package.json` and `src/main.ts` were reconciled by hand. |
| Version-drift record | Before this candidate, npm `latest` served `0.3.1` while `main` declared `0.3.0`, so the source tree claimed a version older than the published one and lacked its fixes. `v0.3.1` is now an ancestor of `main`, and that class of drift is detectable by `git merge-base --is-ancestor`. |
| Required qualification | Exact-head Windows, Linux, CodeQL, supply-chain, documentation, package, and release-truth checks; exact-package install canaries; then the release workflow's trusted publication and provenance attestation. |
| Archive evidence | At candidate capture, no release archive existed. The recorded reconciliation-candidate Windows `npm pack --dry-run --json --ignore-scripts` reported `aether-agents-0.3.2.tgz`, 1,387,500 packed bytes, 4,461,548 unpacked bytes, `shasum` `3e22664fe2bc647efe87a72a4d4fb95cb5566e83`, and integrity `sha512-AKvvYi40h64DvOylTk3qDKbs6k+MLP5kt3tUBtoQUDLcu+nTOiEnPxYDbmcmelynROKZjPVnsKxzlOCFJfodow==`; dry-run metadata is not a release checksum or provenance attestation and does not describe later source heads. |
| Package manifest | That recorded reconciliation candidate contained 673 entries. Each later convergence head requires independent hosted package evidence before release. |
| Provenance evidence | At candidate capture, trusted-publishing provenance was pending. v0.3.2 was subsequently published with [npm SLSA provenance](https://registry.npmjs.org/-/npm/v1/attestations/aether-agents@0.3.2); this frozen packet does not replace that registry evidence. |
| PyPI launcher | `packages/pypi-cli` publishes separately as `aether-agent` and is synced to this version by `node packages/sync-version.mjs`. It installs the npm `latest` dist-tag rather than its own version, so it is not a second copy of this release. |
| Rollback | Historical candidate plan: restore npm `latest` to `0.3.1` if a post-publication regression is confirmed; do not unpublish a released version. |

## Version decision

`0.3.1 → 0.3.2` is appropriate because this candidate publishes no new command,
flag, or contract of its own. It carries the v0.3.1 fixes onto `main` and
restores an ordering the registry already assumed. The feature work that has
accumulated on `main` is carried along by the merge but is not announced here;
whichever release chooses to announce it should take the next minor number.

## Qualification record

At candidate capture, the final merge commit, workflow run IDs, artifact digests,
package integrity, SBOM, provenance attestation, and platform canary results
had not yet been attached from immutable hosted evidence. The candidate was not
publishable from this packet alone. v0.3.2 was subsequently tagged and
published; the registry and [GitHub release](https://github.com/AetherAI3/aether-agent/releases/tag/v0.3.2) are the live publication evidence.

## Commands retained without an explicit release-note invocation

These existing visible commands are intentionally retained without adding a new
v0.3.2 announcement. The named exemptions are reviewed at each release so the
patch does not silently add a command surface:

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
