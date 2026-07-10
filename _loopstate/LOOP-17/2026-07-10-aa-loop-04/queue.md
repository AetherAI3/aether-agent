# LOOP-17 shared findings/fix queue
run: 2026-07-10-aa-loop-04

- B-001 | breaker | merge-conflict residue | resolved | high | no conflict markers or non-artifact rejects remain.
- B-002 | breaker | workspace escape | resolved | critical | lexical, symlink, explicit session, and explicit goal scope guards pass.
- B-003 | breaker | SSRF and DNS rebinding | resolved | critical | IPv6, redirect, and pinned Host/SNI checks pass; credential login rejects unsafe transport.
- B-004 | breaker | credential or memory-content leakage | resolved | critical | terminal fields sanitized; durable logs redact credentials and omit prompt/command/memory bodies.
- B-005 | breaker | malformed tool bypass | resolved | high | typed registry rejects malformed calls before side effects; local chat uses the same permission gate.
- B-006 | breaker | run-scoped git commit escape | resolved | high | guard stages only run-introduced paths, verifies staged set, and checks worktree/index drift before commit.
- B-007 | breaker | registry/documentation drift | resolved | medium | canonical command parity and grouped help restored.
- B-008 | builder | explicit session cross-workspace access | resolved | high | loadSession and resume/code callers enforce current workspace.
- B-009 | builder | explicit goal cross-workspace access | resolved | high | getGoalForWorkspace gates explicit start/view/selectors.
- B-010 | builder | file write validation race | resolved | high | immediate revalidation plus O_NOFOLLOW final-component open where supported.
- B-011 | builder | raw tool args in local logs | resolved | critical | logged tool args are redacted/metadata-only and memory payload bodies are omitted.
- B-012 | breaker | password login transport bypass | resolved | critical | loginWithPassword applies isCredentialSafeUrl before sending credentials.
- B-013 | breaker | host terminal escape injection | resolved | high | host renderer, local stderr, hyperlinks, and MCP OAuth output sanitize control sequences.
- B-014 | breaker | local chat permission bypass | resolved | high | local chat tool execution uses decideGate and fails closed.
- B-015 | referee | residual findings after round 2 | resolved | high | no new findings; test/audit/marker scans green.

Queue is append-only.
