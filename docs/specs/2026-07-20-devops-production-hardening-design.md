# Spec: DevOps / Production Hardening Loop

**Branch:** `loop/devops-production-hardening`
**Status:** Draft — assigned to employee, PR opened as starting point
**Date:** 2026-07-20

## Purpose

Dedicated branch to run a stack of operator loops focused specifically on
production/infra readiness of aether-agent, separate from the auth/UX fix
branch (`fix/terminal-auth-401-ux`) and the TS7 upgrade branch
(`feat/typescript-7-terminal-upgrade`).

## Loops to run (in order)

Source: `C:\Users\lilbe\Documents\GitHub\agentic-loops\skills\`

1. **LOOP-07-infra-devops.md** — infra/devops hardening pass (deploy config,
   CI, env handling, observability).
2. **LOOP-17-sparring-partners.md** — adversarial pairing pass on findings
   from step 1.
3. **LOOP-11-adversarial-review.md** — adversarial review of resulting
   changes before they're trusted.
4. **LOOP-12-test-mutation-chaos.md** — mutation/chaos testing pass to
   confirm the hardening actually holds under failure injection.
5. **LOOP-13-drift-debt.md** — drift/debt sweep to catch anything the above
   loops leave inconsistent or half-migrated.

## Scope

- Production/devops surface only (build, deploy, CI, infra config,
  resilience). Not the auth bug, not the TS7 migration — those are separate
  branches by design so loops don't cross-contaminate unrelated diffs.
- Document findings from each loop stage in this spec as they land.

## Notes

Minimal spec intentionally — this is the starting point for the loop run,
not the full write-up. Expand with findings per loop stage.
