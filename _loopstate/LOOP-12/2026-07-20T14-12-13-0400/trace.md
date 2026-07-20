# Invocation trace

| node | role | reasoning summary | tools used | duration | confidence | result |
|---|---|---|---|---|---:|---|
| 1-2 | QA mapper | Scope production guards, measure coverage, and map every fixed finding to a regression. | node coverage, artifact read | bounded | 0.94 | PASS |
| 3-4 | test generator | Exercise behavior, integration, and adversarial input variants without adding runtime dependencies. | node:test, package smoke | bounded | 0.90 | PASS |
| 5-6 | mutation adversary | Apply, run, and revert ten high-risk guard mutations. | apply patch, targeted tests | bounded | 0.96 | 10 KILLED |
| 7-8 | chaos controller | Enforce missing-environment approval gate; touch no production target. | control logic | bounded | 1.00 | SKIPPED |
| 9 | verifier | Audit denominator, restoration, coverage, regression sweep, and three-run stability. | full tests, report review | bounded | 0.93 | PASS-NO-CHAOS |
