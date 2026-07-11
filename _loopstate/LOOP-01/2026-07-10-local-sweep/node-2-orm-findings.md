# LOOP-01 node 2 - ORM and query audit

## Result

The target is a TypeScript CLI client. No ORM, migrations, SQL schema, or database query entry points were found in the scoped `src/` tree, so N+1 and missing-index checks are not applicable to this repository surface.

## Backend-client findings

| ID | Severity | Evidence | Finding | Suggested fix |
|---|---|---|---|---|
| Q-01 | MEDIUM | `src/core/transport.ts:182-228` | `getJson`, `postJson`, `putJson`, and `deleteJson` do not impose a general request deadline; callers can hang outside the bounded diagnostics and stream paths. | Add a bounded request helper or require an `AbortSignal`/timeout for non-streaming calls, then add timeout regression tests. |
| Q-02 | MEDIUM | `src/core/vault.ts:151`, `src/core/vault.ts:173` | Uploads read the whole local file and downloads buffer the whole remote file before writing. | Add configurable byte caps and stream-to-file behavior for large vault transfers. |

No mutation was made for Q-01 or Q-02 because the correct timeout and size policy is an API contract decision.
