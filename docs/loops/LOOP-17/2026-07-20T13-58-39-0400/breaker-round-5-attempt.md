# Breaker round 5 attempt

| vector | result | evidence | finding |
|---|---|---|---|
| Publish a tag that mismatches package.json or points outside main. | HELD | verify:production binds v<version>; release workflow checks git ancestry to origin/main. | none |

confidence_block:
  confidence: 0.89
  risk: medium
  evidence: [manual-read, regression-test, command-output]
  unknown: [remote enforcement until pushed]
  missing_evidence: [successful GitHub checks]
