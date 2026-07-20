# Breaker round 4 attempt

| vector | result | evidence | finding |
|---|---|---|---|
| Reintroduce a floating GitHub Action or persisted checkout credential. | HELD | All external actions are full 40-character SHAs; checkout persist-credentials is false; policy tests reject floating refs. | none |

confidence_block:
  confidence: 0.89
  risk: medium
  evidence: [manual-read, regression-test, command-output]
  unknown: [remote enforcement until pushed]
  missing_evidence: [successful GitHub checks]
