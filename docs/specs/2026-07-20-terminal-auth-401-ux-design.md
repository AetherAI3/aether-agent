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

## Investigation findings (2026-07-20)

Three independent client-side defects each produce the reported symptom;
all three are fixed on this branch:

1. **Fresh logins were silently discarded when `AETHER_TOKEN` was set.**
   `tokenStoreFromEnv()` returned an in-memory `StaticTokenStore` whenever
   the env var was present (desktop embed, or a stale export in the shell).
   `aether auth login` wrote the fresh token only into that process's
   memory, printed "✓ Logged in", and exited — the next process re-read the
   stale env token and 401'd. **Fix:** `EnvOverrideTokenStore` — reads still
   prefer the injected token, but `set()` persists to disk; login also warns
   when a shell-level `AETHER_TOKEN` will shadow the stored login.
2. **Expired session tokens were never refreshed.** `/auth/refresh` existed
   but was manual-only. **Fix:** `ApiClient` now, on a 401 with a session
   (non-`aek_`) token on a non-`/auth/*` path, refreshes once (deduped
   across concurrent 401s, insecure-transport-guarded, 10s-bounded) and
   retries once. Automatic refresh uses `TokenStore.update()` so an
   embedded session rotation never overwrites the standalone on-disk login.
3. **The error UX misdiagnosed the failure.** 401 and 403 shared one hint,
   the server's own body detail (e.g. a UVT-balance message) was dropped,
   and the hint line fused with the REPL prompt. **Fix:** `httpStatusHint()`
   is the single wording source for 401/402/403/429 across both hint
   modules; `toHttpError` surfaces (sanitized, capped) body detail as
   "HTTP <status>: <detail>"; `printError` separates from the prompt;
   catalog fetch got a loading line; the fake "(fetching…)" account row in
   `aether auth status` was removed.

Regression coverage: `test/auth_401.test.ts` (13 tests: persistence,
refresh/retry semantics, insecure-transport refusal, concurrent-rotation
straggler, stream retry, hint split, detail surfacing).

Reviewed via two adversarial loop passes (backend/API + terminal-UX lenses)
plus a verification round; all confirmed findings fixed. Known accepted
limits: refresh is bounded at 10s but not Ctrl+C-abortable mid-flight; the
error/prompt separator relies on stdout/stderr sharing one terminal; a new
process under a stale `AETHER_TOKEN` still reads the env token first — the
login-time warning covers that case (only the parent process can unset it).
