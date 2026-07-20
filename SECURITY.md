# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

Email **security@aethersystems.net** with:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if you have one),
- the affected version / commit.

We aim to acknowledge within 3 business days and to keep you updated through
remediation. Coordinated disclosure is appreciated — give us a reasonable window
to ship a fix before going public, and we'll credit you (if you want) in the
release notes.

## Scope

This repository is the **Aether Agent client**. In scope:

- the CLI and the embeddable library in this repo,
- local handling of tokens, config, and file edits,
- anything that could leak a credential or write outside the workspace.

Out of scope here (report to Aether AI directly, same address):

- the hosted Aether API, models, billing, or account platform,
- denial-of-service against the hosted service,
- findings that require a malicious server you control.

## What the client guarantees

- Tokens are stored locally with `0600` permissions and never logged.
- File edits are path-guarded to the working directory.
- Only the prompt and the context you send leave your machine; there is no
  background upload of your repository.

## Good hygiene for users

- Never commit a token. `.env` and `.aether-token` are git-ignored by default.
- Rotate your CLI token at [aethersystems.net/platform](https://aethersystems.net/platform)
  if you suspect it leaked, then `aether auth logout` and `aether auth login` again.
- Prefer `aether login` (browser) over pasting long-lived tokens into scripts.

## Release and supply-chain controls

- GitHub Actions are pinned to immutable commit SHAs and run with explicit,
  least-privilege permissions and bounded timeouts.
- CI installs dependencies with lifecycle scripts disabled, audits the complete
  development graph, tests on Linux and Windows, verifies the npm package
  allowlist, and emits a CycloneDX SBOM.
- npm publication accepts only a `v<package-version>` tag, runs through the
  protected `npm-production` environment, attests the tarball, and publishes
  it with npm provenance. A release never rebuilds after the verified tarball
  has been created.
- Installer scripts support exact-version pinning and never recommend piping a
  network response directly into a shell.

Operational setup, rollback, secret rotation, and evidence retention are
documented in [`docs/PRODUCTION_OPERATIONS.md`](docs/PRODUCTION_OPERATIONS.md).
