# LOOP-17 Sparring Partners Artifact

run_id: `2026-07-20T13-58-39-0400`
date: `2026-07-20`
target: production policy, workflows, package, and installers
branch: `loop/devops-production-hardening`
checkpoint commit: `3aa36f0`

## Verdict: CONVERGED

Five consecutive breaker rounds produced no novel finding at the configured static production-assurance difficulty. The final-five breaker win-rate is flat at zero, all three novel findings are resolved, and the symptom-fix ratio is 0.00.

## Confidence block

```yaml
confidence_block:
  confidence: 0.90
  risk: medium
  evidence: [eight breaker attempts, production-policy tests, full npm suite, exact-tarball smoke]
  unknown: [remote GitHub checks, repository-admin settings, npm-production secret scope]
  missing_evidence: [successful pushed workflow runs, admin settings export]
```

## Findings

| id | severity | evidence | description | status |
|---|---|---|---|---|
| L17-001 | HIGH | release workflow trigger and ref path | Manual dispatch/non-main release was insufficiently constrained | RESOLVED |
| L17-002 | HIGH | initially failing shorthand negative test | `- uses:` could evade the action pin policy scanner | RESOLVED |
| L17-003 | HIGH | dry-run-only package verifier | Verified paths did not prove the tarball installed and launched | RESOLVED |

## Regression tests

- Event gating, main ancestry, and exact-tarball smoke policy.
- Both YAML `uses` forms and full-SHA enforcement.
- Isolated global install with binary, version, and help checks.

## Governance row

`| 2026-07-20 | LOOP-17 | 2026-07-20T13-58-39-0400 | CONVERGED | 1 | 2 | 98 | 0 | 1 | 0 | 0 | 0.90 | 3 findings resolved; final five held |`

## Recommended next loops

- LOOP-11 hostile review of the entire branch diff.
- LOOP-12 mutation testing of the production policy.
- LOOP-13 final drift/debt sweep.
