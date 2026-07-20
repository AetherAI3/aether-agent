# Breaker round 6 candidates

Primary vector: Execute a compromised dependency lifecycle script during CI, release, or global installation.

confidence_block:
  confidence: 0.90
  risk: medium
  evidence: [static-analysis, policy-tests]
  unknown: [remote GitHub administration state]
  missing_evidence: [remote workflow execution]
