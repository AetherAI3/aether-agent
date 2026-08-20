# LOOP-13 AUDIT-ARTIFACT

## Verdict

**PASS-WITH-BASELINE-DEBT** — confidence **0.90**.

The first drift/debt run established a reproducible descriptive baseline for
128 source modules and 424 static import/re-export edges. It found one
pre-existing type-level circular dependency, three duplication families, one
suspected-dead internal TUI prototype, 88 of 1,306 functions above cyclomatic
10, and one file above the 800-line house limit. None of those source findings
were introduced by the hardening work. A later hosted-CI follow-up touched only
the containment logic in `workspace_scope.ts` and did not alter the measured
graph or complexity aggregates.

## Scorecard

| axis | score |
|---|---:|
| Security | 85 |
| Performance | N/A |
| Maintainability | 66 |
| Complexity | 62 |
| Testability | 76 |
| Accessibility | N/A |
| Composite over scored axes | 72.3 |

See `scorecard.md` for formulas and evidence. N/A axes are not scored silently.

## Findings

- **L13-001 MEDIUM:** `core/auth.ts <-> core/transport.ts` static SCC. The
  `transport -> auth` edge is type-only; move the token-store contract or the
  login transport policy to a leaf module.
- **L13-003 MEDIUM:** memory event fields are repeated across protocol, stream,
  and renderer shapes.
- **L13-004 MEDIUM:** media flag parsing is duplicated between top-level and
  slash commands.
- **L13-005 LOW:** progress-bar calculation is implemented in three UI modules.
- **L13-006 MEDIUM:** `TuiLayout` has test callers only and is not publicly
  exported; classify as suspected-dead until the operator confirms its future.
- **L13-007 MEDIUM:** `src/commands/chat.ts` is 967 lines and is both a high-degree
  module and the sole >800-line source file.

## Delta

Initial baseline. No trend delta, axis drop, cycle addition, or watchlist growth
can be claimed. The next run compares against
`2026-07-20T14-19-07-0400` and must preserve or disclose formula changes.

## Adversarial verification

The Forensic Architect completed two FREE-MAD rounds. It forced explicit
first-run labeling, rejected a dead verdict for dynamically loaded command
modules, recomputed Complexity as 62, and verified that every unmeasured or
unavailable surface is listed. No score changed by more than five points on
recomputation.

## Read-only guarantee

LOOP-13 changed no runtime, test, installer, workflow, or implementation
documentation file. Its writes are under `_loopstate/LOOP-13/` plus the required
governance metadata. Runtime changes already present in the working tree were
created and tested by the preceding LOOP-11/12 stages. The hosted Windows repair
was applied only after this read-only run completed.

## Recommended next loops

- **LOOP-01:** own L13-001, L13-003, L13-004, and the `chat.ts`/high-degree
  maintainability seams in a separately scoped architecture refactor.
- **LOOP-02 or LOOP-06:** assess terminal accessibility and consolidate progress
  calculations without erasing intentional visual differences.
- **LOOP-12:** continue whole-repository coverage improvement; retain the
  production verifier's mutation catalog.
- **LOOP-07:** close L07-007 with a repository/npm administrator by verifying
  branch protection, required checks, environment reviewers, token scope,
  scanning, and backup mirror controls.

## Confidence

- score: **0.90**
- evidence: structured AST graph, SCC analysis, exact-window duplication scan,
  package export and dynamic import checks, complexity AST analysis, LOOP-07 and
  LOOP-12 artifacts
- unknown: production traffic, repository/npm administrator settings, cognitive
  complexity, complete call graph, current performance and accessibility state
- missing evidence: prior LOOP-13 baseline, benchmark artifact, accessibility
  artifact, administrator read access

## Governance row

`| 2026-07-20 | LOOP-13 | 2026-07-20T14-19-07-0400 | PASS-WITH-BASELINE-DEBT | 0 | 2 | 97 | 0 | 1 | 0 | 0 | 0.90 | First descriptive baseline; composite 72.3; two axes N/A |`
