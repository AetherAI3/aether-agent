# LOOP-17 breaker round 1

Track: hostile read-only review
Target: AA-LOOP-04 focused terminal security and usability

Findings:
- Password login sent credentials without the credential-safe transport gate.
- Local chat executed tools without the same permission gate as code mode.
- Explicit session and goal IDs bypassed workspace filtering.
- Host-rendered fields, local stderr, hyperlinks, and OAuth/MCP URLs could carry terminal control sequences.
- Session logs persisted raw tool arguments and memory payload content.
- Git commit verification was path-set based and lacked a final worktree/index drift check.

Disposition: all findings entered in the shared queue and fixed in the builder track. No agreement was accepted without a concrete test or scan.
