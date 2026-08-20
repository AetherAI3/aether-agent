# Technical-debt scorecard

Scores are 0-100, where 100 is clean. `N/A` axes are excluded from the
composite. Every formula is fixed here for the next run.

| axis | score | reproducible formula | evidence |
|---|---:|---|---|
| Security | 85 | `100 - 15 * unresolved_external_HIGH - 25 * open_code_CRITICAL - 10 * open_code_HIGH`; values `1,0,0` | LOOP-07 L07-007 is an operator-deferred HIGH for unreadable branch protection, environment, secret, and scanning settings; audit reports 0 known dependency CVEs and no credential-shaped secret |
| Performance | N/A | no score when no benchmark or upstream performance audit exists | no LOOP performance artifact or regression budget exists |
| Maintainability | 66 | `100 - 8*files_over_800 - 5*SCC - 4*duplicate_families - 4*suspected_dead - 5*missing_normative_architecture`; values `1,1,3,1,1` | nodes 1-4 |
| Complexity | 62 | `100 - round(3 * pct_functions_CC_gt_10) - 8*files_over_800 - 5*SCC - 5*(max_dependency_depth>=10)`; values `6.74,1,1,true` | 88/1,306 functions over 10, one god file, one SCC, depth 10 |
| Testability | 76 | `round(0.55*overall_line_coverage + 0.25*verifier_line_coverage + 0.20*targeted_mutation_score)`; values `60.98,90.69,100` | LOOP-12 coverage and mutation evidence; 695/695 tests passed three times |
| Accessibility | N/A | no score when no current accessibility audit exists | terminal accessibility/WCAG status has no LOOP-02/06 artifact in scope |

**Composite:** `(85 + 66 + 62 + 76) / 4 = 72.25`, reported as **72.3**.

Confidence is 0.87. Missing performance/accessibility data is visible as N/A,
not converted into flattering scores. Security confidence is limited by GitHub
repository-admin and npm environment visibility; complexity confidence is
limited by unmeasured cognitive and call-graph metrics.
