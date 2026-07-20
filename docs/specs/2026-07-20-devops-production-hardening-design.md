# Spec: DevOps / Production Hardening Loop

**Branch:** `loop/devops-production-hardening`
**Status:** Implemented and locally verified; repository-admin controls remain operator-deferred
**Date:** 2026-07-20

## Purpose

Dedicated branch to run a stack of operator loops focused specifically on
production/infra readiness of aether-agent, separate from the auth/UX fix
branch (`fix/terminal-auth-401-ux`) and the TS7 upgrade branch
(`feat/typescript-7-terminal-upgrade`).

## Loops to run (in order)

Source: [`DBarr3/agentic-loops`](https://github.com/DBarr3/agentic-loops/tree/main/skills)

1. **LOOP-07-infra-devops.md** — infra/devops hardening pass (deploy config,
   CI, env handling, observability).
2. **LOOP-17-sparring-partners.md** — adversarial pairing pass on findings
   from step 1.
3. **LOOP-11-adversarial-review.md** — adversarial review of resulting
   changes before they're trusted.
4. **LOOP-12-test-mutation-chaos.md** — mutation/chaos testing pass to
   confirm the hardening actually holds under failure injection.
5. **LOOP-13-drift-debt.md** — drift/debt sweep to catch anything the above
   loops leave inconsistent or half-migrated.

## Scope

- Production/devops surface only (build, deploy, CI, infra config,
  resilience). Not the auth bug, not the TS7 migration — those are separate
  branches by design so loops don't cross-contaminate unrelated diffs.
- Document findings from each loop stage in this spec as they land.

## Notes

This file began as the starting point and now records the completed run.

## Run results

| loop | run id | verdict | result |
|---|---|---|---|
| LOOP-07 | `2026-07-20T13-53-25-0400` | FAIL-WITH-ARTIFACT | Hardened CI, CodeQL, release provenance, artifact attestation, package verification, installers, dependency updates, and production operations. The code is ready; GitHub/npm administrator controls are not readable with the available credential. |
| LOOP-17 | `2026-07-20T13-58-39-0400` | CONVERGED | Resolved three breaker findings: manual/non-main release bypass, YAML block-scalar verification bypass, and lack of exact-tarball install smoke. Five consecutive no-new-finding rounds held. |
| LOOP-11 | `2026-07-20T14-04-43-0400` | PASS | FREE-MAD score improved from 74 to 92 after closing quoted/npx installer and multiline workflow-checker bypasses plus exact-version message drift. |
| LOOP-12 | `2026-07-20T14-12-13-0400` | PASS-NO-CHAOS | Scoped verifier coverage is 90.69%; all 10 declared high-risk mutants were killed; the 695-test suite passed three consecutive runs. Chaos was correctly skipped because no named sandbox or explicit destructive-test approval was provided. |
| LOOP-13 | `2026-07-20T14-19-07-0400` | PASS-WITH-BASELINE-DEBT | Established the first drift baseline: one pre-existing type-level SCC, three duplication families, one suspected-dead prototype, and one >800-line source file. Composite debt score is 72.3 across four evidenced axes. |

## Deliverables

- Cross-platform CI on Node 24 with immutable action pins, read-only default permissions, clean-install lifecycle suppression, timeouts, tests, production verification, audit, and SBOM evidence.
- Weekly and pull-request CodeQL analysis.
- Release-only npm publication from an exact tag on `main`, protected by an npm production environment, OIDC provenance, build attestation, exact tarball install smoke, and retained evidence.
- Safe version-selectable Bash and PowerShell installers that never pipe remote code to a shell and suppress package lifecycle scripts.
- A production verifier enforcing manifest, package allowlist/size, workflow, release, installer, and installed-CLI invariants.
- A Windows portability repair for workspace containment when runner temp paths use an alias; lexical traversal and canonical symlink guards remain independently enforced.
- Operations, rollback, backup, observability, ownership, and required-administrator-control documentation.
- Full loop artifacts and governance trail under `_loopstate/LOOP-07`, `LOOP-17`, `LOOP-11`, `LOOP-12`, and `LOOP-13`.

## Remaining operator gate

An administrator must verify or configure branch protection and required checks,
the `npm-production` environment and reviewers, least-scope `NPM_TOKEN`, secret
scanning/push protection, Dependabot alerts, and the private backup mirror. No
live infrastructure or repository-admin mutation was attempted by these loops.
