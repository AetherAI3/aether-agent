# LOOP-07 Infrastructure and DevOps Audit

run_id: `2026-07-20T13-53-25-0400`  
date: `2026-07-20`  
target: `DBarr3/aether-agent` repository production path (`--no-ssh`)  
branch: `loop/devops-production-hardening`  
baseline SHA: `0f648f3741b7a08eae5ba2f505412b7d2075b51b`

## Verdict: FAIL-WITH-ARTIFACT

Repository code is production-ready for remote verification. One HIGH
operator-controlled gate remains unverified: the real `npm-production`
environment, npm token scope, required reviewers, and `main` protection. No live
infrastructure or repository settings were mutated.

## Confidence block

```yaml
confidence_block:
  confidence: 0.88
  risk: high
  evidence: [static-analysis, npm-test, npm-audit, package-dry-run, sbom, installer-syntax, manual-read]
  unknown: [repository-admin settings, npm credential scope, organization backup mirror, remote workflow results]
  missing_evidence: [successful PR checks, environment-policy export, branch-protection export, restore rehearsal]
```

## Findings

| id | severity | domain | evidence | description | status |
|---|---|---|---|---|---|
| L07-001 | HIGH | Release | `.github/workflows/release.yml` | npm 0.1.0 had no automated verified, attested, SBOM-backed release path | RESOLVED-IN-BRANCH |
| L07-002 | HIGH | CI/IAM | `.github/workflows/ci.yml` | CI lacked explicit permissions/timeouts, ran lifecycle scripts, and tested only Linux | RESOLVED-IN-BRANCH |
| L07-003 | HIGH | Installer | `install.sh`, `install.ps1`, `README.md` | Pipe-to-shell guidance plus a POSIX pipeline hid npm failure and used bash-only `PIPESTATUS` | RESOLVED-IN-BRANCH |
| L07-004 | MEDIUM | Supply chain | `.github/dependabot.yml`, `.github/workflows/codeql.yml` | No SBOM retention, CodeQL, or dependency-update policy | RESOLVED-IN-BRANCH; remote enablement pending |
| L07-005 | MEDIUM | Operations | `docs/PRODUCTION_OPERATIONS.md` | Production topology, rollback, evidence, secret, and backup responsibilities were undocumented | RESOLVED-IN-BRANCH |
| L07-006 | MEDIUM | Config drift | `.env.example`, `COMMANDS.md`, `src/core/config.ts` | Operator docs omitted the required `/cloud` API base path | RESOLVED-IN-BRANCH |
| L07-007 | HIGH | External controls | GitHub/npm settings | Protected environment, token scope, branch protection, alert enablement, and backup mirror cannot be verified with current access | OPERATOR-DEFERRED |

## Diffs applied

- Hardened CI and added static policy regression tests.
- Added CodeQL, Dependabot, SBOM retention, a protected attested npm release,
  immutable package verification, and tag-to-main ancestry validation.
- Reworked both installers to preserve errors, disable lifecycle scripts, and
  permit exact release pinning without network-to-shell execution.
- Added the production operations runbook and corrected API configuration drift.

## Tests generated

- `test/production_hardening.test.ts`: manifest/tag, package allowlist,
  workflow pin/timeout, installer policy, checked-in config, and API-doc drift.

## Remediation plan requiring operator sign-off

1. Merge only after Linux, Windows, supply-chain, and CodeQL checks succeed.
2. Configure `npm-production`, its required reviewer, and a package-scoped
   `NPM_TOKEN`; protect `main` with the new required checks.
3. Enable Dependabot alerts/security updates and secret scanning.
4. Record an organization Git mirror and dated recovery rehearsal.

## Governance row

`| 2026-07-20 | LOOP-07 | 2026-07-20T13-53-25-0400 | FAIL-WITH-ARTIFACT | 0 | 2 | 96 | 0 | 0 | 0 | 0.88 | external admin controls unverified |`

## Recommended next loops

- LOOP-17 on the production policy and release workflow.
- LOOP-11 hostile security review of the final diff.
- LOOP-12 mutation pass on the production verification guard.
- LOOP-13 drift/debt sweep after all remediations settle.
