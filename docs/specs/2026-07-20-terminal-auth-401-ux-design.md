# Spec: Terminal Auth 401 / UX Fix

**Branch:** `fix/terminal-auth-401-ux`
**Status:** Draft — assigned to employee, PR opened as starting point
**Date:** 2026-07-20

## Problem

Login succeeds (auth shows success, user is signed in), but selecting a model
in the terminal throws:

```
✗ HTTP 401
  ↳ run `aether auth login` to sign in again [lilbe]_:
```

Session appears valid at login time but the model-select call is rejected.
Likely a stale/mismatched token, wrong header, or race between login
completion and terminal session hydration — needs investigation, not assumed.

## Scope

1. **Investigate** — trace the model-select request path, find why the token
   accepted at login is rejected at model-select. Check token refresh/expiry,
   header propagation, and whether terminal session state lags auth state.
2. **Fix auth** — root-cause fix (not a retry/band-aid) so a successfully
   signed-in session can select a model without re-auth.
3. **UX** — the current error message dumps a raw HTTP/CLI-style string into
   the terminal output inline with the prompt (`[lilbe]_:`). Needs a real
   error state: clear message, distinguishable from prompt text, actionable
   (e.g. inline "Sign in again" affordance instead of telling user to run a
   command manually).
4. **UI** — audit the auth/model-select flow surface for consistency while in
   here (loading state, error state, success state should all be visually
   distinct and match the rest of the terminal chrome).

## Out of scope

- DevOps/production hardening → separate branch `loop/devops-production-hardening`
- TypeScript 7 terminal upgrade → separate branch `feat/typescript-7-terminal-upgrade`

## Planned follow-up

Once the fix lands, run a meta-loop over this branch to optimize the auth
flow + UX further (not just patch the reported bug).

## Notes

Minimal spec intentionally — implementer should expand investigation
findings into this doc before/while fixing.
