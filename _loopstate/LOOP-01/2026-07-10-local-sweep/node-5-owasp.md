# LOOP-01 node 5 - OWASP API verification

| Vector | Verdict | Evidence and limits |
|---|---|---|
| BOLA | UNKNOWN / server-owned | The CLI sends owner-scoped routes such as `/vault/*` and `/audit/*`, but server-side owner checks/RLS cannot be proven from this client repository. No client-side authorization bypass was identified. |
| BOPLA / mass assignment | PASS for inspected client seams | Request bodies are explicitly shaped in `src/core/mcp.ts:58-69` and tool calls are schema-validated in `src/core/tool_executor.ts`; server-side binding remains out of scope. |
| SSRF | PASS | `src/core/web.ts:125-145` rejects unsafe schemes/hosts; DNS results, redirects, response size, and timeout are guarded. Tests cover loopback, private, rebinding, and redirect cases. |
| Broken authentication | PARTIAL / server-owned | `src/core/transport.ts:106-113` refuses bearer tokens over remote HTTP and token storage is tested as owner-only; refresh rotation and server expiry policy cannot be verified here. |
| Unrestricted resource consumption | MEDIUM | Non-streaming API calls lack a shared deadline; vault transfers buffer complete files; note search limit is optional. See node 2 and node 3. |

## Fixed finding

`F-01` (MEDIUM, robustness): `/mcp` could throw when a broker returned an object instead of a list. `src/core/mcp.ts` now validates list-shaped responses before callers iterate them; the existing offline fallback handles the resulting rejection.

No CRITICAL OWASP finding was proven from this client-side scope. Authentication-adjacent code was not mutated.
