# Delta report

Baseline reference: none. This is the first LOOP-13 run and establishes the
descriptive baseline.

| measure | current | delta |
|---|---:|---|
| Security | 85 | initial |
| Performance | N/A | initial; evidence absent |
| Maintainability | 66 | initial |
| Complexity | 62 | initial |
| Testability | 76 | initial |
| Accessibility | N/A | initial; evidence absent |
| Composite | 72.3 | initial |
| static graph | 128 nodes / 424 edges | initial |
| dependency depth | 10 | initial |
| SCCs | 1 | initial |
| functions cyclomatic >10 | 88 / 1,306 (6.74%) | initial |
| files >800 lines | 1 | initial |
| duplicate families | 3 | initial |
| suspected-dead surfaces | 1 | initial |

No score drop, new cycle, watchlist join, or trend direction can be asserted
without a prior run. The next run must reuse the formulas in `scorecard.md` or
explicitly report a formula change.

At the LOOP-13 snapshot, the hardening branch did not modify `src/**`; it added
the production verifier under `scripts/`, its tests, delivery workflows,
installers, and operations documentation. A later hosted-CI follow-up made one
targeted portability fix in `src/core/workspace_scope.ts` after Windows exposed
an alias-vs-realpath mismatch. That follow-up adds no import edge or function and
does not change this baseline's cycle, degree, depth, duplication, or complexity
aggregates. The verifier contributes three functions over the cyclomatic
threshold but has 90.69% line coverage and a 100% score across the declared
ten-mutant high-risk catalog.
