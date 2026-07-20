# Breaker round 2 attempt

| vector | result | evidence | finding |
|---|---|---|---|
| Hide a floating action behind YAML shorthand (`- uses:`) so the policy scanner misses it. | BROKE | The initial regression test failed because the scanner recognized only a standalone uses key. | L17-002 |

confidence_block:
  confidence: 0.94
  risk: high
  evidence: [manual-read, regression-test, command-output]
  unknown: [remote enforcement until pushed]
  missing_evidence: [successful GitHub checks]
