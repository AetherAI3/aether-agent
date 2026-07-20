# Breaker round 3 attempt

| vector | result | evidence | finding |
|---|---|---|---|
| Ship an allowlisted tarball that cannot be installed or invoked, because only package paths were inspected. | BROKE | The first preflight used npm pack --dry-run but never installed and launched the packed CLI. | L17-003 |

confidence_block:
  confidence: 0.94
  risk: high
  evidence: [manual-read, regression-test, command-output]
  unknown: [remote enforcement until pushed]
  missing_evidence: [successful GitHub checks]
