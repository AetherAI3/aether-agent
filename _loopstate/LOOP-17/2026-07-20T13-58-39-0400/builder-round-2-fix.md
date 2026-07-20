# Builder round 2 fix

Extended the structural workflow scan to cover both standalone and list-item uses syntax.

Verification: workflow policy rejects floating actions and unbounded jobs.
Commit: `3aa36f0` (composite LOOP-07 remediation checkpoint).

confidence_block:
  confidence: 0.92
  risk: medium
  evidence: [regression-test, npm-test, production-preflight]
  unknown: [remote workflow execution]
  missing_evidence: [successful GitHub checks]
