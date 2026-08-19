# Production Operations

This runbook defines the production boundary for the Aether Agent repository.
It covers the terminal client and its npm delivery path. The hosted Aether API,
account platform, billing, and model fleet are separate systems with separate
operations and incident response.

## Deployment topology

| Stage | Asset | Trust boundary | State owned here |
|---|---|---|---|
| Source | `AetherAI3/aether-agent` on GitHub | Maintainer and pull-request controls | Git history, workflow definitions, release tags |
| Verification | GitHub-hosted Linux and Windows runners | Ephemeral CI identities with explicit permissions | Test logs, CodeQL results, 90-day SBOM artifacts |
| Release | Protected `npm-production` GitHub environment | Required reviewer plus release-scoped npm credential | Attested npm tarball, CycloneDX SBOM, provenance |
| Distribution | npm package `aether-agents` | Public npm registry | Immutable published versions and dist-tags |
| Runtime | End-user Node 24+ process | User workstation and workspace boundary | User-owned config, token, sessions, logs, and worktrees |

There are no Docker images, long-running repository-owned services, systemd
units, Kubernetes resources, Terraform state, public listeners, or databases in
this repository. Do not add placeholder infrastructure for those surfaces. If a
hosted component moves into this repository, this topology and its backup,
network, resource-limit, and restore requirements must be expanded first.

## Required GitHub configuration

The workflow files enforce what can be expressed in source. A repository admin
must also configure these controls in GitHub:

1. Create the `npm-production` environment.
2. Require at least one maintainer approval and restrict deployments to release
   tags created from `main`.
3. Add `NPM_TOKEN` as an environment secret. Scope it only to publish
   `aether-agents`; never use a personal all-packages token.
4. Protect `main`: require pull requests, the Linux and Windows CI jobs, the
   supply-chain job, and CodeQL; dismiss stale approvals after new commits.
5. Enable Dependabot alerts/security updates and secret scanning. The checked-in
   Dependabot configuration supplies weekly npm and GitHub Actions update PRs.

If any control cannot be verified, treat release readiness as unknown and do not
publish.

## Release procedure

1. Update `package.json` and `src/version.ts` to the same semantic version.
2. Run `npm ci --ignore-scripts`, `npm test`, `npm audit --audit-level=high`, and
   `npm run verify:production` from a clean checkout.
3. Merge only after all required CI and CodeQL checks pass.
4. Create and publish a GitHub Release whose existing tag is exactly
   `v<package-version>`. Publishing the release is the operator approval that
   starts `.github/workflows/release.yml`.
5. Approve the `npm-production` environment deployment after reviewing the tag,
   changelog, and workflow inputs.
6. Confirm the workflow produced one tarball, an SBOM, GitHub build provenance,
   npm provenance, and a successful npm publish for the expected version.
7. Install the exact version in a clean temporary prefix and run
   `aether --version`, `aether --help`, and `aether doctor` before moving the npm
   `latest` tag when a staged dist-tag is used.

The release job packs once, attests that tarball, uploads the same tarball as
evidence, and publishes that file. It does not publish a second rebuild.

## Secrets and least privilege

- `NPM_TOKEN` exists only in `npm-production`; it is not a repository secret,
  command-line argument, artifact, log, or local env file.
- CI has read-only repository contents permission. CodeQL alone receives
  `security-events: write`. The release job alone receives OIDC and attestation
  permissions.
- Checkout credentials are not persisted. Dependency lifecycle scripts are
  disabled in CI, release, README instructions, and both installers.
- Rotate the npm credential after suspected exposure, maintainer departure, or a
  publishing incident. Re-run no release until the old credential is revoked.

## Observability and release evidence

- CI and CodeQL status are the release gate; a green local run is supporting
  evidence, not a substitute.
- Each CI commit retains a CycloneDX SBOM for 90 days. Each release retains the
  tarball, pack metadata, and SBOM for 90 days in addition to npm provenance.
- npm version metadata and the GitHub Release tag provide the distribution audit
  trail. `npm run verify:production -- --tag vX.Y.Z` ties them together.
- At runtime, `aether doctor` provides bounded dependency and configuration
  diagnostics. CLI exit codes and user-owned logs are the client-side signal;
  hosted API service telemetry is outside this repository.

## Rollback and incident response

npm releases are immutable. Never overwrite or silently rebuild a published
version.

1. Stop further releases and revoke the publishing credential if compromise is
   possible.
2. Deprecate the affected npm version with a clear install warning and move any
   affected dist-tag to the last known-good version.
3. Publish a fixed version through the normal protected workflow; do not reuse
   the compromised version number.
4. Compare the retained tarball, SBOM, GitHub attestation, npm provenance, and
   source tag. Preserve logs before changing credentials or tags.
5. Follow `SECURITY.md` for coordinated disclosure and document the incident in
   release notes.

## Backup and recovery

The client owns no server-side database or persistent production volume. User
config, credentials, sessions, and worktrees belong to the user's workstation
and must never be uploaded as a repository backup.

Repository source and signed release tags are retained in GitHub; published
tarballs and provenance are retained by npm; the workflow also retains release
evidence for 90 days. Maintainers should keep an organization-controlled mirror
of the Git repository and export release evidence on the normal backup cadence.
Recovery is proven by checking out a signed release tag, running the release
verification commands, and comparing the resulting metadata with the retained
artifact. A registry copy is distribution evidence, not the sole source backup.
