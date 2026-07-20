# Breaker round 2 candidates

Primary vector: Hide a floating action behind YAML shorthand (`- uses:`) so the policy scanner misses it.

confidence_block:
  confidence: 0.90
  risk: high
  evidence: [static-analysis, policy-tests]
  unknown: [remote GitHub administration state]
  missing_evidence: [remote workflow execution]
