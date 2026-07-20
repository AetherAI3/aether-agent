# Breaker round 8 attempt

| vector | result | evidence | finding |
|---|---|---|---|
| Use a network-to-shell installer or inject shell syntax through the requested release version. | HELD | README requires download-and-inspect; both installers reject unsafe version characters, quote the package spec, and preserve npm's exit code. | none |

confidence_block:
  confidence: 0.89
  risk: medium
  evidence: [manual-read, regression-test, command-output]
  unknown: [remote enforcement until pushed]
  missing_evidence: [successful GitHub checks]
