# Breaker round 6 attempt

| vector | result | evidence | finding |
|---|---|---|---|
| Execute a compromised dependency lifecycle script during CI, release, or global installation. | HELD | Every npm ci/install path uses --ignore-scripts and the package contract forbids runtime dependencies. | none |

confidence_block:
  confidence: 0.89
  risk: medium
  evidence: [manual-read, regression-test, command-output]
  unknown: [remote enforcement until pushed]
  missing_evidence: [successful GitHub checks]
