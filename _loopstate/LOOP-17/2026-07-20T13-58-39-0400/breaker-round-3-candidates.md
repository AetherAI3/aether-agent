# Breaker round 3 candidates

Primary vector: Ship an allowlisted tarball that cannot be installed or invoked, because only package paths were inspected.

confidence_block:
  confidence: 0.90
  risk: high
  evidence: [static-analysis, policy-tests]
  unknown: [remote GitHub administration state]
  missing_evidence: [remote workflow execution]
