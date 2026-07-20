# Invocation trace

| node | role | reasoning summary | tools used | duration | confidence | result |
|---|---|---|---|---|---:|---|
| 1-2 | planner | Ingest the full branch and configure three hostile reviewer lenses. | git diff, artifacts | bounded | 0.88 | PASS |
| 3-4 | reviewers | Attack external unknowns, workflow parsing variants, install paths, and exact artifact claims. | static scan, command smoke | bounded | 0.88 | REVISE |
| 5 | generator | Apply cited revisions and negative regression tests. | edit, typecheck, tests | bounded | 0.92 | PASS |
| 6-8 | verifier | Re-attack cited gaps, score history, and emit verdict. | targeted tests, production verifier | bounded | 0.90 | PASS |
