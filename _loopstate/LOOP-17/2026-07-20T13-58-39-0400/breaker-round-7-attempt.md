# Breaker round 7 attempt

| vector | result | evidence | finding |
|---|---|---|---|
| Leak tests, loop artifacts, or environment files into the public npm tarball. | HELD | Package allowlist accepts only required root docs and dist/src; negative fixtures for dist/test and .env are killed. | none |

confidence_block:
  confidence: 0.89
  risk: medium
  evidence: [manual-read, regression-test, command-output]
  unknown: [remote enforcement until pushed]
  missing_evidence: [successful GitHub checks]
