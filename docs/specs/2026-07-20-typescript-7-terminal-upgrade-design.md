# Spec: TypeScript 7 Terminal Upgrade

**Branch:** `feat/typescript-7-terminal-upgrade`
**Status:** Draft — assigned to employee, PR opened as starting point
**Date:** 2026-07-20
**Size:** Large — biggest of the 3 branches opened today

## Purpose

Upgrade the aether-agent terminal to take advantage of TypeScript 7 across
the whole codebase, not a single-file bump. This is the largest of the three
branches opened today (auth/UX fix, devops/production loop, this one).

## Scope

- Bump TS toolchain to v7.
- Sweep the terminal codebase for TS7 improvements to adopt — new/changed
  compiler internals, perf wins, stricter inference, any syntax/typing
  features TS7 brings that the current code could benefit from.
- Fix whatever breaks under the new compiler (expect type-check regressions
  on a jump this size — budget time for it).
- Keep runtime behavior identical; this is a toolchain/type-system upgrade,
  not a feature or UX change.

## Out of scope

- Auth/401 fix → `fix/terminal-auth-401-ux`
- DevOps/production hardening loops → `loop/devops-production-hardening`
- Any behavior/UX changes beyond what TS7 forces

## Notes

Minimal spec intentionally — implementer should expand with a real migration
plan (module-by-module or whole-repo, tsconfig changes, breaking-change
inventory) before starting the bulk of the work.
