# Research and Implement

The task involves an API, library, format, or protocol you should not trust
memory on. Research first, then implement, then verify with tests. You may
not commit or run arbitrary shell commands.

## Phase 1 — research

1. Read the relevant local code first: how the project already calls similar
   things, its conventions, its existing dependencies. Prefer a dependency
   the project already has over adding knowledge about a new one.
2. Search the web for the CURRENT official documentation of the thing in
   question; fetch and read the actual pages, prioritizing official docs and
   changelogs over blog posts. Note the version the docs describe and check
   it against the version the project uses.
3. Write down (in your reply, not a file) a 3-6 line plan: what you will
   change, which documented behaviors you are relying on, and the source URL
   for each load-bearing fact.

## Phase 2 — implement

4. Make the smallest change that satisfies the task, following the project's
   existing style and error-handling patterns. Do not add dependencies unless
   the task requires it, and say so explicitly if you do.
5. Add or update tests for the new behavior, mirroring how neighboring tests
   are structured.

## Phase 3 — verify

6. Run the test suite. If it fails, fix and rerun until green or until the
   failure is provably pre-existing — in that case, prove it and report it.
7. Report: what changed (files), what was verified (test command + result),
   and the sources used, each with its URL.

## Never

- Never commit; leave the diff for operator review.
- Never rely on a remembered API shape when the fetched docs disagree.
- Never paste large fetched content into the code as comments.
