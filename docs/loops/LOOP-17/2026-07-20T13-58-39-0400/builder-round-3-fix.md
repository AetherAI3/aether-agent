# Builder round 3 fix

Added isolated exact-tarball global installation, binary existence, version, and help smoke checks locally and in the release job.

Verification: npm run verify:production exact-package smoke.
Commit: `3aa36f0` (composite LOOP-07 remediation checkpoint).

confidence_block:
  confidence: 0.92
  risk: medium
  evidence: [regression-test, npm-test, production-preflight]
  unknown: [remote workflow execution]
  missing_evidence: [successful GitHub checks]
