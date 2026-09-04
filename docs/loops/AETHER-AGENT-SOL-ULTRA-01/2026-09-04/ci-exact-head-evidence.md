# CI Exact-Head Evidence

## Agent

- Base SHA: `bb000edc4ca5c89891ac7352aaf688916ca58bc7`.
- Branch: `codex/sol-ultra-convergence-20260904`.
- This committed artifact intentionally does not claim its own unknowable commit hash. The authoritative exact head is the PR head SHA, verified by the workflow's `aether.exact-head-source/v1` artifact and copied into the final PR description after checks complete.
- Agent PR and hosted CI: pending until the branch is committed and pushed.

| Local candidate command | Result at artifact construction |
|---|---|
| `npm ci --ignore-scripts` | pass |
| `npm run build` / `npm run typecheck` | pass in focused integration |
| Focused lifecycle/settings/terminal | 88/88 pass |
| Voice/MCP/bridge/status | 67/67 pass |
| Terminal/TUI repeated | 47/47, five consecutive runs |
| Full `npm test`, first run | 2,089 pass / 4 fail / 9 skip; all four failures classified and repaired |
| Full `npm test`, second run | 2,091 pass / 1 transient Windows rename failure / 11 explicit platform skips |
| Affected media history file after bounded rename repair | 14/14, five consecutive runs |
| `npm test` | 2,104 total / 2,093 passed / 0 failed / 11 explicit platform skips |
| `npm run typecheck` | pass |
| `npm run docs:check` | pass; 6 generated outputs clean |
| `npm run verify:production` | pass; 718 packed files / 4,828,406 unpacked bytes / 5 workflows |
| `NODE_OPTIONS=--use-system-ca npm run release:truth` | pass; 12/12 |
| `NODE_OPTIONS=--use-system-ca npm audit --audit-level=high` | 0 vulnerabilities on the unchanged lockfile before the security-only repair; two post-repair registry calls timed out, so the subsequent exact-head hosted supply-chain gate is authoritative |
| `npm pack --dry-run --ignore-scripts --json` | pass; 718 entries / 1,107,310 packed bytes / 4,828,406 unpacked bytes |
| `git diff --check` | pass |

The two file-symlink subcases skip only when unprivileged Windows returns `EPERM`; Linux CI still executes them. No test is converted to a product PASS when its prerequisite is absent.

The first pushed Agent candidate, `8d5c40f366bb41ebb8a66f8e23e49df99443ac9d`, exposed one high-severity CodeQL finding: its compare-and-swap revision used unkeyed SHA-256 over a settings document containing a structural secret reference. The repaired candidate uses a process-random HMAC revision token and adds cross-store secret-reference rollback coverage; the authoritative hosted result belongs to the subsequent PR head.

## AETHER-CLOUD

- PR: [#1483](https://github.com/AetherAI3/AETHER-CLOUD/pull/1483).
- Exact PR head: `ee60ab47f881b52e1779e7831282525b6c90c84d`.
- Hosted run: `33840680420`.
- Passed: Python (17m41s), Site (10m4s), Web (6m14s), Desktop (1m18s), `frontier-arena-evidence`, `hosted-actions-readiness`, `agent-predator-uid-boundary`, and Vercel contexts.
- Skipped by scope: deploy-site, aether-ci-ledger, and Supabase Preview.
- GitHub's broad PR jobs test the synthetic merge candidate. `frontier-arena-evidence` explicitly proves the exact PR head; the PR body records both identities instead of conflating them.

## Admission rule

A focused local suite, a green badge for another SHA, or a GitHub merge-candidate check without exact-source evidence is not an exact-head completion claim. No merge or release follows from this artifact.
