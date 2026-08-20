# LOOP-11 intake

Target: full diff from `origin/main` through `3aa36f0` plus uncommitted LOOP-17 artifacts and reviewer revisions.

Completion criteria:

- No unpinned third-party action, implicit workflow permission, unbounded runner job, or persisted checkout credential.
- Release only from a version-matching tag whose commit belongs to main, through `npm-production`.
- The exact public tarball is allowlisted, attested, install-smoked, and published with provenance.
- No dependency lifecycle script runs in CI, release, README, or installers.
- Full suite and production verifier pass; all external unknowns remain explicit.

confidence_block:
  confidence: 0.88
  risk: high
  evidence: [branch diff, workflow scan, package smoke, tests]
  unknown: [repository-admin settings, remote workflow results]
  missing_evidence: [pushed checks, admin settings export]
