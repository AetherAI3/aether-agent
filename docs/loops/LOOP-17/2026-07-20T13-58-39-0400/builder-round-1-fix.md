# Builder round 1 fix

Removed manual publication dispatch, fetched full history, and required git merge-base --is-ancestor HEAD origin/main.

Verification: publishing workflow must be event-gated, main-derived, and install-smoked.
Commit: `3aa36f0` (composite LOOP-07 remediation checkpoint).

confidence_block:
  confidence: 0.92
  risk: medium
  evidence: [regression-test, npm-test, production-preflight]
  unknown: [remote workflow execution]
  missing_evidence: [successful GitHub checks]
