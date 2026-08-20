# Breaker round 1 attempt

| vector | result | evidence | finding |
|---|---|---|---|
| Trigger or manually dispatch publication for a tag whose commit is not on main. | BROKE | The first release draft permitted workflow_dispatch and did not verify tag ancestry. | L17-001 |

confidence_block:
  confidence: 0.94
  risk: high
  evidence: [manual-read, regression-test, command-output]
  unknown: [remote enforcement until pushed]
  missing_evidence: [successful GitHub checks]
