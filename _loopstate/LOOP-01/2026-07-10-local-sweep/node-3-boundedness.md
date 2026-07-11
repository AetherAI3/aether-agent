# LOOP-01 node 3 - boundedness audit

| Endpoint / flow | Paginated | Rate-limited | Cached | Unbounded-risk | Evidence |
|---|---:|---:|---:|---:|---|
| `/mcp-broker/oauth/providers` | N/A | server-side unknown | no | medium | `src/core/mcp.ts:50-56`; `ApiClient.getJson` has no deadline |
| `/mcp-broker/oauth/connections` | N/A | server-side unknown | no | medium | same path as above |
| `/models` in deep doctor | N/A | server-side unknown | no | low | `src/core/diagnostics.ts:174-183` uses a bounded 2s-10s helper |
| `web_fetch` | N/A | no | no | low | `src/core/web.ts:20-22, 391-423`; timeout and byte/text caps |
| vault note search | optional `limit` | server-side unknown | no | medium | `src/core/vault.ts:197-207`; caller can omit limit |
| vault upload/download | N/A | server-side unknown | no | medium | `src/core/vault.ts:151, 173`; whole-file buffering |

The highest-value follow-up is a shared non-streaming request deadline plus bounded vault I/O. No endpoint was classified as an immediate critical memory exhaustion path from the available client code.
