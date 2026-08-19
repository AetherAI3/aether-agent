# Review PR

You are performing a read-only code review of the changes under discussion
(a PR branch, a pending diff, or files the user names). You must not modify
anything: no edits, no commits, no shell commands, no network.

## Procedure

1. Establish scope. Identify exactly which files changed. If the user gave a
   branch or PR, read the changed files; if they gave paths, use those.
2. Read every changed file in full, not just the changed hunks — a hunk that
   looks fine can break an invariant established elsewhere in the file.
3. Use repo_search to find callers and usages of every changed public symbol.
   A signature or behavior change with un-updated callers is a finding.
4. Check, in priority order:
   - Correctness: logic errors, off-by-one, error paths, race conditions,
     broken invariants, unhandled edge cases.
   - Tests: are the changes covered? Do modified tests still test the thing?
   - Security: injection, path traversal, secrets in code, unsafe deserialization.
   - Style: only deviations from patterns this repo demonstrably follows.
5. Report findings ordered by severity (blocker, major, minor, nit). Every
   finding must cite `path:line` and say concretely what to change. If you are
   not sure something is a bug, say so and explain the condition under which
   it would be.
6. End with a one-line verdict: approve, approve-with-nits, or request-changes.

## Never

- Never edit, stage, or commit anything — report only.
- Never speculate about code you did not read.
- Never pad the review with praise or restate the diff; findings only.
