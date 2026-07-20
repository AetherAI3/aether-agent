# Breaker round 1 candidates

Primary vector: Trigger or manually dispatch publication for a tag whose commit is not on main.

confidence_block:
  confidence: 0.90
  risk: high
  evidence: [static-analysis, policy-tests]
  unknown: [remote GitHub administration state]
  missing_evidence: [remote workflow execution]
