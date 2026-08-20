# Structural drift findings

This is the first LOOP-13 run, so the current graph is a **descriptive baseline**.
The table does not claim that current code is an ideal target architecture.

| ID | type | evidence | severity | baseline delta | suggested cut |
|---|---|---|---|---|---|
| L13-001 | circular dependency | `src/core/transport.ts:7` imports the `TokenStore` type from `auth.ts`; `src/core/auth.ts:24` imports `LOGIN_PATH` and `isCredentialSafeUrl` from `transport.ts` | MEDIUM | initial | Move `TokenStore` to a leaf contract module, or move login route and credential URL policy to a transport-policy leaf |
| L13-002 | high coupling | `src/core/transport.ts` degree 42; `src/ui/theme.ts` 38; `src/commands/chat.ts` 36; `src/core/context.ts` 34 | INFO | initial | Track degree deltas; split only when a feature change would otherwise enlarge these seams |

The SCC is type-level on the `transport -> auth` edge, so it is not asserted to
be a runtime initialization cycle. It is still a build-time ownership smell and
is routed to LOOP-01.

No confirmed layer violation was found. The only explicit directional rule in
the available architecture material is that UI must not import commands; the
current static graph has zero `ui -> commands` edges. Existing `core -> ui` and
command-composition edges are retained in the first-run baseline because the
repository intentionally contains rendering integration in core and command
dispatch helpers within commands.

No microservice-to-monolith delta can be computed on a first run. The repository
is a single published Node package whose external service boundaries are the
hosted Aether API, optional local Ollama, GitHub Actions, and npm.

## Unaudited surfaces

- Dynamic import edges are not in the numeric graph. The known CLI/slash dynamic
  dispatch sites were checked manually and explain several zero-static-inbound
  command modules.
- Runtime traffic and external consumers are unavailable.
- Call-level and shared-state coupling were not available from a code-graph
  service, so module imports are the reproducible proxy.
